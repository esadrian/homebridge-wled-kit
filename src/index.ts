import { API } from 'homebridge';
import { PLATFORM_NAME } from './shared/settings';
import { WLEDPlatform } from './platform';

/**
 * This method registers the platform with Homebridge.
 * Prefer the 2-argument form (platform name + constructor) from the official template.
 */
export = (api: API) => {
  api.registerPlatform(PLATFORM_NAME, WLEDPlatform);
};
