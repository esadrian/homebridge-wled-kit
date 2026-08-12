import { PlatformAccessory } from 'homebridge';
import { WLEDPlatform } from '../platform';
import { WLEDDevice, WLEDState } from '../device/wledDevice';
import { HyperHDRClient } from '../device/hyperHDRClient';
import {
  LightbulbController,
  TelevisionPresetsController,
  setAccessoryInformation,
  refreshFirmwareRevision,
} from './accessoryControllers';

/**
 * WLED Combined Accessory
 * Exposes Lightbulb + Television(InputSource presets) under a single HomeKit accessory.
 */
export class WLEDCombinedAccessory {
  private readonly light: LightbulbController;
  private readonly tv: TelevisionPresetsController;

  private stateListener = (state: WLEDState) => {
    this.light.updateFromDevice(state);
    this.tv.updateFromDevice(state);
  };

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
    hyperHDRClient?: HyperHDRClient,
  ) {
    setAccessoryInformation(platform, accessory, 'WLED (Combined)');
    refreshFirmwareRevision(platform, accessory, wledDevice);
    this.light = new LightbulbController(platform, accessory, wledDevice, hyperHDRClient);
    this.tv = new TelevisionPresetsController(platform, accessory, wledDevice, {
      onActiveChange: (isActive) => this.light.syncHyperHDRPower(isActive),
      enabledPresetsFromContextOnly: true,
    });

    this.wledDevice.refreshState();
    this.wledDevice.addStateListener(this.stateListener);

    const state = this.wledDevice.getState();
    this.light.updateFromDevice(state);
    this.tv.updateFromDevice(state);
  }

  // Expose light handlers for parity with WLEDLightAccessory (tests / debugging)
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
