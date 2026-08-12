import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { PlatformContext } from '../shared/platformContext';
import { WLEDDevice, WLEDState } from '../device/wledDevice';
import { HyperHDRClient } from '../device/hyperHDRClient';
import { clampMireds, getDevicesFromConfig } from '../shared/wledUtils';

export interface LightStates {
  on: boolean;
  brightness: number;
  hue: number;
  saturation: number;
  colorTemperature: number;
}

export function setAccessoryInformation(
  platform: PlatformContext,
  accessory: PlatformAccessory,
  model: string,
  serialSuffix?: string,
  firmware?: string,
): void {
  const host = accessory.context.device?.host || 'unknown';
  const fw = firmware
    || accessory.context.device?.firmwareVersion
    || 'Unknown';
  accessory.getService(platform.Service.AccessoryInformation)!
    .setCharacteristic(platform.Characteristic.Manufacturer, 'WLED')
    .setCharacteristic(platform.Characteristic.Model, model)
    .setCharacteristic(
      platform.Characteristic.SerialNumber,
      serialSuffix ? `${host}${serialSuffix}` : host,
    )
    .setCharacteristic(platform.Characteristic.FirmwareRevision, String(fw));
}

/** Best-effort async refresh of FirmwareRevision from the live device. */
export function refreshFirmwareRevision(
  platform: PlatformContext,
  accessory: PlatformAccessory,
  wledDevice: WLEDDevice,
): void {
  if (typeof wledDevice.getDeviceInfo !== 'function') {
    return;
  }
  wledDevice.getDeviceInfo().then((info) => {
    if (!info?.version) return;
    accessory.context.device = { ...(accessory.context.device || {}), firmwareVersion: info.version };
    accessory.getService(platform.Service.AccessoryInformation)
      ?.setCharacteristic(platform.Characteristic.FirmwareRevision, info.version);
    platform.api.updatePlatformAccessories([accessory]);
  }).catch(() => {});
}

/**
 * Attach or remove the HyperHDR Switch/Outlet service on an accessory.
 */
export function attachHyperHDRSwitch(
  platform: PlatformContext,
  accessory: PlatformAccessory,
  hyperHDRClient?: HyperHDRClient,
): Service | undefined {
  if (!hyperHDRClient) {
    for (const svc of [platform.Service.Switch, platform.Service.Outlet]) {
      const stale = accessory.getServiceById(svc, 'hyperhdr-switch');
      if (stale) {
        accessory.removeService(stale);
      }
    }
    return undefined;
  }

  const hyperHDRSettings = accessory.context.device?.deviceSettings?.hyperHDR || {};
  const switchName = hyperHDRSettings.switchName || 'HyperHDR';
  const hbService = hyperHDRSettings.serviceType === 'Outlet'
    ? platform.Service.Outlet
    : platform.Service.Switch;

  for (const otherSvc of [platform.Service.Switch, platform.Service.Outlet]) {
    if (otherSvc !== hbService) {
      const stale = accessory.getServiceById(otherSvc, 'hyperhdr-switch');
      if (stale) {
        accessory.removeService(stale);
      }
    }
  }

  const service = accessory.getServiceById(hbService, 'hyperhdr-switch')
    || accessory.addService(hbService, switchName, 'hyperhdr-switch');

  service
    .setCharacteristic(platform.Characteristic.Name, switchName)
    .setCharacteristic(platform.Characteristic.ConfiguredName, switchName);

  service.getCharacteristic(platform.Characteristic.On)
    .onGet(async () => hyperHDRClient.getState())
    .onSet(async (value: CharacteristicValue) => hyperHDRClient.setPower(value as boolean));

  // Optional bidirectional poll: keep HomeKit switch aligned with HyperHDR.
  const pollSec = Number(hyperHDRSettings.pollInterval);
  if (Number.isFinite(pollSec) && pollSec >= 2) {
    hyperHDRClient.startPolling(pollSec, (on) => {
      service.updateCharacteristic(platform.Characteristic.On, on);
    });
  } else {
    hyperHDRClient.stopPolling();
  }

  return service;
}

