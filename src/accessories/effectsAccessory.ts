import { Service, PlatformAccessory } from 'homebridge';
import { WLEDPlatform } from '../platform';
import { WLEDDevice, WLEDState } from '../device/wledDevice';
import { refreshFirmwareRevision, setAccessoryInformation } from './accessoryControllers';
import { createRadioSwitchGroup, updateRadioSwitchStates } from './radioSwitchGroup';

const MAX_EFFECT_SWITCHES = 20;

/**
 * Bounded effect switches (optional via deviceSettings.exposeEffects).
 * Only effects listed in enabledEffects (or the first MAX) are exposed.
 */
export class WLEDEffectsAccessory {
  private switchServices: Service[] = [];
  private effectIds: number[] = [];
  private activeEffect: number | null = null;

  private stateListener = (state: WLEDState) => {
    if (typeof state.effect === 'number') {
      this.activeEffect = state.effect;
      this.updateSwitchStates();
    }
  };

  constructor(
    private readonly platform: WLEDPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly wledDevice: WLEDDevice,
  ) {
    setAccessoryInformation(platform, accessory, 'WLED Effects', '-effects');
    refreshFirmwareRevision(platform, accessory, wledDevice);

    this.wledDevice.addStateListener(this.stateListener);
    this.initialize().catch((error) => {
      this.platform.log.error(`Failed to init effects for ${accessory.displayName}:`, error);
    });
  }

  private async initialize(): Promise<void> {
    const effects = await this.wledDevice.getEffects();
    const enabled = (this.accessory.context.device?.deviceSettings?.enabledEffects || [])
      .map((v: string | number) => parseInt(String(v), 10))
      .filter((n: number) => Number.isFinite(n) && n >= 0);

    let ids = enabled.length > 0
      ? enabled.filter((id: number) => id < effects.length)
      : effects.map((_, i) => i).slice(0, MAX_EFFECT_SWITCHES);

    ids = ids.slice(0, MAX_EFFECT_SWITCHES);
    this.effectIds = ids;

    this.switchServices = createRadioSwitchGroup({
      platform: this.platform,
      accessory: this.accessory,
      existingServices: this.switchServices,
      items: ids.map((effectId: number) => ({
        subtype: `effect-${effectId}`,
        displayName: effects[effectId] || `Effect ${effectId}`,
      })),
      isOn: (index) => this.activeEffect === this.effectIds[index],
      onSet: async (index, value) => {
        const effectId = this.effectIds[index];
        if (value === true) {
          await this.wledDevice.setEffect(effectId);
          this.activeEffect = effectId;
          this.updateSwitchStates();
        } else if (this.activeEffect === effectId) {
          await this.wledDevice.setEffect(0);
          this.activeEffect = 0;
          this.updateSwitchStates();
        }
      },
    });

    this.activeEffect = this.wledDevice.getState().effect;
    this.updateSwitchStates();
  }

  private updateSwitchStates(): void {
    updateRadioSwitchStates(
      this.platform,
      this.switchServices,
      (index) => this.activeEffect === this.effectIds[index],
    );
  }
}
