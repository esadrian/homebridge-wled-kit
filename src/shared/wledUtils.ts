import axios from 'axios';
import {
  DeviceConfig,
  DeviceSettings,
  NightlightSettings,
  ResolvedDiscoveryDefaults,
  WLEDPlatformConfig,
} from './configTypes';

/** Convert WLED bri (0–255) to HomeKit percent (0–100). */
export function briToPercent(bri: number): number {
  return Math.round((bri / 255) * 100);
}

/** Convert HomeKit percent (0–100) to WLED bri (0–255). */
export function percentToBri(percent: number): number {
  return Math.max(0, Math.min(255, Math.round((percent / 100) * 255)));
}

/** Clamp HomeKit color temperature mireds to 153–500. */
export function clampMireds(mireds: number): number {
  return Math.max(153, Math.min(500, mireds));
}

/** Convert WLED CCT (0=cool, 255=warm) to HomeKit mireds (153–500). */
export function cctToMireds(cct: number): number {
  return clampMireds(Math.round(153 + (cct / 255) * (500 - 153)));
}

/** Convert HomeKit mireds (153–500) to WLED CCT (0–255). */
export function miredsToCct(mireds: number): number {
  const clamped = clampMireds(mireds);
  return Math.round(((clamped - 153) / (500 - 153)) * 255);
}

/**
 * Convert RGB (0–255) to HSV for HomeKit (h 0–360, s/v 0–100).
 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r = r / 255;
  g = g / 255;
  b = b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  const s = max === 0 ? 0 : delta / max;
  const v = max;

  if (delta === 0) {
    h = 0;
  } else if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }

  h = Math.round(h * 60);
  if (h < 0) {
    h += 360;
  }

  return {
    h,
    s: Math.round(s * 100),
    v: Math.round(v * 100),
  };
}

/**
 * Convert HSV (h 0–360, s/v 0–100) to RGB (0–255).
 */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  h = h / 360;
  s = s / 100;
  v = v / 100;

  let r = 0, g = 0, b = 0;

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

export interface ParsedPreset {
  name: string;
  quickLabel: string;
  data: any;
}

/**
 * Normalize raw presets.json into a map keyed by preset id.
 * Skips metadata keys (_name, _type). Optionally skips reserved preset "0".
 */
export function parsePresetsRaw(
  rawPresets: Record<string, unknown>,
  opts: { skipZero?: boolean } = {},
): Record<string, ParsedPreset> {
  const raw = { ...rawPresets };
  delete raw._name;
  delete raw._type;

  const presets: Record<string, ParsedPreset> = {};

  for (const [id, data] of Object.entries(raw)) {
    if (opts.skipZero && id === '0') {
      continue;
    }
    if (typeof data !== 'object' || data === null) {
      continue;
    }
    const n = ('n' in data && typeof (data as any).n === 'string')
      ? (data as any).n
      : `Preset ${id}`;
    const ql = ('ql' in data && typeof (data as any).ql === 'string')
      ? (data as any).ql
      : '';

    presets[id] = {
      name: (ql ? `${ql} ` : '') + n,
      quickLabel: ql,
      data,
    };
  }

  return presets;
}

export interface WledInfoResult {
  name: string;
  version: string;
  mac: string;
  ledCount: number;
  segmentCount: number;
  raw: any;
}

/**
 * Fetch and normalize /json/info from a WLED device.
 * Throws on network/HTTP failure; returns null only when the response body is empty.
 */
export async function fetchWledInfo(
  host: string,
  port: number,
  timeout = 5000,
  axiosConfig: Record<string, unknown> = {},
): Promise<WledInfoResult | null> {
  const response = await axios.get(`http://${host}:${port}/json/info`, {
    timeout,
    ...axiosConfig,
  });
  const data = response.data;
  if (!data) {
    return null;
  }
  return {
    name: (data.name || `WLED ${host}`).replace(/\.local$/i, ''),
    version: data.ver || 'Unknown',
    mac: data.mac || 'Unknown',
    ledCount: data.leds?.count || 0,
    segmentCount: data.leds?.segs || 1,
    raw: data,
  };
}

/** True if /json/info payload looks like a WLED device. */
export function looksLikeWled(data: any): boolean {
  return !!(data && data.ver && (data.name || data.brand === 'WLED'));
}

/**
 * Devices from nested or legacy flat platform config.
 */
export function getDevicesFromConfig(config: WLEDPlatformConfig | Record<string, unknown> | undefined): DeviceConfig[] {
  const c = config as WLEDPlatformConfig | undefined;
  return c?.manualDevicesSection?.devices || c?.devices || [];
}

/** Effective device settings: nested `deviceSettings` or legacy flat fields on the device. */
export function resolveDeviceSettings(device: DeviceConfig): DeviceSettings {
  return (device.deviceSettings || device) as DeviceSettings;
}

/** Defaults for auto-discovered devices (nested section + legacy flat keys). */
export function resolveDiscoveryDefaults(config: WLEDPlatformConfig): ResolvedDiscoveryDefaults {
  const section = config.defaultSettingsSection || {};
  return {
    pollInterval: section.defaultPollInterval !== undefined
      ? section.defaultPollInterval
      : (config.defaultPollInterval || 10),
    useWebSockets: section.defaultUseWebSockets !== undefined
      ? section.defaultUseWebSockets
      : config.defaultUseWebSockets !== false,
    usePresetService: section.defaultUsePresetService !== undefined
      ? section.defaultUsePresetService
      : config.defaultUsePresetService !== false,
  };
}

/**
 * Convert hostname to a friendly Title Case name (e.g. holiday-lights → Holiday Lights).
 * IP addresses return fallbackName.
 */
export function getDisplayNameFromHost(host: string, fallbackName: string): string {
  const name = host.replace(/\.local$/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
    return fallbackName;
  }
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Prefer configured name; otherwise derive from host. */
export function resolveDisplayName(host: string, configuredName?: string, fallbackName?: string): string {
  const configured = (configuredName || '').trim();
  if (configured) {
    return configured;
  }
  return getDisplayNameFromHost(host, fallbackName || host);
}

export interface NightlightConfig {
  enabled: boolean;
  timers: Array<{ name: string; seconds: number }>;
}

/**
 * Resolve effective nightlight config: device overrides global when present.
 * Empty device timers fall back to global timers (legacy behavior).
 */
export function resolveNightlightConfig(
  deviceSettings: DeviceSettings | Record<string, unknown> | undefined,
  globalNightlight: NightlightSettings | Record<string, unknown> | undefined,
): NightlightConfig {
  const global = globalNightlight || {};
  const device = (deviceSettings as DeviceSettings | undefined)?.nightlight;

  if (device) {
    const deviceTimers = Array.isArray(device.timers) ? device.timers : [];
    return {
      enabled: device.enabled === true,
      timers: deviceTimers.length > 0
        ? deviceTimers
        : (Array.isArray(global.timers) ? global.timers as NightlightConfig['timers'] : []),
    };
  }

  return {
    enabled: (global as NightlightSettings).enabled === true,
    timers: Array.isArray(global.timers) ? global.timers as NightlightConfig['timers'] : [],
  };
}

/** Match cached accessory records belonging to this plugin (current + legacy names). */
export function isWledCachedAccessory(accessory: any): boolean {
  return accessory?.plugin === 'homebridge-wled-kit'
    || accessory?.plugin === 'homebridge-simpler-wled'
    || accessory?.platform === 'WLED Kit'
    || accessory?.platform === 'Simpler WLED'
    || accessory?.platform === 'WLED';
}
