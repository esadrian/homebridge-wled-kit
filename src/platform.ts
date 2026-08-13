import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, Categories } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './shared/settings';
import { WLEDLightAccessory } from './accessories/platformAccessory';
import { WLEDPresetsAccessory } from './accessories/presetsAccessory';
import { WLEDCombinedAccessory } from './accessories/combinedAccessory';
import { WLEDNightlightAccessory } from './accessories/nightlightAccessory';
import { WLEDSegmentAccessory } from './accessories/segmentAccessory';
import { WLEDEffectsAccessory } from './accessories/effectsAccessory';
import { WLEDDevice } from './device/wledDevice';
import { WLEDDiscoveryService, DiscoveredWLEDDevice } from './discovery/discoveryService';
import { HyperHDRClient, HyperHDRConfig } from './device/hyperHDRClient';
import {
  getDevicesFromConfig,
  resolveDisplayName,
  resolveNightlightConfig,
  resolveDeviceSettings,
  resolveDiscoveryDefaults,
} from './shared/wledUtils';
import {
  DeviceConfig,
  DeviceSettings,
  WLEDPlatformConfig,
} from './shared/configTypes';
import { PlatformContext } from './shared/platformContext';

interface RegisterDeviceParams {
  host: string;
  port: number;
  displayName: string;
  deviceSettings: DeviceSettings;
  deviceContext: Record<string, unknown>;
  /** When true, update restored accessory display names and wire HyperHDR. */
  isManual: boolean;
  /** Original config entry (manual) for preset-change detection. */
  configDevice?: DeviceConfig;
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class WLEDPlatform implements DynamicPlatformPlugin, PlatformContext {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly log: Logger;
  public readonly config: WLEDPlatformConfig;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  // keyed by device host
  public readonly wledDevices: Map<string, WLEDDevice> = new Map();

  // keyed by WLED device host — one HyperHDR client per configured device (no cross-talk)
  private readonly hyperHDRClients: Map<string, HyperHDRClient> = new Map();

  // discovery service
  private discoveryService: WLEDDiscoveryService;

  constructor(
    log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = config as WLEDPlatformConfig;
    this.log = this.createFilteredLogger(log, this.config.logLevel);
    this.log.debug('Finished initializing platform:', this.config.name);
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    // Initialize the discovery service
    this.discoveryService = new WLEDDiscoveryService(this.log);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');

      // Register for discovery events (needed for UI-triggered discovery)
      this.discoveryService.addDiscoveryListener(this.handleDiscoveredDevices.bind(this));

      // Note: Automatic discovery is disabled. Discovery is only triggered via the Custom UI.
      // This prevents unnecessary network scanning on every Homebridge restart.

      // Process manually configured devices
      this.discoverDevices();
    });
  }

  /**
   * Apply config.logLevel on top of Homebridge's logger (debug/info/warn/error).
   */
  private createFilteredLogger(base: Logger, level: unknown): Logger {
    const order = ['error', 'warn', 'info', 'debug'] as const;
    const configured = typeof level === 'string' ? level.toLowerCase() : 'info';
    const minIdx = Math.max(0, order.indexOf(configured as typeof order[number]));
    const allow = (method: typeof order[number]) => order.indexOf(method) <= minIdx;
    const forward = (fn: (...a: any[]) => void, method: typeof order[number]) =>
      (...args: any[]) => { if (allow(method)) fn(...args); };

    const anyBase = base as any;
    return {
      debug: forward(base.debug.bind(base), 'debug'),
      info: forward(base.info.bind(base), 'info'),
      warn: forward(base.warn.bind(base), 'warn'),
      error: forward(base.error.bind(base), 'error'),
      log: forward((typeof anyBase.log === 'function' ? anyBase.log.bind(base) : base.info.bind(base)), 'info'),
      success: forward((typeof anyBase.success === 'function' ? anyBase.success.bind(base) : base.info.bind(base)), 'info'),
    } as Logger;
  }

  public getTvNameSuffix(): string {
    const suffix = this.config.tvNameSuffix;
    return (typeof suffix === 'string' && suffix.trim().length > 0) ? suffix.trim() : 'Presets';
  }

  public getCustomInputLabel(): string {
    const label = this.config.customInputLabel;
    return (typeof label === 'string' && label.trim().length > 0) ? label.trim() : 'Custom';
  }

  private buildHyperHDRClient(deviceHost: string, deviceSettings: DeviceSettings): HyperHDRClient | undefined {
    // Always stop any previous client for this host (config reload / reconfigure).
    const previous = this.hyperHDRClients.get(deviceHost);
    if (previous) {
      previous.stopPolling();
      this.hyperHDRClients.delete(deviceHost);
    }

    const cfg = deviceSettings.hyperHDR;
    if (!cfg?.enabled || !cfg.host) return undefined;

    const client = new HyperHDRClient(this.log, {
      enabled: true,
      host: cfg.host,
      port: cfg.port || 8090,
      component: (cfg.component || 'LEDDEVICE') as HyperHDRConfig['component'],
      token: cfg.token || undefined,
      pollInterval: typeof cfg.pollInterval === 'number' ? cfg.pollInterval : undefined,
    });
    this.hyperHDRClients.set(deviceHost, client);
    return client;
  }

  /** Stop HyperHDR polling for a WLED host (no effect on other devices). */
  private releaseHyperHDRClient(deviceHost: string): void {
    const client = this.hyperHDRClients.get(deviceHost);
    if (client) {
      client.stopPolling();
      this.hyperHDRClients.delete(deviceHost);
    }
  }

  private getConfiguredDevices(): DeviceConfig[] {
    return getDevicesFromConfig(this.config);
  }

  private getGlobalNightlight() {
    return this.config.manualDevicesSection?.nightlight || {};
  }

  /**
   * Restore or create a platform accessory with shared boilerplate.
   */
  private ensureAccessory(opts: {
    uuid: string;
    displayName: string;
    category?: Categories;
    context: any;
    updateDisplayName?: boolean;
    kind?: string;
    factory: (accessory: PlatformAccessory) => void;
  }): PlatformAccessory {
    const kindLabel = opts.kind || 'accessory';
    const existing = this.accessories.find(a => a.UUID === opts.uuid);
    if (existing) {
      this.log.info(`Restoring existing ${kindLabel} accessory from cache:`, existing.displayName);
      if (opts.updateDisplayName && existing.displayName !== opts.displayName) {
        this.log.info(`Updating display name from "${existing.displayName}" to "${opts.displayName}"`);
        existing.displayName = opts.displayName;
      }
      existing.context.device = opts.context;
      opts.factory(existing);
      this.api.updatePlatformAccessories([existing]);
      return existing;
    }

    this.log.info(`Adding new ${kindLabel} accessory:`, opts.displayName);
    const accessory = opts.category !== undefined
      ? new this.api.platformAccessory(opts.displayName, opts.uuid, opts.category)
      : new this.api.platformAccessory(opts.displayName, opts.uuid);
    accessory.context.device = opts.context;
    opts.factory(accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    if (!this.accessories.find(a => a.UUID === opts.uuid)) {
      this.accessories.push(accessory);
    }
    return accessory;
  }

  private unregisterByUuid(uuid: string, reason: string): void {
    const existing = this.accessories.find(a => a.UUID === uuid);
    if (!existing) {
      return;
    }
    this.log.info(reason);
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existing]);
    this.accessories.splice(this.accessories.findIndex(a => a.UUID === uuid), 1);
  }

  /**
   * Whether presets should be exposed (standalone TV or via Combined accessory).
   */
  private shouldExposePresets(deviceSettings: DeviceSettings, forDiscovered = false): boolean {
    if (deviceSettings.usePresetService !== undefined) {
      return deviceSettings.usePresetService !== false;
    }
    if (forDiscovered) {
      return resolveDiscoveryDefaults(this.config).usePresetService;
    }
    return true;
  }

  private lightUuid(host: string): string {
    return this.api.hap.uuid.generate(host + ':light');
  }

  private tvUuid(host: string): string {
    return this.api.hap.uuid.generate(host + ':tv');
  }

  private nightlightUuid(host: string): string {
    return this.api.hap.uuid.generate(host + ':nightlight');
  }

  private segmentUuid(host: string, segmentIndex: number): string {
    return this.api.hap.uuid.generate(`${host}:seg:${segmentIndex}`);
  }

  private effectsUuid(host: string): string {
    return this.api.hap.uuid.generate(host + ':effects');
  }

  private readonly MAX_SEGMENTS = 8;

  private async registerSegmentsAndEffects(
    host: string,
    displayName: string,
    deviceContext: Record<string, unknown>,
    deviceSettings: DeviceSettings,
    wledDevice: WLEDDevice,
  ): Promise<void> {
    const exposeSegments = deviceSettings.exposeSegments === true;
    const exposeEffects = deviceSettings.exposeEffects === true;

    const existingSegs = this.accessories.filter(a =>
      a.context?.device?.host === host && typeof a.context?.device?.segmentIndex === 'number',
    );

    if (exposeSegments) {
      try {
        const segments = await wledDevice.getSegments();
        const indices = segments
          .map((s, i) => (typeof s.id === 'number' ? s.id : i))
          .filter((id) => id > 0)
          .slice(0, this.MAX_SEGMENTS);

        const keep = new Set(indices.map(i => this.segmentUuid(host, i)));
        for (const acc of existingSegs) {
          if (!keep.has(acc.UUID)) {
            this.unregisterByUuid(acc.UUID, `Removing stale segment accessory ${acc.displayName}`);
          }
        }

        for (const segIndex of indices) {
          const uuid = this.segmentUuid(host, segIndex);
          const segName = segments[segIndex]?.name || `Segment ${segIndex}`;
          this.ensureAccessory({
            uuid,
            displayName: `${displayName} ${segName}`,
            context: { ...deviceContext, segmentIndex: segIndex },
            kind: 'segment',
            factory: (accessory) => new WLEDSegmentAccessory(this, accessory, wledDevice),
          });
        }
      } catch (error) {
        this.log.warn(`Failed to expose segments for ${displayName}:`, error);
      }
    } else {
      for (const acc of existingSegs) {
        this.unregisterByUuid(acc.UUID, `Segments disabled for ${displayName}. Unregistering ${acc.displayName}...`);
      }
    }

    const effectsUuid = this.effectsUuid(host);
    if (exposeEffects) {
      this.ensureAccessory({
        uuid: effectsUuid,
        displayName: `${displayName} Effects`,
        context: deviceContext,
        kind: 'effects',
        factory: (accessory) => new WLEDEffectsAccessory(this, accessory, wledDevice),
      });
    } else {
      this.unregisterByUuid(effectsUuid, `Effects disabled for ${displayName}. Unregistering effects accessory...`);
    }
  }

  /**
   * Shared registration path for manual and discovered devices.
   */
  private registerDevice(params: RegisterDeviceParams): void {
    const { host, port, displayName, deviceSettings, deviceContext, isManual, configDevice } = params;

    const exposePresets = this.shouldExposePresets(deviceSettings, !isManual);
    const singleAccessoryWithTV = deviceSettings.singleAccessoryWithTV === true && exposePresets;
    const hyperHDRClient = isManual
      ? this.buildHyperHDRClient(host, deviceSettings)
      : undefined;

    const pollInterval = typeof deviceSettings.pollInterval === 'number'
      ? deviceSettings.pollInterval
      : 10;
    const useWebSockets = deviceSettings.useWebSockets !== false;

    const wledDevice = new WLEDDevice(
      this.log,
      host,
      port,
      pollInterval,
      useWebSockets,
    );
    this.wledDevices.set(host, wledDevice);

    const lightUuid = this.lightUuid(host);
    const tvUuid = this.tvUuid(host);
    const nightlightUuid = this.nightlightUuid(host);

    this.ensureAccessory({
      uuid: lightUuid,
      displayName,
      context: deviceContext,
      updateDisplayName: isManual,
      kind: 'light',
      factory: (accessory) => {
        if (singleAccessoryWithTV) {
          new WLEDCombinedAccessory(this, accessory, wledDevice, hyperHDRClient);
        } else {
          new WLEDLightAccessory(this, accessory, wledDevice, hyperHDRClient);
        }
      },
    });

    const nightlight = resolveNightlightConfig(deviceSettings, this.getGlobalNightlight());
    if (nightlight.enabled && nightlight.timers.length > 0) {
      this.ensureAccessory({
        uuid: nightlightUuid,
        displayName: `${displayName} Nightlight`,
        context: { ...deviceContext, deviceSettings },
        kind: 'nightlight',
        factory: (accessory) => new WLEDNightlightAccessory(this, accessory, wledDevice),
      });
    } else {
      this.unregisterByUuid(
        nightlightUuid,
        `Nightlight disabled for ${displayName}. Unregistering nightlight accessory...`,
      );
    }

    void this.registerSegmentsAndEffects(host, displayName, deviceContext, deviceSettings, wledDevice);

    const tvDisplayName = `${displayName} ${this.getTvNameSuffix()}`;

    if (singleAccessoryWithTV) {
      this.unregisterByUuid(
        tvUuid,
        `Single-accessory mode enabled for ${displayName}. Unregistering standalone TV accessory...`,
      );
      return;
    }

    if (!exposePresets) {
      this.unregisterByUuid(
        tvUuid,
        `Preset controls disabled for ${displayName}. Unregistering TV accessory...`,
      );
      return;
    }

    const existingTVAccessory = this.accessories.find(a => a.UUID === tvUuid);
    const oldEnabledPresets = existingTVAccessory?.context.device?.deviceSettings?.enabledPresets || [];
    const newEnabledPresets = configDevice?.deviceSettings?.enabledPresets
      || deviceSettings.enabledPresets
      || [];
    const presetsChanged = isManual
      && JSON.stringify([...oldEnabledPresets].sort()) !== JSON.stringify([...newEnabledPresets].sort());

    if (existingTVAccessory && presetsChanged) {
      this.log.info(`Enabled presets changed for ${displayName}. Re-registering TV accessory to force Home app refresh...`);
      this.log.debug(`Old presets: ${JSON.stringify(oldEnabledPresets)}`);
      this.log.debug(`New presets: ${JSON.stringify(newEnabledPresets)}`);

      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingTVAccessory]);

      const newTVAccessory = new this.api.platformAccessory(tvDisplayName, tvUuid, this.api.hap.Categories.TELEVISION);
      newTVAccessory.context.device = deviceContext;
      new WLEDPresetsAccessory(this, newTVAccessory, wledDevice);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [newTVAccessory]);

      const index = this.accessories.findIndex(a => a.UUID === tvUuid);
      if (index !== -1) {
        this.accessories[index] = newTVAccessory;
      } else {
        this.accessories.push(newTVAccessory);
      }
    } else {
      this.ensureAccessory({
        uuid: tvUuid,
        displayName: tvDisplayName,
        category: this.api.hap.Categories.TELEVISION,
        context: deviceContext,
        kind: 'TV',
        factory: (accessory) => new WLEDPresetsAccessory(this, accessory, wledDevice),
      });
    }
  }

  /**
   * Handle newly discovered WLED devices
   */
  private handleDiscoveredDevices(devices: DiscoveredWLEDDevice[]): void {
    this.log.info(`Discovered ${devices.length} WLED devices on the network`);

    for (const device of devices) {
      this.log.debug(`Discovery found: ${device.name} at ${device.host}:${device.port} (ID: ${device.id}, Method: ${device.discoveryMethod})`);
    }

    for (const device of devices) {
      const manualDevices = this.getConfiguredDevices();
      const isManuallyConfigured = manualDevices.some((d) =>
        d.host === device.host || (d.name && d.name === device.name),
      );

      if (isManuallyConfigured) {
        this.log.info(`Skipping discovered device ${device.name} at ${device.host} - already manually configured`);
        continue;
      }

      if (this.wledDevices.has(device.host)) {
        this.log.info(`Skipping discovered device ${device.name} at ${device.host} - accessory already exists`);
        continue;
      }

      const displayName = resolveDisplayName(device.host, device.name, device.name);
      this.log.info(`Adding discovered WLED device: ${displayName} at ${device.host}:${device.port}`);

      const defaults = resolveDiscoveryDefaults(this.config);
      const deviceSettings: DeviceSettings = {
        pollInterval: defaults.pollInterval,
        useWebSockets: defaults.useWebSockets,
        usePresetService: defaults.usePresetService,
      };

      this.registerDevice({
        host: device.host,
        port: device.port,
        displayName,
        deviceSettings,
        deviceContext: { name: displayName, host: device.host, port: device.port },
        isManual: false,
      });
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Process manually configured devices
   */
  discoverDevices() {
    const devices = this.getConfiguredDevices();

    if (devices.length === 0) {
      this.log.warn('No WLED devices configured. Use the Custom Plugin UI to discover devices or manually add them to your config.');
    }

    for (const device of devices) {
      if (!device.name || !device.host) {
        this.log.error('Device missing required fields (name and host):', device);
        continue;
      }

      const lightUuid = this.lightUuid(device.host);
      const tvUuid = this.tvUuid(device.host);
      const nightlightUuid = this.nightlightUuid(device.host);

      if (device.enabled === false) {
        this.log.info(`Skipping disabled device: ${device.name}`);
        const toRemove = this.accessories.filter(a =>
          a.UUID === lightUuid
          || a.UUID === tvUuid
          || a.UUID === nightlightUuid
          || a.UUID === this.effectsUuid(device.host)
          || (a.context?.device?.host === device.host && typeof a.context?.device?.segmentIndex === 'number'),
        );
        if (toRemove.length > 0) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRemove);
        }
        this.releaseHyperHDRClient(device.host);
        continue;
      }

      const deviceSettings = resolveDeviceSettings(device);
      const displayName = resolveDisplayName(device.host, device.name, device.name);
      const deviceContext = { ...device, name: displayName };

      this.registerDevice({
        host: device.host,
        port: device.port || 80,
        displayName,
        deviceSettings,
        deviceContext,
        isManual: true,
        configDevice: device,
      });
    }

    // Remove accessories whose device is no longer configured
    for (const accessory of this.accessories) {
      const device = accessory.context.device;
      if (!device) {
        continue;
      }

      const isConfigured = devices.some((configuredDevice) => {
        if (configuredDevice.enabled === false) return false;
        const lightUuid = this.lightUuid(configuredDevice.host);
        const tvUuid = this.tvUuid(configuredDevice.host);
        const nightlightUuid = this.nightlightUuid(configuredDevice.host);
        const effectsUuid = this.effectsUuid(configuredDevice.host);
        const settings = resolveDeviceSettings(configuredDevice);
        const exposePresets = this.shouldExposePresets(settings);
        const singleAccessoryWithTV = settings.singleAccessoryWithTV === true && exposePresets;
        const exposeSegments = settings.exposeSegments === true;
        const exposeEffects = settings.exposeEffects === true;
        const isSeg = accessory.context?.device?.host === configuredDevice.host
          && typeof accessory.context?.device?.segmentIndex === 'number';
        return accessory.UUID === lightUuid ||
          (!singleAccessoryWithTV && exposePresets && accessory.UUID === tvUuid) ||
          accessory.UUID === nightlightUuid ||
          (exposeEffects && accessory.UUID === effectsUuid) ||
          (exposeSegments && isSeg);
      });

      if (!isConfigured) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);

        const deviceHost = device.host;
        if (deviceHost && this.wledDevices.has(deviceHost)) {
          const wledDevice = this.wledDevices.get(deviceHost);
          if (wledDevice) {
            wledDevice.cleanup();
          }
          this.wledDevices.delete(deviceHost);
        }
        if (deviceHost) {
          this.releaseHyperHDRClient(deviceHost);
        }

        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