/**
 * Shared Lightbulb service handlers used by Light and Combined accessories.
 */
export class LightbulbController {
  readonly service: Service;
  readonly states: LightStates = {
    on: false,
    brightness: 0,
    hue: 0,
    saturation: 0,
    colorTemperature: 370,
  };

  private hyperHDRSwitchService?: Service;
  /** Last power value pushed to HyperHDR (avoids spam; preserves independent switch). */
  private lastSyncedHyperHDRPower?: boolean;
  /** Last brightness value pushed to HyperHDR. */
  private lastSyncedHyperHDRBrightness?: number;

  constructor(
    private readonly platform: PlatformContext,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
    private readonly hyperHDRClient?: HyperHDRClient,
  ) {
    this.service = this.accessory.getService(this.platform.Service.Lightbulb)
      || this.accessory.addService(this.platform.Service.Lightbulb);

    this.service
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, accessory.context.device.name);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getBrightness.bind(this))
      .onSet(this.setBrightness.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.Hue)
      .onGet(this.getHue.bind(this))
      .onSet(this.setHue.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.Saturation)
      .onGet(this.getSaturation.bind(this))
      .onSet(this.setSaturation.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .setProps({ minValue: 153, maxValue: 500 })
      .onGet(this.getColorTemperature.bind(this))
      .onSet(this.setColorTemperature.bind(this));

    this.hyperHDRSwitchService = attachHyperHDRSwitch(
      this.platform,
      this.accessory,
      this.hyperHDRClient,
    );
  }

  syncHyperHDRPower(on: boolean): void {
    if (!this.hyperHDRClient) {
      return;
    }
    if (this.lastSyncedHyperHDRPower === on) {
      this.hyperHDRSwitchService?.updateCharacteristic(this.platform.Characteristic.On, on);
      return;
    }
    this.lastSyncedHyperHDRPower = on;
    this.hyperHDRClient.setPower(on).catch(() => {});
    this.hyperHDRSwitchService?.updateCharacteristic(this.platform.Characteristic.On, on);
  }

  private syncHyperHDRBrightness(brightness: number): void {
    if (!this.hyperHDRClient) {
      return;
    }
    if (this.lastSyncedHyperHDRBrightness === brightness) {
      return;
    }
    this.lastSyncedHyperHDRBrightness = brightness;
    this.hyperHDRClient.setBrightness(brightness).catch(() => {});
  }

  updateFromDevice(state: WLEDState): void {
    this.states.on = state.on;
    this.states.brightness = state.brightness;
    this.states.hue = state.hue;
    this.states.saturation = state.saturation;
    this.states.colorTemperature = clampMireds(state.colorTemperature);

    this.service.updateCharacteristic(this.platform.Characteristic.On, state.on);
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, state.brightness);
    this.service.updateCharacteristic(this.platform.Characteristic.Hue, state.hue);
    this.service.updateCharacteristic(this.platform.Characteristic.Saturation, state.saturation);
    this.service.updateCharacteristic(
      this.platform.Characteristic.ColorTemperature,
      this.states.colorTemperature,
    );

    // Mirror WLED→HyperHDR for external changes (WS/UI/nightlight/TV remote).
    // Deduped so an independent HyperHDR switch toggle is not fought on every poll.
    this.syncHyperHDRPower(state.on);
    this.syncHyperHDRBrightness(state.brightness);
  }

  async getOn(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.states.on = state.on;
    return state.on;
  }

  async setOn(value: CharacteristicValue): Promise<void> {
    const newValue = value as boolean;
    if (this.states.on !== newValue) {
      this.states.on = newValue;
      await this.wledDevice.setPower(newValue);
      // Fallback if the device mock/path does not notify listeners; deduped when it does.
      this.syncHyperHDRPower(newValue);
    }
  }

  async getBrightness(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.states.brightness = state.brightness;
    return state.brightness;
  }

  async setBrightness(value: CharacteristicValue): Promise<void> {
    const newValue = value as number;
    if (this.states.brightness !== newValue) {
      this.states.brightness = newValue;
      await this.wledDevice.setBrightness(newValue);
      // Fallback if the device mock/path does not notify listeners; deduped when it does.
      this.syncHyperHDRBrightness(newValue);
    }
  }

  async getHue(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.states.hue = state.hue;
    return state.hue;
  }

  async setHue(value: CharacteristicValue): Promise<void> {
    const newValue = value as number;
    if (this.states.hue !== newValue) {
      this.states.hue = newValue;
      await this.wledDevice.setHSV(newValue, this.states.saturation, this.states.brightness);
    }
  }

  async getSaturation(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.states.saturation = state.saturation;
    return state.saturation;
  }

  async setSaturation(value: CharacteristicValue): Promise<void> {
    const newValue = value as number;
    if (this.states.saturation !== newValue) {
      this.states.saturation = newValue;
      await this.wledDevice.setHSV(this.states.hue, newValue, this.states.brightness);
    }
  }

  async getColorTemperature(): Promise<CharacteristicValue> {
    const state = this.wledDevice.getState();
    this.states.colorTemperature = clampMireds(state.colorTemperature);
    return this.states.colorTemperature;
  }

  async setColorTemperature(value: CharacteristicValue): Promise<void> {
    const newValue = value as number;
    if (this.states.colorTemperature !== newValue) {
      this.states.colorTemperature = newValue;
      await this.wledDevice.setColorTemperature(newValue);
    }
  }
}

