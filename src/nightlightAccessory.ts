import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { WLEDPlatform } from './platform';
import { WLEDDevice } from './wledDevice';

interface NightlightTimerConfig {
  name: string;
  seconds: number;
}

export class WLEDNightlightAccessory {
  private switchServices: Service[] = [];
  private timerConfigs: NightlightTimerConfig[] = [];
  private activeTimerIndex: number | null = null;

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
  ) {
    const deviceSettings = this.accessory.context.device?.deviceSettings || {};
    const globalNightlight = (this.platform.config as any)?.manualDevicesSection?.nightlight || {};
    const deviceNightlight = deviceSettings.nightlight || {};

    // Resolve effective nightlight config: device overrides global
    const enabled = deviceNightlight.enabled === true
      || (deviceNightlight.enabled === undefined && globalNightlight.enabled === true);

    const timers: NightlightTimerConfig[] = (deviceNightlight.timers && deviceNightlight.timers.length > 0)
      ? deviceNightlight.timers
      : (globalNightlight.timers || []);

    if (!enabled || timers.length === 0) {
      this.platform.log.debug(`Nightlight disabled or no timers configured for ${this.accessory.displayName}, skipping setup.`);
      return;
    }

    this.timerConfigs = timers;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WLED')
      .setCharacteristic(this.platform.Characteristic.Model, 'WLED Nightlight Timers')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.host);

    this.setupTimerSwitches();
  }

  private setupTimerSwitches(): void {
    // Clean up any existing switch services for safety
    for (const service of this.switchServices) {
      this.accessory.removeService(service);
    }
    this.switchServices = [];

    this.timerConfigs.forEach((timer, index) => {
      const subtype = `nightlight-timer-${index}`;
      const displayName = `${this.accessory.context.device.name} Nightlight ${timer.name}`;

      const service =
        this.accessory.getServiceById(this.platform.Service.Switch, subtype) ||
        this.accessory.addService(this.platform.Service.Switch, displayName, subtype);

      service
        .setCharacteristic(this.platform.Characteristic.Name, displayName)
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName);

      service.getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.createGetHandler(index).bind(this))
        .onSet(this.createSetHandler(index).bind(this));

      this.switchServices.push(service);
    });
  }

  private createGetHandler(index: number) {
    return async (): Promise<CharacteristicValue> => {
      return this.activeTimerIndex === index;
    };
  }

  private createSetHandler(index: number) {
    return async (value: CharacteristicValue): Promise<void> => {
      const turnOn = value === true;

      if (turnOn) {
        const timer = this.timerConfigs[index];
        if (!timer) {
          return;
        }

        try {
          await this.wledDevice.startNightlight(timer.seconds);
          this.activeTimerIndex = index;
          this.updateSwitchStates();
        } catch (error) {
          this.platform.log.error(`Failed to start nightlight for ${this.accessory.displayName}:`, error);
          throw error;
        }
      } else {
        // Turning this timer off stops nightlight entirely
        try {
          await this.wledDevice.stopNightlight();
        } catch (error) {
          this.platform.log.error(`Failed to stop nightlight for ${this.accessory.displayName}:`, error);
          throw error;
        }
        this.activeTimerIndex = null;
        this.updateSwitchStates();
      }
    };
  }

  private updateSwitchStates(): void {
    this.switchServices.forEach((service, index) => {
      const isOn = this.activeTimerIndex === index;
      service.updateCharacteristic(this.platform.Characteristic.On, isOn);
    });
  }
}

