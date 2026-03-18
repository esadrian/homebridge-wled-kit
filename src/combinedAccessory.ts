import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { WLEDPlatform } from './platform';
import { WLEDDevice, WLEDState } from './wledDevice';
import { HyperHDRClient } from './hyperHDRClient';

/**
 * WLED Combined Accessory
 * Exposes Lightbulb + Television(InputSource presets) under a single HomeKit accessory.
 */
export class WLEDCombinedAccessory {
  // --- Light state ---
  private lightService: Service;
  private hyperHDRSwitchService?: Service;
  private lightStates = {
    on: false,
    brightness: 0,
    hue: 0,
    saturation: 0,
    colorTemperature: 370,
  };

  // --- TV / presets state ---
  private presetsService: Service;
  private inputServices: Service[] = [];
  private presetInputMap: Map<number, number> = new Map();
  private currentActiveInput = 0;

  private stateListener = (state: WLEDState) => {
    this.updateFromDevice(state);
  };

  private readonly hyperHDRClient?: HyperHDRClient;

  private presetListener = (presets: Record<string, { name: string; data: any }>) => {
    this.updateInputSources(presets);
  };

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
    hyperHDRClient?: HyperHDRClient,
  ) {
    this.hyperHDRClient = hyperHDRClient;
    // Accessory information (single identity)
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WLED')
      .setCharacteristic(this.platform.Characteristic.Model, 'WLED (Combined)')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.host);

    // --- Lightbulb service ---
    this.lightService = this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    this.lightService
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, accessory.context.device.name);

    this.lightService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));

    this.lightService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getBrightness.bind(this))
      .onSet(this.setBrightness.bind(this));

    this.lightService.getCharacteristic(this.platform.Characteristic.Hue)
      .onGet(this.getHue.bind(this))
      .onSet(this.setHue.bind(this));

    this.lightService.getCharacteristic(this.platform.Characteristic.Saturation)
      .onGet(this.getSaturation.bind(this))
      .onSet(this.setSaturation.bind(this));

    this.lightService.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .setProps({ minValue: 153, maxValue: 500 })
      .onGet(this.getColorTemperature.bind(this))
      .onSet(this.setColorTemperature.bind(this));

    // --- TV service for presets ---
    this.presetsService = this.accessory.getService(this.platform.Service.Television) ||
      this.accessory.addService(this.platform.Service.Television);

    this.presetsService
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, `${accessory.context.device.name} ${this.platform.getTvNameSuffix()}`)
      .setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    this.presetsService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => {
        const state = this.wledDevice.getState();
        return state.on
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE;
      })
      .onSet(async (value: CharacteristicValue) => {
        const isActive = value === this.platform.Characteristic.Active.ACTIVE;
        await this.wledDevice.setPower(isActive);
        if (this.hyperHDRClient) {
          this.hyperHDRClient.setPower(isActive).catch(() => {});
          this.hyperHDRSwitchService?.updateCharacteristic(this.platform.Characteristic.On, isActive);
        }
      });

    this.presetsService.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .onSet(() => {
        // No-op
      });

    this.presetsService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onGet(async () => {
        const activePresetId = this.wledDevice.getActivePresetId();
        return activePresetId > 0 ? activePresetId : 0;
      })
      .onSet(async (value: CharacteristicValue) => {
        const presetId = value as number;
        if (presetId === 0) {
          this.currentActiveInput = 0;
          await this.wledDevice.activatePreset(0);
          return;
        }
        if (this.presetInputMap.has(presetId)) {
          this.currentActiveInput = presetId;
          await this.wledDevice.activatePreset(presetId);
        }
      });

    if (this.hyperHDRClient) {
      const hyperHDRSettings = accessory.context.device?.deviceSettings?.hyperHDR || {};
      const switchName = hyperHDRSettings.switchName || 'HyperHDR';
      const hbService = hyperHDRSettings.serviceType === 'Outlet'
        ? this.platform.Service.Outlet
        : this.platform.Service.Switch;
      // Remove stale service if the type changed
      for (const otherSvc of [this.platform.Service.Switch, this.platform.Service.Outlet]) {
        if (otherSvc !== hbService) {
          const stale = this.accessory.getServiceById(otherSvc, 'hyperhdr-switch');
          if (stale) this.accessory.removeService(stale);
        }
      }
      this.hyperHDRSwitchService = this.accessory.getServiceById(hbService, 'hyperhdr-switch') ||
        this.accessory.addService(hbService, switchName, 'hyperhdr-switch');
      this.hyperHDRSwitchService
        .setCharacteristic(this.platform.Characteristic.Name, switchName)
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, switchName);
      this.hyperHDRSwitchService.getCharacteristic(this.platform.Characteristic.On)
        .onGet(async () => this.hyperHDRClient!.getState())
        .onSet(async (value: CharacteristicValue) => this.hyperHDRClient!.setPower(value as boolean));
    } else {
      for (const svc of [this.platform.Service.Switch, this.platform.Service.Outlet]) {
        const stale = this.accessory.getServiceById(svc, 'hyperhdr-switch');
        if (stale) this.accessory.removeService(stale);
      }
    }

    this.wledDevice.refreshState();
    this.wledDevice.addStateListener(this.stateListener);
    this.wledDevice.addPresetListener(this.presetListener);

    this.initializePresets();

    this.updateFromDevice(this.wledDevice.getState());
  }

  private async initializePresets(): Promise<void> {
    try {
      const presets = await this.wledDevice.getPresets();
      this.updateInputSources(presets);
    } catch (error) {
      this.platform.log.error('Failed to initialize presets:', error);
    }
  }

  private updateInputSources(presets: Record<string, { name: string; data: any }>): void {
    this.presetInputMap.clear();

    for (const inputService of this.inputServices) {
      this.presetsService.removeLinkedService(inputService);
      this.accessory.removeService(inputService);
    }
    this.inputServices = [];

    // Always include "Custom" (Identifier 0)
    this.presetInputMap.set(0, 0);
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

    // Enabled preset filtering (same behavior as TV accessory)
    let enabledPresets: string[] = [];
    if (this.accessory.context.device?.deviceSettings?.enabledPresets) {
      enabledPresets = this.accessory.context.device.deviceSettings.enabledPresets;
    }
    const filterByEnabled = enabledPresets.length > 0;

    for (const [presetIdStr, preset] of Object.entries(presets)) {
      const presetId = parseInt(presetIdStr, 10);
      if (isNaN(presetId) || presetId === 0) {
        continue;
      }
      if (filterByEnabled && !enabledPresets.includes(presetIdStr)) {
        continue;
      }

      this.presetInputMap.set(presetId, presetId);

      const subtype = `preset-${presetId}`;
      const n = preset.data?.n || `Preset ${presetId}`;
      const ql = preset.data?.ql || '';
      const label = (ql ? `${ql} ` : '') + `${n}`;

      const inputService = this.accessory.getServiceById(this.platform.Service.InputSource, subtype) ||
        this.accessory.addService(this.platform.Service.InputSource, `Preset ${presetId}`, subtype);

      inputService
        .setCharacteristic(this.platform.Characteristic.Identifier, presetId)
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, label)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.HDMI);

      inputService.subtype = subtype;
      this.presetsService.addLinkedService(inputService);
      this.inputServices.push(inputService);
    }

    this.platform.api.updatePlatformAccessories([this.accessory]);
  }

  private updateFromDevice(state: WLEDState): void {
    // Light
    this.lightStates.on = state.on;
    this.lightStates.brightness = state.brightness;
    this.lightStates.hue = state.hue;
    this.lightStates.saturation = state.saturation;

    this.lightService.updateCharacteristic(this.platform.Characteristic.On, state.on);
    this.lightService.updateCharacteristic(this.platform.Characteristic.Brightness, state.brightness);
    this.lightService.updateCharacteristic(this.platform.Characteristic.Hue, state.hue);
    this.lightService.updateCharacteristic(this.platform.Characteristic.Saturation, state.saturation);
    this.lightService.updateCharacteristic(this.platform.Characteristic.ColorTemperature,
      Math.max(153, Math.min(500, state.colorTemperature)));

    // TV active + active identifier
    this.presetsService.updateCharacteristic(
      this.platform.Characteristic.Active,
      state.on ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
    );

    const activePresetId = this.wledDevice.getActivePresetId();
    if (activePresetId > 0 && this.presetInputMap.has(activePresetId)) {
      if (activePresetId !== this.currentActiveInput) {
        this.currentActiveInput = activePresetId;
        this.presetsService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, activePresetId);
      }
    } else {
      this.presetsService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, 0);
    }
  }

  // --- Light handlers (same as WLEDLightAccessory) ---
  async getOn(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.lightStates.on = state.on;
    return state.on;
  }

  async setOn(value: CharacteristicValue): Promise<void> {
    const newValue = value as boolean;
    if (this.lightStates.on !== newValue) {
      this.lightStates.on = newValue;
      await this.wledDevice.setPower(newValue);
      if (this.hyperHDRClient) {
        this.hyperHDRClient.setPower(newValue).catch(() => {});
        this.hyperHDRSwitchService?.updateCharacteristic(this.platform.Characteristic.On, newValue);
      }
    }
  }

  async getBrightness(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.lightStates.brightness = state.brightness;
    return state.brightness;
  }

  async setBrightness(value: CharacteristicValue): Promise<void> {
    const newValue = value as number;
    if (this.lightStates.brightness !== newValue) {
      this.lightStates.brightness = newValue;
      await this.wledDevice.setBrightness(newValue);
      if (this.hyperHDRClient) {
        this.hyperHDRClient.setBrightness(newValue).catch(() => {});
      }
    }
  }

  async getHue(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.lightStates.hue = state.hue;
    return state.hue;
  }

  async setHue(value: CharacteristicValue): Promise<void> {
    const newValue = value as number;
    if (this.lightStates.hue !== newValue) {
      this.lightStates.hue = newValue;
      await this.wledDevice.setHSV(newValue, this.lightStates.saturation, this.lightStates.brightness);
    }
  }

  async getSaturation(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.lightStates.saturation = state.saturation;
    return state.saturation;
  }

  async setSaturation(value: CharacteristicValue): Promise<void> {
    const newValue = value as number;
    if (this.lightStates.saturation !== newValue) {
      this.lightStates.saturation = newValue;
      await this.wledDevice.setHSV(this.lightStates.hue, newValue, this.lightStates.brightness);
    }
  }

  async getColorTemperature(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.lightStates.colorTemperature = Math.max(153, Math.min(500, state.colorTemperature));
    return this.lightStates.colorTemperature;
  }

  async setColorTemperature(value: CharacteristicValue): Promise<void> {
    const newValue = value as number;
    if (this.lightStates.colorTemperature !== newValue) {
      this.lightStates.colorTemperature = newValue;
      await this.wledDevice.setColorTemperature(newValue);
    }
  }
}
