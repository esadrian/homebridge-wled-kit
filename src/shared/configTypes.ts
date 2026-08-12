import { PlatformConfig } from 'homebridge';

/** Nightlight timer entry (global or per-device). */
export interface NightlightTimerConfig {
  name: string;
  seconds: number;
}

export interface NightlightSettings {
  enabled?: boolean;
  timers?: NightlightTimerConfig[];
}

export interface HyperHDRDeviceSettings {
  enabled?: boolean;
  host?: string;
  port?: number;
  component?: 'LEDDEVICE' | 'ALL' | string;
  token?: string;
  serviceType?: 'Switch' | 'Outlet' | string;
  switchName?: string;
  pollInterval?: number;
}

/**
 * Per-device settings (nested under `deviceSettings`, or legacy flat on the device object).
 */
export interface DeviceSettings {
  nightlight?: NightlightSettings;
  usePresetService?: boolean;
  singleAccessoryWithTV?: boolean;
  useWebSockets?: boolean;
  exposeSegments?: boolean;
  exposeEffects?: boolean;
  enabledEffects?: Array<string | number>;
  pollInterval?: number;
  enabledPresets?: string[];
  hyperHDR?: HyperHDRDeviceSettings;
  /** Allow legacy / unknown keys without losing type safety on known fields. */
  [key: string]: unknown;
}

export interface DeviceConfig {
  name: string;
  host: string;
  port?: number;
  enabled?: boolean;
  deviceSettings?: DeviceSettings;
  /** Legacy: settings sometimes lived on the device object itself. */
  usePresetService?: boolean;
  useWebSockets?: boolean;
  pollInterval?: number;
  singleAccessoryWithTV?: boolean;
  exposeSegments?: boolean;
  exposeEffects?: boolean;
  enabledPresets?: string[];
  nightlight?: NightlightSettings;
  hyperHDR?: HyperHDRDeviceSettings;
  firmwareVersion?: string;
  macAddress?: string;
  ledCount?: number;
  [key: string]: unknown;
}

export interface DefaultSettingsSection {
  defaultUsePresetService?: boolean;
  defaultUseWebSockets?: boolean;
  defaultPollInterval?: number;
}

export interface ManualDevicesSection {
  nightlight?: NightlightSettings;
  devices?: DeviceConfig[];
}

export interface DiscoverySection {
  autoDiscover?: boolean;
}

/**
 * Typed platform config (extends Homebridge PlatformConfig).
 * Supports nested sections and legacy flat keys.
 */
export interface WLEDPlatformConfig extends PlatformConfig {
  name?: string;
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | string;
  discoverySection?: DiscoverySection;
  defaultSettingsSection?: DefaultSettingsSection;
  autoStopDiscoveryWhenAllConfigured?: boolean;
  tvNameSuffix?: string;
  customInputLabel?: string;
  manualDevicesSection?: ManualDevicesSection;
  /** Legacy flat device list */
  devices?: DeviceConfig[];
  /** Legacy flat defaults */
  defaultUsePresetService?: boolean;
  defaultUseWebSockets?: boolean;
  defaultPollInterval?: number;
}

/** Resolved defaults applied to auto-discovered devices. */
export interface ResolvedDiscoveryDefaults {
  pollInterval: number;
  useWebSockets: boolean;
  usePresetService: boolean;
}
