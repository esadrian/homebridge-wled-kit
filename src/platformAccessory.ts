import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { WLEDPlatform } from './platform';
import { WLEDDevice, WLEDState } from './wledDevice';
import { HyperHDRClient } from './hyperHDRClient';

/**
 * WLED Light Accessory
 * Handles the Lightbulb service: power, brightness, hue, and saturation.
 */
export class WLEDLightAccessory {
  private lightService: Service;
  private hyperHDRSwitchService?: Service;

  private states = {
    on: false,
    brightness: 0,
    hue: 0,
    saturation: 0,
    colorTemperature: 370,
  };

  private readonly hyperHDRClient?: HyperHDRClient;

  private stateListener = (state: WLEDState) => {
    this.updateStateFromDevice(state);
  };

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
    hyperHDRClient?: HyperHDRClient,
  ) {
    this.hyperHDRClient = hyperHDRClient;
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WLED')
      .setCharacteristic(this.platform.Characteristic.Model, 'WLED Light')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.host + '-light');

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

    const currentState = this.wledDevice.getState();
    this.updateStateFromDevice(currentState);
  }

  private updateStateFromDevice(state: WLEDState): void {
    this.states.on = state.on;
    this.states.brightness = state.brightness;
    this.states.hue = state.hue;
    this.states.saturation = state.saturation;

    this.lightService.updateCharacteristic(this.platform.Characteristic.On, state.on);
    this.lightService.updateCharacteristic(this.platform.Characteristic.Brightness, state.brightness);
    this.lightService.updateCharacteristic(this.platform.Characteristic.Hue, state.hue);
    this.lightService.updateCharacteristic(this.platform.Characteristic.Saturation, state.saturation);
    this.lightService.updateCharacteristic(this.platform.Characteristic.ColorTemperature,
      Math.max(153, Math.min(500, state.colorTemperature)));
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
      if (this.hyperHDRClient) {
        this.hyperHDRClient.setPower(newValue).catch(() => {});
        this.hyperHDRSwitchService?.updateCharacteristic(this.platform.Characteristic.On, newValue);
      }
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
      if (this.hyperHDRClient) {
        this.hyperHDRClient.setBrightness(newValue).catch(() => {});
      }
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
    this.states.colorTemperature = Math.max(153, Math.min(500, state.colorTemperature));
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