/**
 * Shared Television + InputSource presets handlers used by Presets and Combined accessories.
 */
export class TelevisionPresetsController {
  readonly service: Service;
  private inputServices: Service[] = [];
  private presetInputMap: Map<number, number> = new Map();
  private currentActiveInput = 0;

  private readonly presetListener = (presets: Record<string, { name: string; data: any }>) => {
    this.updateInputSources(presets);
  };

  constructor(
    private readonly platform: PlatformContext,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
    private readonly opts: {
      /** When TV Active changes, also sync HyperHDR (Combined mode). */
      onActiveChange?: (isActive: boolean) => void;
      /** Skip platform-config fallback for enabledPresets (Combined uses context only). */
      enabledPresetsFromContextOnly?: boolean;
    } = {},
  ) {
    this.service = this.accessory.getService(this.platform.Service.Television)
      || this.accessory.addService(this.platform.Service.Television);

    this.service
      .setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        `${accessory.context.device.name} ${this.platform.getTvNameSuffix()}`,
      )
      .setCharacteristic(
        this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getTVActive.bind(this))
      .onSet(this.setTVActive.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .onSet(this.handleRemoteKey.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onGet(async () => {
        const activePresetId = this.wledDevice.getActivePresetId();
        return activePresetId > 0 ? activePresetId : 0;
      })
      .onSet(async (value: CharacteristicValue) => {
        const presetId = value as number;
        this.platform.log.debug(
          `[Presets] ActiveIdentifier set to: ${presetId} for ${this.accessory.displayName}`,
        );
        if (presetId === 0) {
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

    this.wledDevice.addPresetListener(this.presetListener);
    this.initializePresets();
  }

  private async initializePresets(): Promise<void> {
    try {
      this.platform.log.debug('Fetching presets from WLED device...');
      const presets = await this.wledDevice.getPresets();
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

  private resolveEnabledPresets(): string[] {
    if (this.accessory.context.device?.deviceSettings?.enabledPresets) {
      return this.accessory.context.device.deviceSettings.enabledPresets;
    }
    if (this.opts.enabledPresetsFromContextOnly) {
      return [];
    }
    const devices = getDevicesFromConfig(this.platform.config);
    const deviceHost = this.accessory.context.device?.host;
    const configuredDevice = devices.find((d: any) => d.host === deviceHost);
    return configuredDevice?.deviceSettings?.enabledPresets || [];
  }

  private updateInputSources(presets: Record<string, { name: string; data: any }>): void {
    this.presetInputMap.clear();

    for (const inputService of this.inputServices) {
      this.service.removeLinkedService(inputService);
      this.accessory.removeService(inputService);
    }
    this.inputServices = [];

    // Always expose "Custom" (Identifier 0) for manual/no-preset mode.
    this.presetInputMap.set(0, 0);
    const customSubtype = 'preset-0-custom';
    const customLabel = this.platform.getCustomInputLabel();
    const customInputService = this.accessory.getServiceById(
      this.platform.Service.InputSource,
      customSubtype,
    ) || this.accessory.addService(this.platform.Service.InputSource, customLabel, customSubtype);

    customInputService
      .setCharacteristic(this.platform.Characteristic.Identifier, 0)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, customLabel)
      .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.HDMI);
    customInputService.subtype = customSubtype;
    this.service.addLinkedService(customInputService);
    this.inputServices.push(customInputService);

    const enabledPresets = this.resolveEnabledPresets();
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

      const inputService = this.accessory.getServiceById(this.platform.Service.InputSource, subtype)
        || this.accessory.addService(this.platform.Service.InputSource, `Preset ${presetId}`, subtype);

      inputService
        .setCharacteristic(this.platform.Characteristic.Identifier, presetId)
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, label)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.HDMI);
      inputService.subtype = subtype;

      this.service.addLinkedService(inputService);
      this.inputServices.push(inputService);
    }

    this.platform.api.updatePlatformAccessories([this.accessory]);
  }

  updateFromDevice(state: WLEDState): void {
    this.service.updateCharacteristic(
      this.platform.Characteristic.Active,
      state.on
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE,
    );

    const activePresetId = this.wledDevice.getActivePresetId();
    if (activePresetId > 0 && this.presetInputMap.has(activePresetId)) {
      if (activePresetId !== this.currentActiveInput) {
        this.currentActiveInput = activePresetId;
        this.service.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, activePresetId);
      }
    } else if (activePresetId <= 0) {
      this.service.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, 0);
    }
  }

  private orderedPresetIds(): number[] {
    return Array.from(this.presetInputMap.keys()).sort((a, b) => a - b);
  }

  private async selectPresetInput(presetId: number): Promise<void> {
    if (!this.presetInputMap.has(presetId)) {
      return;
    }
    this.currentActiveInput = presetId;
    this.service.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, presetId);
    await this.wledDevice.activatePreset(presetId);
  }

  private async handleRemoteKey(value: CharacteristicValue): Promise<void> {
    const RK = this.platform.Characteristic.RemoteKey as any;
    const key = value as number;
    const ids = this.orderedPresetIds();
    if (ids.length === 0) {
      return;
    }

    const current = ids.includes(this.currentActiveInput) ? this.currentActiveInput : ids[0];
    const idx = Math.max(0, ids.indexOf(current));

    if (key === RK.ARROW_LEFT || key === RK.PREVIOUS_TRACK || key === RK.REWIND) {
      const next = ids[(idx - 1 + ids.length) % ids.length];
      await this.selectPresetInput(next);
      return;
    }
    if (key === RK.ARROW_RIGHT || key === RK.NEXT_TRACK || key === RK.FAST_FORWARD) {
      const next = ids[(idx + 1) % ids.length];
      await this.selectPresetInput(next);
      return;
    }
    if (key === RK.BACK || key === RK.EXIT) {
      await this.selectPresetInput(0);
      return;
    }
    if (key === RK.SELECT || key === RK.PLAY_PAUSE) {
      if (key === RK.PLAY_PAUSE) {
        const on = this.wledDevice.getState().on;
        await this.wledDevice.setPower(!on);
        this.opts.onActiveChange?.(!on);
        return;
      }
      await this.selectPresetInput(current);
      return;
    }
    if (key === RK.ARROW_UP) {
      const bri = Math.min(100, this.wledDevice.getState().brightness + 10);
      await this.wledDevice.setBrightness(bri);
      return;
    }
    if (key === RK.ARROW_DOWN) {
      const bri = Math.max(0, this.wledDevice.getState().brightness - 10);
      await this.wledDevice.setBrightness(bri);
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
    this.opts.onActiveChange?.(isActive);
  }
}
