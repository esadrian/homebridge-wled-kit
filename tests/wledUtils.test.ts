import {
  briToPercent,
  percentToBri,
  clampMireds,
  cctToMireds,
  miredsToCct,
  rgbToHsv,
  hsvToRgb,
  getDisplayNameFromHost,
  resolveDisplayName,
  getDevicesFromConfig,
  resolveDeviceSettings,
  resolveDiscoveryDefaults,
  resolveNightlightConfig,
  parsePresetsRaw,
  looksLikeWled,
  isWledCachedAccessory,
} from '../src/shared/wledUtils';
import { WLEDPlatformConfig } from '../src/shared/configTypes';

describe('wledUtils', () => {
  describe('brightness', () => {
    it('converts bri <-> percent round-trip at extremes', () => {
      expect(briToPercent(0)).toBe(0);
      expect(briToPercent(255)).toBe(100);
      expect(percentToBri(0)).toBe(0);
      expect(percentToBri(100)).toBe(255);
    });
  });

  describe('color temperature', () => {
    it('clamps mireds to HomeKit range', () => {
      expect(clampMireds(100)).toBe(153);
      expect(clampMireds(600)).toBe(500);
      expect(clampMireds(300)).toBe(300);
    });

    it('maps CCT extremes to mireds', () => {
      expect(cctToMireds(0)).toBe(153);
      expect(cctToMireds(255)).toBe(500);
    });

    it('maps mireds back toward CCT', () => {
      expect(miredsToCct(153)).toBe(0);
      expect(miredsToCct(500)).toBe(255);
    });
  });

  describe('rgbToHsv / hsvToRgb', () => {
    it('converts pure red', () => {
      const hsv = rgbToHsv(255, 0, 0);
      expect(hsv.h).toBe(0);
      expect(hsv.s).toBe(100);
      expect(hsv.v).toBe(100);
    });

    it('round-trips primary colors approximately', () => {
      for (const [r, g, b] of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]]) {
        const hsv = rgbToHsv(r, g, b);
        const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
        expect(Math.abs(rgb.r - r)).toBeLessThanOrEqual(1);
        expect(Math.abs(rgb.g - g)).toBeLessThanOrEqual(1);
        expect(Math.abs(rgb.b - b)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('naming', () => {
    it('title-cases hostnames and falls back for IPs', () => {
      expect(getDisplayNameFromHost('holiday-lights.local', 'X')).toBe('Holiday Lights');
      expect(getDisplayNameFromHost('192.168.1.1', 'Living')).toBe('Living');
      expect(resolveDisplayName('host.local', '  Custom  ')).toBe('Custom');
      expect(resolveDisplayName('kitchen-strip.local')).toBe('Kitchen Strip');
    });
  });

  describe('config helpers', () => {
    it('reads nested and legacy device lists', () => {
      expect(getDevicesFromConfig({
        manualDevicesSection: { devices: [{ name: 'A', host: 'a' }] },
      } as WLEDPlatformConfig)).toHaveLength(1);
      expect(getDevicesFromConfig({
        devices: [{ name: 'B', host: 'b' }],
      } as WLEDPlatformConfig)[0].name).toBe('B');
    });

    it('resolves device settings from nested or flat shape', () => {
      expect(resolveDeviceSettings({
        name: 'X',
        host: 'x',
        deviceSettings: { pollInterval: 5 },
      }).pollInterval).toBe(5);
      expect(resolveDeviceSettings({
        name: 'Y',
        host: 'y',
        pollInterval: 8,
      } as any).pollInterval).toBe(8);
    });

    it('resolves discovery defaults with legacy fallbacks', () => {
      expect(resolveDiscoveryDefaults({
        defaultSettingsSection: {
          defaultPollInterval: 12,
          defaultUseWebSockets: false,
          defaultUsePresetService: false,
        },
      } as WLEDPlatformConfig)).toEqual({
        pollInterval: 12,
        useWebSockets: false,
        usePresetService: false,
      });

      expect(resolveDiscoveryDefaults({
        defaultPollInterval: 20,
      } as WLEDPlatformConfig).pollInterval).toBe(20);
    });

    it('resolves nightlight device vs global', () => {
      const global = { enabled: true, timers: [{ name: '5m', seconds: 300 }] };
      expect(resolveNightlightConfig({}, global).enabled).toBe(true);
      expect(resolveNightlightConfig({ nightlight: { enabled: true, timers: [] } }, global).timers)
        .toEqual(global.timers);
      expect(resolveNightlightConfig({ nightlight: { enabled: false, timers: [{ name: '1m', seconds: 60 }] } }, global))
        .toEqual({ enabled: false, timers: [{ name: '1m', seconds: 60 }] });
    });
  });

  describe('parsePresetsRaw', () => {
    it('skips metadata and optional zero preset', () => {
      const parsed = parsePresetsRaw({
        _name: 'x',
        _type: 'y',
        '0': { n: 'Reserved' },
        '1': { n: 'Party', ql: '🎉' },
      }, { skipZero: true });
      expect(parsed['0']).toBeUndefined();
      expect(parsed['1'].name).toContain('Party');
      expect(parsed['1'].quickLabel).toBe('🎉');
    });
  });

  describe('looksLikeWled / isWledCachedAccessory', () => {
    it('detects WLED info payloads', () => {
      expect(looksLikeWled({ ver: '0.14', name: 'Strip' })).toBe(true);
      expect(looksLikeWled({ ver: '0.14', brand: 'WLED' })).toBe(true);
      expect(looksLikeWled({ name: 'nope' })).toBe(false);
    });

    it('matches current and legacy plugin cache names', () => {
      expect(isWledCachedAccessory({ plugin: 'homebridge-wled-kit' })).toBe(true);
      expect(isWledCachedAccessory({ platform: 'Simpler WLED' })).toBe(true);
      expect(isWledCachedAccessory({ plugin: 'other' })).toBe(false);
    });
  });
});
