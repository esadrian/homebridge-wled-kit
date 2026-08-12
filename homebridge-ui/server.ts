import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import axios from 'axios';

// Runtime requires from compiled plugin dist (sibling of homebridge-ui/)
const {
  parsePresetsRaw,
  fetchWledInfo,
  isWledCachedAccessory,
} = require('../shared/wledUtils');
const { HyperHDRClient } = require('../device/hyperHDRClient');

/** Shape matches `DiscoveredWLEDDevice` from `src/discovery/discoveryService`. */
type DiscoveredWLEDDevice = {
  name: string;
  host: string;
  port: number;
  id: string;
  discoveryMethod: 'mdns' | 'ssdp' | 'direct';
  info?: {
    version: string;
    macAddress: string;
    ledCount: number;
  };
};

/**
 * Custom UI Server for discovering and managing WLED devices
 */
class PluginUiServer extends HomebridgePluginUiServer {
  private discoveryService: any;
  private discoveredDevices: DiscoveredWLEDDevice[] = [];
  private isDiscovering = false;
  private isInitialized = false;

  constructor() {
    super();

    this.onRequest('/test', async () => {
      return { status: 'ok', message: 'Test endpoint works!' };
    });

    this.onRequest('/discover', this.handleDiscover.bind(this));
    this.onRequest('/devices', this.handleGetDevices.bind(this));
    this.onRequest('/stop-discovery', this.handleStopDiscovery.bind(this));
    this.onRequest('/cached-accessories', this.handleGetCachedAccessories.bind(this));
    this.onRequest('/remove-cached-accessory', this.handleRemoveCachedAccessory.bind(this));
    this.onRequest('/get-presets', this.handleGetPresets.bind(this));
    this.onRequest('/ping-device', this.handlePingDevice.bind(this));
    this.onRequest('/disable-sync', this.handleDisableSync.bind(this));
    this.onRequest('/add-by-ip', this.handleAddByIp.bind(this));
    this.onRequest('/ping-hyperhdr', this.handlePingHyperHDR.bind(this));
    this.onRequest('/get-effects', this.handleGetEffects.bind(this));

    process.nextTick(() => {
      this.ready();
    });

    this.initializeDiscoveryService().then(() => {
      this.isInitialized = true;
    }).catch((error) => {
      console.error('[UI Server] Failed to initialize discovery service:', error);
    });
  }

  private async initializeDiscoveryService() {
    try {
      const { WLEDDiscoveryService } = require('../discovery/discoveryService');

      const logger = {
        info: (...args: any[]) => console.log('[Discovery]', ...args),
        warn: (...args: any[]) => console.warn('[Discovery]', ...args),
        error: (...args: any[]) => console.error('[Discovery]', ...args),
        debug: (..._args: any[]) => {},
        log: (...args: any[]) => console.log('[Discovery]', ...args),
        success: (...args: any[]) => console.log('[Discovery Success]', ...args),
      };

      this.discoveryService = new WLEDDiscoveryService(logger);

      this.discoveryService.addDiscoveryListener((devices: DiscoveredWLEDDevice[]) => {
        this.discoveredDevices = devices;
        this.pushEvent('discoveredDevices', devices);
      });
    } catch (error) {
      console.error('[UI Server] Failed to initialize discovery service:', error);
      throw error;
    }
  }

  async handleDiscover() {
    if (!this.isInitialized || !this.discoveryService) {
      return {
        status: 'error',
        message: 'Discovery service not initialized. Please wait a moment and try again.',
        devices: [],
      };
    }

    if (this.isDiscovering) {
      return {
        status: 'already_running',
        devices: this.discoveredDevices,
      };
    }

    try {
      this.discoveredDevices = [];
      this.discoveryService.clearDiscoveredDevices();

      this.isDiscovering = true;
      this.discoveryService.startDiscovery();

      setTimeout(() => {
        this.isDiscovering = false;
        if (this.discoveryService) {
          this.discoveryService.stopDiscovery();
        }
      }, 70000);

      return {
        status: 'started',
        devices: this.discoveredDevices,
      };
    } catch (error: any) {
      this.isDiscovering = false;
      console.error('[UI Server] Error starting discovery:', error);
      return {
        status: 'error',
        message: error.message || 'Failed to start discovery',
        devices: [],
      };
    }
  }

  async handleGetDevices() {
    return {
      devices: this.discoveredDevices,
      isDiscovering: this.isDiscovering,
    };
  }

