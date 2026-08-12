import { Service, PlatformAccessory } from 'homebridge';
import { WLEDPlatform } from '../platform';
import { WLEDDevice, WLEDState } from '../device/wledDevice';
import { resolveNightlightConfig } from '../shared/wledUtils';
import { WLEDPlatformConfig } from '../shared/configTypes';
import { setAccessoryInformation, refreshFirmwareRevision } from './accessoryControllers';
import { createRadioSwitchGroup, updateRadioSwitchStates } from './radioSwitchGroup';

interface NightlightTimerConfig {
  name: string;
  seconds: number;
}

export class WLEDNightlightAccessory {
  private switchServices: Service[] = [];
  private timerConfigs: NightlightTimerConfig[] = [];
  private activeTimerIndex: number | null = null;
  private readonly stateListener: (state: WLEDState) => void;

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
  ) {
    const deviceSettings = this.accessory.context.device?.deviceSettings || {};
    const globalNightlight = (this.platform.config as WLEDPlatformConfig)?.manualDevicesSection?.nightlight || {};
    const nightlight = resolveNightlightConfig(deviceSettings, globalNightlight);

    this.stateListener = () => this.syncFromDevice();

    if (!nightlight.enabled || nightlight.timers.length === 0) {
      this.platform.log.debug(`Nightlight disabled or no timers configured for ${this.accessory.displayName}, skipping setup.`);
      return;
    }

    this.timerConfigs = nightlight.timers;

    setAccessoryInformation(platform, accessory, 'WLED Nightlight Timers');
    refreshFirmwareRevision(platform, accessory, wledDevice);
    this.setupTimerSwitches();
    this.wledDevice.addStateListener(this.stateListener);
    this.syncFromDevice();
  }

  private setupTimerSwitches(): void {
    this.switchServices = createRadioSwitchGroup({
      platform: this.platform,
      accessory: this.accessory,
      existingServices: this.switchServices,
      items: this.timerConfigs.map((timer, index) => ({
        subtype: `nightlight-timer-${index}`,
        displayName: `${this.accessory.context.device.name} Nightlight ${timer.name}`,
      })),
      isOn: (index) => {
        this.syncFromDevice();
        return this.activeTimerIndex === index;
      },
      onSet: async (index, turnOn) => {
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
          try {
            await this.wledDevice.stopNightlight();
          } catch (error) {
            this.platform.log.error(`Failed to stop nightlight for ${this.accessory.displayName}:`, error);
            throw error;
          }
          this.activeTimerIndex = null;
          this.updateSwitchStates();
        }
      },
    });
  }

  /**
   * Keep HomeKit switches aligned with WLED's reported nightlight state.
   */
  private syncFromDevice(): void {
    const nl = this.wledDevice.getNightlightState();

    if (!nl.active) {
      if (this.activeTimerIndex !== null) {
        this.activeTimerIndex = null;
        this.updateSwitchStates();
      }
      return;
    }

    let matchedIndex: number | null = null;
    if (typeof nl.durationMinutes === 'number') {
      matchedIndex = this.timerConfigs.findIndex(timer => {
        const timerMinutes = Math.max(1, Math.round(timer.seconds / 60));
        return timerMinutes === nl.durationMinutes
          || Math.abs(timer.seconds - (nl.durationMinutes! * 60)) <= 30;
      });
      if (matchedIndex < 0) {
        matchedIndex = null;
      }
    }

    if (matchedIndex !== null && this.activeTimerIndex !== matchedIndex) {
      this.activeTimerIndex = matchedIndex;
      this.updateSwitchStates();
    }
  }

  private updateSwitchStates(): void {
    updateRadioSwitchStates(
      this.platform,
      this.switchServices,
      (index) => this.activeTimerIndex === index,
    );
  }
}
