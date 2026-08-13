import { API, Characteristic, Logger, PlatformConfig, Service } from 'homebridge';
import { WLEDPlatformConfig } from './configTypes';

/**
 * Minimal platform surface used by accessories/controllers.
 * Breaks the soft circular dependency on the concrete WLEDPlatform class.
 */
export interface PlatformContext {
  readonly log: Logger;
  readonly api: API;
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  readonly config: PlatformConfig | WLEDPlatformConfig;
  getTvNameSuffix(): string;
  getCustomInputLabel(): string;
}
