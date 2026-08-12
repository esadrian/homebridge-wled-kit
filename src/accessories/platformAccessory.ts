import { PlatformAccessory } from 'homebridge';
import { WLEDPlatform } from '../platform';
import { WLEDDevice, WLEDState } from '../device/wledDevice';
import { HyperHDRClient } from '../device/hyperHDRClient';
import { LightbulbController, refreshFirmwareRevision, setAccessoryInformation } from './accessoryControllers';

/**
 * WLED Light Accessory
 * Handles the Lightbulb service: power, brightness, hue, and saturation.
 */
export class WLEDLightAccessory {
  private readonly light: LightbulbController;

  /** Exposed for unit tests that manipulate cached characteristic state. */
  get states() {
    return this.light.states;
  }

  private stateListener = (state: WLEDState) => {
    this.light.updateFromDevice(state);
  };

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
    hyperHDRClient?: HyperHDRClient,
  ) {
    setAccessoryInformation(platform, accessory, 'WLED Light', '-light');
    refreshFirmwareRevision(platform, accessory, wledDevice);
    this.light = new LightbulbController(platform, accessory, wledDevice, hyperHDRClient);

    this.wledDevice.refreshState();
    this.wledDevice.addStateListener(this.stateListener);
    this.light.updateFromDevice(this.wledDevice.getState());
  }

  // Expose handlers for existing unit tests that call them directly
  async getOn() { return this.light.getOn(); }
  async setOn(value: any) { return this.light.setOn(value); }
  async getBrightness() { return this.light.getBrightness(); }
  async setBrightness(value: any) { return this.light.setBrightness(value); }
  async getHue() { return this.light.getHue(); }
  async setHue(value: any) { return this.light.setHue(value); }
  async getSaturation() { return this.light.getSaturation(); }
  async setSaturation(value: any) { return this.light.setSaturation(value); }
  async getColorTemperature() { return this.light.getColorTemperature(); }
  async setColorTemperature(value: any) { return this.light.setColorTemperature(value); }
}
