import { Logger } from 'homebridge';
import axios from 'axios';
import WebSocket from 'ws';
import {
  briToPercent,
  percentToBri,
  clampMireds,
  cctToMireds,
  miredsToCct,
  parsePresetsRaw,
  fetchWledInfo,
  rgbToHsv,
  hsvToRgb,
} from '../shared/wledUtils';

export interface WLEDState {
  on: boolean;
  brightness: number;
  colorMode: 'rgb' | 'hsv' | 'hs' | 'ct' | 'unknown';
  color: {
    r: number;
    g: number;
    b: number;
  };
  hue: number;
  saturation: number;
  colorTemperature: number;
  effect: number;
  presetId: number;
  segmentState?: WLEDState[];
}

export interface WLEDSegment {
  id: number;
  name?: string;
  start: number;
  stop: number;
  length: number;
  colors: Array<[number, number, number]>;
  brightness: number;
  on: boolean;
  selected: boolean;
}

export interface WLEDInfo {
  name: string;
  version: string;
  mac: string;
  segmentCount: number;
  ledCount: number;
}

export interface WLEDNightlightState {
  active: boolean;
  durationMinutes?: number;
}

export class WLEDDevice {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private pollTimer?: NodeJS.Timeout;
  private webSocket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private httpFallbackActive = false;
  private readonly maxReconnectAttempts = 15;
  private readonly reconnectInterval = 5000; // 5 seconds
  private readonly pingInterval = 30000; // 30 seconds
  private readonly reconnectGiveUpDelay = 300000; // 5 minutes between slow retries after circuit opens
  private state: WLEDState = {
    on: false,
    brightness: 0,
    colorMode: 'rgb',
    color: { r: 0, g: 0, b: 0 },
    hue: 0,
    saturation: 0,
    colorTemperature: 370, // ~2700K warm white default
    effect: 0,
    presetId: 0,
  };
  private stateListeners: Array<(state: WLEDState) => void> = [];
  private segments: WLEDSegment[] = [];
  private info?: WLEDInfo;
  private isConnected = false;
  private nightlightState: WLEDNightlightState = { active: false };

  constructor(
    private readonly log: Logger,
    private readonly host: string,
    private readonly port: number,
    private readonly pollInterval: number,
    private readonly useWebSockets = true,
  ) {
    this.baseUrl = `http://${host}:${port}/json`;
    this.wsUrl = `ws://${host}:${port}/ws`;
    
    // Initialize by getting the device information
    this.getDeviceInfo().catch(error => {
      this.log.error('Failed to initialize WLED device:', error);
    });
    
    if (this.useWebSockets) {
      this.connectWebSocket();
      
      // Also initialize with a standard HTTP request to ensure we have complete state
      this.updateStateViaHTTP().catch(error => {
        this.log.debug('Error during initial HTTP state update:', error);
      });
    } else {
      // Fall back to polling if WebSockets are disabled
      this.startPolling();
    }
  }
  
  /**
   * Connect to the WLED WebSocket API
   */
  private connectWebSocket(): void {
    // Clean up any existing connection
    this.cleanupWebSocket();
    
    this.log.debug(`Connecting to WebSocket at ${this.wsUrl}`);

    try {
      this.webSocket = new WebSocket(this.wsUrl, {
        // Send ping frames every 30 seconds to keep connection alive
        // and detect dead connections
        perMessageDeflate: false, // Disable compression for better performance
      });
      
      this.webSocket.on('open', () => {
        this.log.debug('WebSocket connection established');
        this.isConnected = true;
        this.reconnectAttempts = 0; // Reset reconnect counter on successful connection

        if (this.httpFallbackActive) {
          this.httpFallbackActive = false;
          this.stopPolling();
          this.log.info(`WebSocket restored for ${this.host}; stopping HTTP fallback polling`);
        }

        // Start keepalive ping mechanism
        this.startPingInterval();
      });
      
      this.webSocket.on('message', (data: WebSocket.Data) => {
        try {
          this.handleWebSocketMessage(data);
        } catch (error) {
          this.log.error('Error handling WebSocket message:', error);
        }
      });

      this.webSocket.on('pong', () => {
        // Pong received - connection is alive
        // Logging removed to reduce noise
      });
      
      this.webSocket.on('error', (error: any) => {
        // Common connection errors that are handled by reconnection logic
        const expectedErrors = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'];
        if (expectedErrors.includes(error.code)) {
          this.log.debug(`WebSocket connection issue (${error.code}), will attempt reconnect`);
        } else {
          this.log.error('WebSocket error:', error);
        }
      });
      
      this.webSocket.on('close', () => {
        this.log.debug('WebSocket connection closed');
        this.isConnected = false;
        
        // Attempt to reconnect
        this.scheduleReconnect();
      });
    } catch (error) {
      this.log.error('Failed to connect to WebSocket:', error);
      this.scheduleReconnect();
    }
  }
  
