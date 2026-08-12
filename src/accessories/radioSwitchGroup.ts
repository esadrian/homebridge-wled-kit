import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { PlatformContext } from '../shared/platformContext';

export interface RadioSwitchItem {
  subtype: string;
  displayName: string;
}

/**
 * Mutually exclusive Switch services (nightlight timers, effect picks, etc.).
 */
export function createRadioSwitchGroup(opts: {
  platform: PlatformContext;
  accessory: PlatformAccessory;
  items: RadioSwitchItem[];
  isOn: (index: number) => boolean;
  onSet: (index: number, value: boolean) => Promise<void>;
  existingServices?: Service[];
}): Service[] {
  const { platform, accessory, items, isOn, onSet } = opts;

  for (const service of opts.existingServices || []) {
    accessory.removeService(service);
  }

  return items.map((item, index) => {
    const service = accessory.getServiceById(platform.Service.Switch, item.subtype)
      || accessory.addService(platform.Service.Switch, item.displayName, item.subtype);

    service
      .setCharacteristic(platform.Characteristic.Name, item.displayName)
      .setCharacteristic(platform.Characteristic.ConfiguredName, item.displayName);

    service.getCharacteristic(platform.Characteristic.On)
      .onGet(async (): Promise<CharacteristicValue> => isOn(index))
      .onSet(async (value: CharacteristicValue) => onSet(index, value === true));

    return service;
  });
}

/** Push On characteristic updates for each switch in the radio group. */
export function updateRadioSwitchStates(
  platform: PlatformContext,
  services: Service[],
  isOn: (index: number) => boolean,
): void {
  services.forEach((service, index) => {
    service.updateCharacteristic(platform.Characteristic.On, isOn(index));
  });
}
