import { PlatformAccessory, CharacteristicValue } from 'homebridge';
import { WLEDPlatform } from '../platform';
import { WLEDDevice, WLEDState } from '../device/wledDevice';
import { briToPercent, rgbToHsv } from '../shared/wledUtils';
import { refreshFirmwareRevision, setAccessoryInformation } from './accessoryControllers';

/**
 * Per-segment Lightbulb accessory (optional via deviceSettings.exposeSegments).
 */
export class WLEDSegmentAccessory {
  private states = {
    on: false,
    brightness: 100,
    hue: 0,
    saturation: 0,
  };

  private readonly segmentIndex: number;

  private stateListener = (_state: WLEDState) => {
    this.syncFromDevice().catch(() => {});
  };

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
  ) {
    this.segmentIndex = Number(accessory.context.device?.segmentIndex ?? accessory.context.segmentIndex ?? 0);
    setAccessoryInformation(
      platform,
      accessory,
      `WLED Segment ${this.segmentIndex}`,
      `-seg-${this.segmentIndex}`,
    );
    refreshFirmwareRevision(platform, accessory, wledDevice);

    const service = this.accessory.getService(this.platform.Service.Lightbulb)
      || this.accessory.addService(this.platform.Service.Lightbulb);

    service
      .setCharacteristic(this.platform.Characteristic.Name, accessory.displayName)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, accessory.displayName);

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => this.states.on)
      .onSet(async (value: CharacteristicValue) => {
        const on = value as boolean;
        this.states.on = on;
        await this.wledDevice.setSegmentPower(this.segmentIndex, on);
      });

    service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(async () => this.states.brightness)
      .onSet(async (value: CharacteristicValue) => {
        const bri = value as number;
        this.states.brightness = bri;
        await this.wledDevice.setSegmentBrightness(this.segmentIndex, bri);
      });

    service.getCharacteristic(this.platform.Characteristic.Hue)
      .onGet(async () => this.states.hue)
      .onSet(async (value: CharacteristicValue) => {
        this.states.hue = value as number;
        await this.wledDevice.setSegmentHSV(
          this.segmentIndex,
          this.states.hue,
          this.states.saturation,
          this.states.brightness,
        );
      });

    service.getCharacteristic(this.platform.Characteristic.Saturation)
      .onGet(async () => this.states.saturation)
      .onSet(async (value: CharacteristicValue) => {
        this.states.saturation = value as number;
        await this.wledDevice.setSegmentHSV(
          this.segmentIndex,
          this.states.hue,
          this.states.saturation,
          this.states.brightness,
        );
      });

    this.wledDevice.addStateListener(this.stateListener);
    this.syncFromDevice().catch(() => {});
  }

  private async syncFromDevice(): Promise<void> {
    try {
      const segments = await this.wledDevice.getSegments();
      const seg = segments[this.segmentIndex];
      if (!seg) {
        return;
      }
      this.states.on = seg.on;
      this.states.brightness = briToPercent(seg.brightness);
      const [r, g, b] = seg.colors?.[0] || [0, 0, 0];
      const hsv = rgbToHsv(r, g, b);
      this.states.hue = hsv.h;
      this.states.saturation = hsv.s;

      const service = this.accessory.getService(this.platform.Service.Lightbulb);
      service?.updateCharacteristic(this.platform.Characteristic.On, this.states.on);
      service?.updateCharacteristic(this.platform.Characteristic.Brightness, this.states.brightness);
      service?.updateCharacteristic(this.platform.Characteristic.Hue, this.states.hue);
      service?.updateCharacteristic(this.platform.Characteristic.Saturation, this.states.saturation);
    } catch {
      // ignore sync errors
    }
  }
}