  /**
   * Clean up WebSocket connection
   */
  private cleanupWebSocket(): void {
    // Stop ping timer
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }

    if (this.webSocket) {
      // Remove all listeners
      this.webSocket.removeAllListeners();

      // Close connection if it's open
      if (this.webSocket.readyState === WebSocket.OPEN) {
        this.webSocket.close();
      }

      this.webSocket = undefined;
    }
  }

  /**
   * Start sending periodic ping frames to keep connection alive
   */
  private startPingInterval(): void {
    // Clear any existing ping timer
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }

    this.pingTimer = setInterval(() => {
      if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
        try {
          this.webSocket.ping();
          // Ping logging removed to reduce noise - pings sent every 30s
        } catch (error) {
          this.log.debug('Error sending WebSocket ping:', error);
        }
      }
    }, this.pingInterval);
  }
  
  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;

    // Circuit breaker: after too many failures, fall back to HTTP polling and retry slowly.
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      if (!this.httpFallbackActive) {
        this.httpFallbackActive = true;
        this.log.warn(
          `WebSocket reconnect limit (${this.maxReconnectAttempts}) reached for ${this.host}; falling back to HTTP polling`,
        );
        this.startPolling();
      }
      this.log.debug(`Scheduling slow WebSocket retry for ${this.host} in ${this.reconnectGiveUpDelay / 1000}s`);
      this.reconnectTimer = setTimeout(() => {
        this.connectWebSocket();
      }, this.reconnectGiveUpDelay);
      return;
    }

    // Exponential backoff: 5s, 10s, 20s, 40s, 60s max
    const delay = Math.min(5000 * Math.pow(2, Math.min(this.reconnectAttempts - 1, 4)), 60000);
    this.log.debug(`Scheduling WebSocket reconnection in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }
  
  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(data: WebSocket.Data): void {
    // Convert data to string if it's not already
    const message = data.toString();

    try {
      this.log.debug(`WebSocket RX: ${message}`);

      // Parse the JSON message
      const jsonData = JSON.parse(message);

      // Check if this is a state update
      if (jsonData.state) {
        this.log.debug('Processing state update from WebSocket');
        this.updateStateFromData(jsonData.state);
      } else if (jsonData.seg !== undefined) {
        // This might be a segment update only
        this.log.debug('Processing segment update from WebSocket');
        this.updateSegmentsFromData(jsonData);
      } else {
        this.log.debug('Received WebSocket message with no recognized state/segment data');
      }
    } catch (error) {
      this.log.error('Error parsing WebSocket message:', error);
    }
  }

  /**
   * Start polling the WLED device for state updates
   */
  private startPolling(): void {
    // Clear any existing poll timer
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    // Create new poll timer
    this.pollTimer = setInterval(() => {
      this.updateStateViaHTTP().catch(error => {
        this.log.debug('Error updating WLED state:', error);
      });
    }, this.pollInterval * 1000);

    // Do an immediate update
    this.updateStateViaHTTP().catch(error => {
      this.log.debug('Error during initial WLED state update:', error);
    });
  }

  /**
   * Stop polling the WLED device
   */
  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
  
  /**
   * Clean up resources when device is removed
   */
  public cleanup(): void {
    // Stop polling
    this.stopPolling();
    
    // Clear reconnect timer if it exists
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    
    // Close WebSocket connection
    this.cleanupWebSocket();
    
    // Clear listeners
    this.stateListeners = [];
    this.presetListeners = [];
  }

  /**
   * Update the device state from the WLED HTTP API
   */
  private async updateStateViaHTTP(): Promise<void> {
    try {
      const response = await axios.get(`${this.baseUrl}/state`);
      const data = response.data;
      this.updateStateFromData(data);
    } catch (error) {
      this.log.debug('Failed to fetch WLED state via HTTP:', error);
      throw error;
    }
  }
  
  /**
   * Update state from data (used by both HTTP and WebSocket)
   */
  private updateStateFromData(data: any): void {
    try {
      // Parse the state response
      const nextBrightness = data.bri !== undefined
        ? briToPercent(data.bri)
        : this.state.brightness;

      this.state = {
        on: data.on === true,
        brightness: nextBrightness,
        colorMode: 'rgb', // Default, will be updated based on data
        color: {
          r: data.seg?.[0]?.col?.[0]?.[0] || 0,
          g: data.seg?.[0]?.col?.[0]?.[1] || 0,
          b: data.seg?.[0]?.col?.[0]?.[2] || 0,
        },
        hue: 0, // Will be calculated from RGB
        saturation: 0, // Will be calculated from RGB
        colorTemperature: this.state.colorTemperature, // Will be updated from CCT data
        effect: data.seg?.[0]?.fx || 0,
        // WLED can report ps=0; don't treat it as "missing" (0 is a valid value for our logic).
        presetId: data.ps ?? -1,
      };

      // Nightlight state (if present)
      if (typeof data.nl === 'object' && data.nl !== null) {
        this.nightlightState = {
          active: data.nl.on === true,
          durationMinutes: typeof data.nl.dur === 'number' ? data.nl.dur : undefined,
        };
      }

      // Update active preset ID if present in the response
      if (data.ps !== undefined) {
        // WLED uses -1 to indicate no preset is active
        this.activePresetId = data.ps >= 0 ? data.ps : -1;
      }

      // Convert RGB to HSV
      const { h, s } = rgbToHsv(
        this.state.color.r,
        this.state.color.g,
        this.state.color.b,
      );
      this.state.hue = h;
      this.state.saturation = s;

      // Parse CCT if reported by WLED (0=cold/6500K, 255=warm/2000K)
      const cct = data.seg?.[0]?.cct;
      if (cct !== undefined && cct !== null) {
        this.state.colorTemperature = cctToMireds(cct);
        this.state.colorMode = 'ct';
      } else {
        this.state.colorMode = 'rgb';
      }

      // Update segment info if available
      this.updateSegmentsFromData(data);

      // Notify listeners
      this.notifyListeners();
    } catch (error) {
      this.log.error('Error updating state from data:', error);
    }
  }
  
  /**
   * Update segments information from data
   */
  private updateSegmentsFromData(data: any): void {
    if (data.seg && Array.isArray(data.seg)) {
      this.segments = data.seg.map((segment: any, index: number) => ({
        id: index,
        name: segment.n || `Segment ${index}`,
        start: segment.start,
        stop: segment.stop,
        length: segment.stop - segment.start,
        colors: segment.col || [],
        brightness: segment.bri !== undefined ? briToPercent(segment.bri) : 0,
        on: segment.on === true,
        selected: segment.sel === true,
      }));

      // Update segment states if they exist
      if (this.segments.length > 0) {
        this.state.segmentState = this.segments.map(segment => {
          const mainColor = segment.colors[0] || [0, 0, 0];
          const { h, s } = rgbToHsv(mainColor[0], mainColor[1], mainColor[2]);
          
          return {
            on: segment.on,
            brightness: segment.brightness,
            colorMode: 'rgb',
            color: {
              r: mainColor[0],
              g: mainColor[1],
              b: mainColor[2],
            },
            hue: h,
            saturation: s,
            colorTemperature: 140,
            effect: 0,
            presetId: 0,
          };
        });
      }
    }
  }


  /**
   * Get the current state
   */
  public getState(): WLEDState {
    return {
      ...this.state,
      color: { ...this.state.color },
      segmentState: this.state.segmentState
        ? this.state.segmentState.map(segment => ({
          ...segment,
          color: { ...segment.color },
        }))
        : undefined,
    };
  }

  /**
   * Get segment state
   */
  public getSegmentState(segmentIndex: number): WLEDState | undefined {
    return this.state.segmentState?.[segmentIndex];
  }

  /**
   * Register a listener for state changes
   */
  public addStateListener(listener: (state: WLEDState) => void): void {
    this.stateListeners.push(listener);
  }

  /**
   * Remove a listener
   */
  public removeStateListener(listener: (state: WLEDState) => void): void {
    const index = this.stateListeners.indexOf(listener);
    if (index >= 0) {
      this.stateListeners.splice(index, 1);
    }
  }

  /**
   * Notify all listeners of a state change
   */
  private notifyListeners(): void {
    for (const listener of this.stateListeners) {
      try {
        listener(this.state);
      } catch (error) {
        this.log.error('Error in state listener:', error);
      }
    }
  }

  /**
   * Get current nightlight state (best-effort)
   */
  public getNightlightState(): WLEDNightlightState {
    return { ...this.nightlightState };
  }

  /**
   * Start nightlight with the given duration in seconds.
   * WLED expects duration in minutes, so we convert here.
   */
  public async startNightlight(durationSeconds: number): Promise<void> {
    try {
      const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
      await this.sendState({
        nl: {
          on: true,
          dur: durationMinutes,
        },
      });

      this.nightlightState = {
        active: true,
        durationMinutes,
      };
      this.notifyListeners();
    } catch (error) {
      this.log.error('Failed to start nightlight:', error);
      throw error;
    }
  }

  /**
   * Stop any running nightlight.
   */
  public async stopNightlight(): Promise<void> {
    try {
      await this.sendState({
        nl: {
          on: false,
        },
      });

      this.nightlightState = {
        active: false,
      };
      this.notifyListeners();
    } catch (error) {
      this.log.error('Failed to stop nightlight:', error);
      throw error;
    }
  }

  /**
   * Send a state update via WebSocket when connected, otherwise HTTP.
   * When WebSocket send fails, falls back to fire-and-forget HTTP.
   */
  private async sendState(payload: object): Promise<void> {
    if (this.useWebSockets && this.isConnected) {
      this.sendWebSocketUpdate(payload);
      return;
    }
    await axios.post(`${this.baseUrl}/state`, payload);
  }

  /**
   * Send a state update via the WebSocket connection (HTTP fallback on failure).
   */
  private sendWebSocketUpdate(payload: any): void {
    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      try {
        const message = JSON.stringify(payload);
        this.log.debug(`WebSocket TX: ${message}`);
        this.webSocket.send(message);
        return;
      } catch (error) {
        this.log.debug('Error sending WebSocket message, falling back to HTTP:', error);
      }
    }

    this.log.debug('WebSocket not available, using HTTP fallback for:', JSON.stringify(payload));
    axios.post(`${this.baseUrl}/state`, payload).catch(error => {
      this.log.error('Failed to send state update via HTTP:', error);
    });
  }

  /**
   * Apply a segment field update and optional local state patch.
   */
  private async applySegmentUpdate(
    segmentIndex: number,
    fields: Record<string, unknown>,
    patchLocal?: (segment: WLEDState) => void,
  ): Promise<void> {
    await this.sendState({
      seg: {
        id: segmentIndex,
        ...fields,
      },
    });

    if (patchLocal && this.state.segmentState?.[segmentIndex]) {
      patchLocal(this.state.segmentState[segmentIndex]);
    }
    this.notifyListeners();
  }
  
  /**
   * Set the on/off state
   */
  public async setPower(on: boolean): Promise<void> {
    try {
      await this.sendState({ on });
      this.state.on = on;
      this.notifyListeners();
    } catch (error) {
      this.log.error('Failed to set power state:', error);
      throw error;
    }
  }

  /**
   * Set segment power state
   */
  public async setSegmentPower(segmentIndex: number, on: boolean): Promise<void> {
    try {
      await this.applySegmentUpdate(segmentIndex, { on }, seg => {
        seg.on = on;
      });
    } catch (error) {
      this.log.error(`Failed to set power state for segment ${segmentIndex}:`, error);
      throw error;
    }
  }

  /**
   * Set the brightness level (0-100)
   */
  public async setBrightness(brightness: number): Promise<void> {
    try {
      await this.sendState({ bri: percentToBri(brightness) });
      this.state.brightness = brightness;
      this.notifyListeners();
    } catch (error) {
      this.log.error('Failed to set brightness:', error);
      throw error;
    }
  }

  /**
   * Set segment brightness
   */
  public async setSegmentBrightness(segmentIndex: number, brightness: number): Promise<void> {
    try {
      await this.applySegmentUpdate(segmentIndex, { bri: percentToBri(brightness) }, seg => {
        seg.brightness = brightness;
      });
    } catch (error) {
      this.log.error(`Failed to set brightness for segment ${segmentIndex}:`, error);
      throw error;
    }
  }

  /**
   * Set the RGB color
   */
  public async setColor(r: number, g: number, b: number): Promise<void> {
    try {
      const payload: any = {
        seg: {
          id: 0,
          col: [[r, g, b]],
        },
      };

      // If a preset is currently active (>0), moving the color slider should switch back to
      // manual color mode: clear the preset and disable any running effect (fx=0).
      if (this.activePresetId > 0) {
        payload.ps = 0;
        payload.seg.fx = 0;
        this.activePresetId = 0;
        this.state.presetId = 0;
        this.state.effect = 0;
      }

      await this.sendState(payload);

      this.state.color = { r, g, b };
      const { h, s } = rgbToHsv(r, g, b);
      this.state.hue = h;
      this.state.saturation = s;
      this.state.colorMode = 'rgb';
      this.notifyListeners();
    } catch (error) {
      this.log.error('Failed to set color:', error);
      throw error;
    }
  }

  /**
   * Set segment color
   */
  public async setSegmentColor(segmentIndex: number, r: number, g: number, b: number): Promise<void> {
    try {
      await this.applySegmentUpdate(segmentIndex, { col: [[r, g, b]] }, seg => {
        seg.color = { r, g, b };
        const { h, s } = rgbToHsv(r, g, b);
        seg.hue = h;
        seg.saturation = s;
        seg.colorMode = 'rgb';
      });
    } catch (error) {
      this.log.error(`Failed to set color for segment ${segmentIndex}:`, error);
      throw error;
    }
  }

  /**
   * Set the HSV color
   */
  public async setHSV(hue: number, saturation: number, value: number): Promise<void> {
    try {
      const { r, g, b } = hsvToRgb(hue, saturation, value);
      await this.setColor(r, g, b);
    } catch (error) {
      this.log.error('Failed to set HSV color:', error);
      throw error;
    }
  }

  /**
   * Set color temperature in Mireds (153-500)
   */
  public async setColorTemperature(mireds: number): Promise<void> {
    try {
      const clamped = clampMireds(mireds);
      await this.sendState({ seg: [{ id: 0, cct: miredsToCct(clamped) }] });
      this.state.colorTemperature = clamped;
      this.state.colorMode = 'ct';
      this.notifyListeners();
    } catch (error) {
      this.log.error('Failed to set color temperature:', error);
      throw error;
    }
  }

  /**
   * Force an immediate HTTP state refresh (useful on startup)
   */
  public refreshState(): void {
    this.updateStateViaHTTP().catch(error => {
      this.log.debug('Error refreshing WLED state:', error);
    });
  }

  /**
   * Set segment HSV color
   */
  public async setSegmentHSV(segmentIndex: number, hue: number, saturation: number, value: number): Promise<void> {
    try {
      const { r, g, b } = hsvToRgb(hue, saturation, value);
      await this.setSegmentColor(segmentIndex, r, g, b);
    } catch (error) {
      this.log.error(`Failed to set HSV color for segment ${segmentIndex}:`, error);
      throw error;
    }
  }

  /**
   * Get the device info from WLED
   */
  public async getDeviceInfo(): Promise<WLEDInfo> {
    try {
      const info = await fetchWledInfo(this.host, this.port, 5000);
      if (!info) {
        throw new Error('Failed to fetch device info');
      }

      this.info = {
        name: info.name || 'WLED',
        version: info.version,
        mac: info.mac,
        segmentCount: info.segmentCount,
        ledCount: info.ledCount,
      };

      return this.info;
    } catch (error) {
      this.log.error('Failed to get device info:', error);
      throw error;
    }
  }

  /**
   * Get array of segments from the device
   */
  public async getSegments(): Promise<WLEDSegment[]> {
    try {
      if (this.segments.length > 0) {
        return this.segments;
      }
      await this.updateStateViaHTTP();
      return this.segments;
    } catch (error) {
      this.log.error('Failed to get segments:', error);
      throw error;
    }
  }

  /**
   * Get available effects
   */
  public async getEffects(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/effects`);
      const data = response.data;
      return Array.isArray(data) ? data : [];
    } catch (error) {
      this.log.error('Failed to get effects:', error);
      throw error;
    }
  }

  /**
   * Set the current effect by index
   */
  public async setEffect(effectIndex: number): Promise<void> {
    try {
      await this.sendState({
        seg: {
          id: 0,
          fx: effectIndex,
        },
      });
      this.state.effect = effectIndex;
      this.notifyListeners();
    } catch (error) {
      this.log.error('Failed to set effect:', error);
      throw error;
    }
  }

  /**
   * Set effect for a specific segment
   */
  public async setSegmentEffect(segmentIndex: number, effectIndex: number): Promise<void> {
    try {
      await this.applySegmentUpdate(segmentIndex, { fx: effectIndex });
    } catch (error) {
      this.log.error(`Failed to set effect for segment ${segmentIndex}:`, error);
      throw error;
    }
  }

  private presets: Record<string, { name: string; data: any }> = {};
  private presetListeners: Array<(presets: Record<string, { name: string; data: any }>) => void> = [];
  private activePresetId = -1; // No preset active by default

  /**
   * Get available presets
   */
  public async getPresets(): Promise<Record<string, { name: string; data: any }>> {
    try {
      if (Object.keys(this.presets).length > 0) {
        return this.presets;
      }

      const response = await axios.get(`http://${this.host}:${this.port}/presets.json`);
      const parsed = parsePresetsRaw(response.data || {});

      this.presets = {};
      for (const [id, preset] of Object.entries(parsed)) {
        this.presets[id] = {
          name: preset.name,
          data: preset.data,
        };
      }

      this.notifyPresetListeners();
      return this.presets;
    } catch (error: any) {
      if (error.response?.status === 501) {
        this.log.debug('Presets endpoint not supported by this WLED device');
      } else if (error.response?.status === 404) {
        this.log.debug('No presets configured on WLED device');
      } else {
        this.log.warn('Failed to get presets:', error.message || error);
      }
      return {};
    }
  }

  /**
   * Get active preset ID
   */
  public getActivePresetId(): number {
    return this.activePresetId;
  }

  /**
   * Register a listener for preset changes
   */
  public addPresetListener(listener: (presets: Record<string, { name: string; data: any }>) => void): void {
    this.presetListeners.push(listener);
  }

  /**
   * Remove a preset listener
   */
  public removePresetListener(listener: (presets: Record<string, { name: string; data: any }>) => void): void {
    const index = this.presetListeners.indexOf(listener);
    if (index >= 0) {
      this.presetListeners.splice(index, 1);
    }
  }

  /**
   * Notify all preset listeners
   */
  private notifyPresetListeners(): void {
    for (const listener of this.presetListeners) {
      try {
        listener(this.presets);
      } catch (error) {
        this.log.error('Error in preset listener:', error);
      }
    }
  }

  /**
   * Activate a preset by ID
   */
  public async activatePreset(presetId: number): Promise<void> {
    try {
      await this.sendState({ ps: presetId });

      this.activePresetId = presetId;
      this.state.presetId = presetId;
      this.notifyListeners();

      if (!(this.useWebSockets && this.isConnected)) {
        await this.updateStateViaHTTP();
      }
    } catch (error) {
      this.log.error('Failed to activate preset:', error);
      throw error;
    }
  }
}