  async handleStopDiscovery() {
    if (!this.discoveryService) {
      throw new Error('Discovery service not initialized');
    }

    this.discoveryService.stopDiscovery();
    this.isDiscovering = false;

    return {
      status: 'stopped',
      devices: this.discoveredDevices,
    };
  }

  private listCachedAccessoryFiles(accessoriesDir: string): string[] {
    const fs = require('fs');
    if (!fs.existsSync(accessoriesDir)) {
      return [];
    }
    return fs.readdirSync(accessoriesDir).filter((f: string) =>
      f === 'cachedAccessories' || f.startsWith('cachedAccessories.'),
    );
  }

  async handleGetCachedAccessories() {
    try {
      const fs = require('fs');
      const path = require('path');

      const storagePath = this.homebridgeStoragePath;
      const accessoriesDir = path.join(storagePath, 'accessories');
      const files = this.listCachedAccessoryFiles(accessoriesDir);

      const all: any[] = [];
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(accessoriesDir, file), 'utf8'));
          if (Array.isArray(raw)) {
            all.push(...raw);
          }
        } catch (e) {
          console.error(`[UI Server] Failed reading ${file}:`, e);
        }
      }

      const wledAccessories = all.filter(isWledCachedAccessory);
      const seen = new Set<string>();
      const devices = [];
      for (const accessory of wledAccessories) {
        const host = accessory.context?.device?.host || 'Unknown';
        const key = `${host}|${accessory.UUID}`;
        if (seen.has(key)) continue;
        seen.add(key);
        devices.push({
          name: accessory.displayName || accessory.context?.device?.name || 'Unknown',
          host,
          port: accessory.context?.device?.port || 80,
          uuid: accessory.UUID,
          usePresetService: accessory.context?.device?.usePresetService !== false,
          useWebSockets: accessory.context?.device?.useWebSockets !== false,
        });
      }

      return { accessories: devices };
    } catch (error: any) {
      console.error('[UI Server] Error reading cached accessories:', error);
      return {
        accessories: [],
        error: error.message,
      };
    }
  }

  async handleRemoveCachedAccessory(payload: { host: string }) {
    try {
      const fs = require('fs');
      const path = require('path');

      const storagePath = this.homebridgeStoragePath;
      const accessoriesDir = path.join(storagePath, 'accessories');
      const files = this.listCachedAccessoryFiles(accessoriesDir);
      let removed = 0;

      for (const file of files) {
        const filePath = path.join(accessoriesDir, file);
        try {
          const cachedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (!Array.isArray(cachedData)) continue;
          const filtered = cachedData.filter((accessory: any) => {
            const matchesHost = accessory.context?.device?.host === payload.host;
            return !(isWledCachedAccessory(accessory) && matchesHost);
          });
          removed += cachedData.length - filtered.length;
          fs.writeFileSync(filePath, JSON.stringify(filtered));
        } catch (e) {
          console.error(`[UI Server] Failed updating ${file}:`, e);
        }
      }

      return { status: 'ok', removed };
    } catch (error: any) {
      console.error('[UI Server] Error removing cached accessory:', error);
      return { status: 'error', message: error.message };
    }
  }

  private async readSyncStatus(host: string, port: number): Promise<{
    sendEnabled: boolean;
    recvEnabled: boolean;
    group: number | null;
  } | null> {
    try {
      const response = await axios.get(`http://${host}:${port}/json/cfg`, { timeout: 3000 });
      const sync = response.data?.if?.sync || {};
      const send = sync.send || {};
      const recv = sync.recv || {};
      const recvEnabled = !!(recv.bri || recv.col || recv.fx || recv.pal || recv.seg || recv.sb);
      return {
        sendEnabled: send.en === true,
        recvEnabled,
        group: typeof send.grp === 'number' ? send.grp : (typeof recv.grp === 'number' ? recv.grp : null),
      };
    } catch {
      return null;
    }
  }

  async handlePingDevice(payload: { host: string; port?: number }) {
    try {
      const host = payload?.host;
      const port = payload?.port || 80;

      if (!host) {
        return { online: false, message: 'Host is required' };
      }

      const info = await fetchWledInfo(host, port, 3000);
      if (!info) {
        return { online: false, message: 'Unreachable' };
      }
      const sync = await this.readSyncStatus(host, port);
      return {
        online: true,
        version: info.version,
        mac: info.mac,
        ledCount: info.ledCount,
        segmentCount: info.segmentCount,
        sync,
      };
    } catch (error: any) {
      return {
        online: false,
        message: error?.code || error?.message || 'Unreachable',
      };
    }
  }

  async handleDisableSync(payload: { host: string; port?: number }) {
    try {
      const host = (payload?.host || '').trim();
      const port = payload?.port || 80;
      if (!host) {
        return { status: 'error', message: 'Host is required' };
      }

      await axios.post(`http://${host}:${port}/json/cfg`, {
        if: {
          sync: {
            send: { en: false, dir: false, btn: false, va: false, hue: false },
            recv: { bri: false, col: false, fx: false, pal: false, seg: false, sb: false },
          },
        },
      }, { timeout: 5000 });

      const sync = await this.readSyncStatus(host, port);
      const stillActive = !!(sync && (sync.sendEnabled || sync.recvEnabled));
      return {
        status: stillActive ? 'error' : 'ok',
        message: stillActive
          ? 'WLED did not clear sync settings'
          : 'UDP Sync disabled on this device',
        sync,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error?.code || error?.message || 'Failed to disable sync',
      };
    }
  }

  async handleAddByIp(payload: { host: string; port?: number }) {
    try {
      if (!this.isInitialized || !this.discoveryService) {
        return { status: 'error', message: 'Discovery service not ready' };
      }
      const host = (payload?.host || '').trim();
      const port = payload?.port || 80;
      if (!host) {
        return { status: 'error', message: 'Host is required' };
      }
      const device = await this.discoveryService.addDeviceByHost(host, port);
      if (!device) {
        return { status: 'error', message: 'No WLED device responded at that address' };
      }
      this.discoveredDevices = this.discoveryService.getDiscoveredDevices();
      this.pushEvent('discoveredDevices', this.discoveredDevices);
      return { status: 'success', device };
    } catch (error: any) {
      return { status: 'error', message: error?.message || 'Failed to add device' };
    }
  }

  async handlePingHyperHDR(payload: {
    host: string;
    port?: number;
    token?: string;
    component?: string;
  }) {
    try {
      const host = (payload?.host || '').trim();
      if (!host) {
        return { online: false, message: 'Host is required' };
      }
      return await HyperHDRClient.pingOnce({
        host,
        port: payload?.port,
        token: payload?.token,
        component: payload?.component,
      });
    } catch (error: any) {
      return { online: false, message: error?.code || error?.message || 'Unreachable' };
    }
  }

  async handleGetEffects(payload: { host: string; port?: number }) {
    try {
      const host = payload?.host;
      const port = payload?.port || 80;
      if (!host) {
        return { status: 'error', message: 'Host is required', effects: [] };
      }
      const response = await axios.get(`http://${host}:${port}/json/effects`, { timeout: 8000 });
      const effects = Array.isArray(response.data) ? response.data : [];
      return { status: 'success', effects };
    } catch (error: any) {
      return { status: 'error', message: error?.message || 'Failed to fetch effects', effects: [] };
    }
  }

  async handleGetPresets(payload: { host: string; port: number }) {
    try {
      const { host, port } = payload;

      if (!host) {
        return {
          status: 'error',
          message: 'Host is required',
          presets: {},
        };
      }

      const presetPort = port || 80;
      const url = `http://${host}:${presetPort}/presets.json`;
      const response = await axios.get(url, { timeout: 10000 });
      const parsed = parsePresetsRaw(response.data || {}, { skipZero: true });

      const presets: Record<string, { id: string; name: string; quickLabel?: string; data: any }> = {};
      for (const [id, preset] of Object.entries(parsed) as Array<[string, { name: string; quickLabel: string; data: any }]>) {
        const n = preset.data?.n || `Preset ${id}`;
        presets[id] = {
          id,
          name: n,
          quickLabel: preset.quickLabel || undefined,
          data: preset.data,
        };
      }

      return {
        status: 'success',
        presets,
      };
    } catch (error: any) {
      console.error('[UI Server] Error fetching presets:', error);

      if (error.response?.status === 404 || error.response?.status === 501) {
        return {
          status: 'success',
          presets: {},
          message: 'No presets configured on this device',
        };
      }

      return {
        status: 'error',
        message: error.message || 'Failed to fetch presets',
        presets: {},
      };
    }
  }
}

const serverInstance = new PluginUiServer();

export default serverInstance;
module.exports = serverInstance;
