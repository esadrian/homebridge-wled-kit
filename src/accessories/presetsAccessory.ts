import { PlatformAccessory } from 'homebridge';
import { WLEDPlatform } from '../platform';
import { WLEDDevice, WLEDState } from '../device/wledDevice';
import { TelevisionPresetsController, setAccessoryInformation, refreshFirmwareRevision } from './accessoryControllers';

/**
 * WLED Presets Accessory
 * Handles the Television service: power state and preset selection via input sources.
 */
export class WLEDPresetsAccessory {
  private readonly tv: TelevisionPresetsController;

  private stateListener = (state: WLEDState) => {
    this.tv.updateFromDevice(state);
  };

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
  ) {
    setAccessoryInformation(platform, accessory, 'WLED Presets', '-tv');
    refreshFirmwareRevision(platform, accessory, wledDevice);
    this.tv = new TelevisionPresetsController(platform, accessory, wledDevice);

    this.wledDevice.addStateListener(this.stateListener);
    this.tv.updateFromDevice(this.wledDevice.getState());
  }
}
