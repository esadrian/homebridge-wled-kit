import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { WLEDPlatform } from './platform';
import { WLEDDevice, WLEDState } from './wledDevice';

/**
 * WLED Presets Accessory
 * Handles the Television service: power state and preset selection via input sources.
 */
export class WLEDPresetsAccessory {
  private presetsService: Service;
  private inputServices: Service[] = [];

  private presetInputMap: Map<number, number> = new Map();
  private inputPresetMap: Map<number, number> = new Map();
  private currentActiveInput = 0;

  private stateListener = (state: WLEDState) => {
    this.updateStateFromDevice(state);
  };

  private presetListener = (presets: Record<string, { name: string; data: any }>) => {
    this.updateInputSources(presets);
  };

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WLED')
      .setCharacteristic(this.platform.Characteristic.Model, 'WLED Presets')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.host + '-tv');

    this.presetsService = this.accessory.getService(this.platform.Service.Television) ||
      this.accessory.addService(this.platform.Service.Television);

    this.presetsService
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, `${accessory.context.device.name} ${this.platform.getTvNameSuffix()}`)
      .setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    this.presetsService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getTVActive.bind(this))
      .onSet(this.setTVActive.bind(this));

    this.presetsService.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .onSet(this.setRemoteKey.bind(this));

    this.wledDevice.addStateListener(this.stateListener);
    this.wledDevice.addPresetListener(this.presetListener);

    this.initializePresets();

    const currentState = this.wledDevice.getState();
    this.updateStateFromDevice(currentState);
  }

  private async initializePresets(): Promise<void> {
    try {
      this.platform.log.debug('Fetching presets from WLED device...');
      const presets = await this.wledDevice.getPresets();

      this.platform.log.debug(`Presets response received: ${JSON.stringify(presets)}`);
      this.platform.log.debug(`Number of presets found: ${Object.keys(presets).length}`);

      if (Object.keys(presets).length === 0) {
        this.platform.log.warn('No presets configured on WLED device - presets object is empty');
        return;
      }

      this.updateInputSources(presets);
    } catch (error) {
      this.platform.log.error('Failed to initialize presets:', error);
    }
  }

  private updateInputSources(presets: Record<string, { name: string; data: any }>): void {
    this.presetInputMap.clear();
    this.inputPresetMap.clear();

    for (const inputService of this.inputServices) {
      this.presetsService.removeLinkedService(inputService);
      this.accessory.removeService(inputService);
    }
    this.inputServices = [];

    // Always expose a "Custom" input (Identifier 0) to represent manual/no-preset mode.
    // This lets users switch out of presets without touching the color slider.
    this.presetInputMap.set(0, 0);
    this.inputPresetMap.set(0, 0);

    const customSubtype = 'preset-0-custom';
    const customLabel = this.platform.getCustomInputLabel();
    const customInputService = this.accessory.getServiceById(this.platform.Service.InputSource, customSubtype) ||
      this.accessory.addService(this.platform.Service.InputSource, customLabel, customSubtype);

    customInputService
      .setCharacteristic(this.platform.Characteristic.Identifier, 0)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, customLabel)
      .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.HDMI);

    customInputService.subtype = customSubtype;
    this.presetsService.addLinkedService(customInputService);
    this.inputServices.push(customInputService);

    let enabledPresets: string[] = [];

    if (this.accessory.context.device?.deviceSettings?.enabledPresets) {
      enabledPresets = this.accessory.context.device.deviceSettings.enabledPresets;
      this.platform.log.debug(`[Presets] Loaded enabledPresets from context for ${this.accessory.displayName}: ${JSON.stringify(enabledPresets)}`);
    } else {
      const devices = this.platform.config.manualDevicesSection?.devices || this.platform.config.devices || [];
      const deviceHost = this.accessory.context.device?.host;
      this.platform.log.debug(`[Presets] Looking up device by host: ${deviceHost} in ${devices.length} devices`);
      const configuredDevice = devices.find((d: any) => d.host === deviceHost);
      if (configuredDevice?.deviceSettings?.enabledPresets) {
        enabledPresets = configuredDevice.deviceSettings.enabledPresets;
        this.platform.log.debug(`[Presets] Loaded enabledPresets from platform config for ${this.accessory.displayName}: ${JSON.stringify(enabledPresets)}`);
      } else {
        this.platform.log.debug(`[Presets] No enabledPresets found in platform config for ${deviceHost}`);
      }
    }

    const filterByEnabled = enabledPresets.length > 0;

    this.platform.log.debug(`[Presets] Enabled presets for ${this.accessory.displayName}: ${JSON.stringify(enabledPresets)} (filterByEnabled=${filterByEnabled})`);

    for (const [presetIdStr, preset] of Object.entries(presets)) {
      const presetId = parseInt(presetIdStr, 10);
      this.platform.log.debug(`[Presets] Processing preset "${presetIdStr}" (parsed=${presetId}, isNaN=${isNaN(presetId)})`);

      if (isNaN(presetId)) {
        this.platform.log.warn(`[Presets] Skipping preset with non-numeric ID: "${presetIdStr}"`);
        continue;
      }

      // Preset 0 is reserved for manual/no-preset mode and is exposed as "Custom" above.
      if (presetId === 0) {
        this.platform.log.debug('Skipping preset 0 from WLED preset list (exposed separately as Custom)');
        continue;
      }

      if (filterByEnabled && !enabledPresets.includes(presetIdStr)) {
        this.platform.log.debug(`Skipping preset ${presetId} - not in enabled presets list`);
        continue;
      }

      this.platform.log.debug(`[Presets] Preset ${presetId} metadata - n="${preset.data?.n}", ql="${preset.data?.ql}"`);

      this.presetInputMap.set(presetId, presetId);
      this.inputPresetMap.set(presetId, presetId);

      const serviceName = `Preset ${presetId}`;
      const subtype = `preset-${presetId}`;
      const n = preset.data?.n || `Preset ${presetId}`;
      const ql = preset.data?.ql || '';
      const label = (ql ? `${ql} ` : '') + `${n}`;

      this.platform.log.debug(`[Presets] Creating preset input - id=${presetId}, serviceName="${serviceName}", label="${label}" (ql="${ql}", n="${n}")`);

      // IMPORTANT: InputSource services must have a stable subtype; otherwise HomeKit/TV inputs
      // can drift or duplicate when the preset label changes.
      const inputService = this.accessory.getServiceById(this.platform.Service.InputSource, subtype) ||
        this.accessory.addService(this.platform.Service.InputSource, serviceName, subtype);

      inputService
        .setCharacteristic(this.platform.Characteristic.Identifier, presetId)
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, label)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.InputSourceType,
          this.platform.Characteristic.InputSourceType.HDMI);

      inputService.subtype = subtype;

      this.presetsService.addLinkedService(inputService);
      this.inputServices.push(inputService);
    }

    this.presetsService
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onGet(async () => {
        const activePresetId = this.wledDevice.getActivePresetId();
        return activePresetId > 0 ? activePresetId : 0;
      })
      .onSet(async (value: CharacteristicValue) => {
        const presetId = value as number;
        this.platform.log.debug(`[Presets] ActiveIdentifier set to: ${presetId} for ${this.accessory.displayName}`);
        if (presetId === 0) {
          // Allow clearing preset even though preset 0 is not exposed as an input source.
          this.currentActiveInput = 0;
          await this.wledDevice.activatePreset(0);
          return;
        }

        if (this.presetInputMap.has(presetId)) {
          this.currentActiveInput = presetId;
          await this.wledDevice.activatePreset(presetId);
        } else {
          this.platform.log.warn(`[DEBUG] Preset ID ${presetId} not found in presetInputMap`);
        }
      });

    const createdPresets = Array.from(this.presetInputMap.keys()).join(', ');
    this.platform.log.debug(`Created ${this.inputServices.length} preset inputs for ${this.accessory.displayName}: [${createdPresets}]`);

    this.platform.api.updatePlatformAccessories([this.accessory]);
  }

  private updateStateFromDevice(state: WLEDState): void {
    this.presetsService.updateCharacteristic(
      this.platform.Characteristic.Active,
      state.on ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
    );

    const activePresetId = this.wledDevice.getActivePresetId();
    if (activePresetId > 0 && this.presetInputMap.has(activePresetId)) {
      if (activePresetId !== this.currentActiveInput) {
        this.currentActiveInput = activePresetId;
        this.platform.log.debug(`Updating ActiveIdentifier to: ${activePresetId}`);
        this.presetsService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, activePresetId);
      }
    } else if (activePresetId <= 0) {
      this.platform.log.debug('No active preset, setting ActiveIdentifier to 0');
      this.presetsService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, 0);
    }
  }

  async getTVActive(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    return state.on
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  async setTVActive(value: CharacteristicValue): Promise<void> {
    const isActive = value === this.platform.Characteristic.Active.ACTIVE;
    await this.wledDevice.setPower(isActive);
  }

  async setRemoteKey(_value: CharacteristicValue): Promise<void> {
    // No-op: remote key presses are not handled
  }
}
