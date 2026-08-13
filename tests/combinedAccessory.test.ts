import { WLEDCombinedAccessory } from '../src/accessories/combinedAccessory';
import { WLEDDevice, WLEDState } from '../src/device/wledDevice';
import { MockLogger, MockAPI, MockPlatformAccessory, createMockPlatformConfig } from './mocks/homebridge';

jest.mock('../src/device/wledDevice');

describe('WLEDCombinedAccessory', () => {
  let mockLogger: MockLogger;
  let mockApi: MockAPI;
  let mockAccessory: MockPlatformAccessory;
  let mockWledDevice: jest.Mocked<WLEDDevice>;
  let platform: any;

  beforeEach(() => {
    mockLogger = new MockLogger();
    mockApi = new MockAPI();

    platform = {
      log: mockLogger,
      config: createMockPlatformConfig(),
      api: mockApi,
      Service: mockApi.hap.Service,
      Characteristic: mockApi.hap.Characteristic,
      getTvNameSuffix: () => 'Presets',
      getCustomInputLabel: () => 'Custom',
    };

    mockAccessory = new MockPlatformAccessory('Test Combined', 'combined-uuid');
    mockAccessory.context.device = {
      name: 'Test Combined',
      host: '192.168.1.100',
      port: 80,
      deviceSettings: { enabledPresets: [] },
    };

    const initialState: WLEDState = {
      on: false,
      brightness: 0,
      colorMode: 'rgb',
      color: { r: 0, g: 0, b: 0 },
      hue: 0,
      saturation: 0,
      colorTemperature: 370,
      effect: 0,
      presetId: -1,
    };

    mockWledDevice = {
      getState: jest.fn(() => initialState),
      getActivePresetId: jest.fn(() => -1),
      addStateListener: jest.fn(),
      addPresetListener: jest.fn(),
      removeStateListener: jest.fn(),
      refreshState: jest.fn(),
      getPresets: jest.fn().mockResolvedValue({}),
      getDeviceInfo: jest.fn().mockResolvedValue({ version: '0.15.0', name: 'WLED', mac: 'aa', segmentCount: 1, ledCount: 30 }),
      setPower: jest.fn().mockResolvedValue(undefined),
      setBrightness: jest.fn().mockResolvedValue(undefined),
      setHSV: jest.fn().mockResolvedValue(undefined),
      setColorTemperature: jest.fn().mockResolvedValue(undefined),
      activatePreset: jest.fn().mockResolvedValue(undefined),
    } as any;
  });

  it('creates lightbulb and television services', () => {
    new WLEDCombinedAccessory(platform, mockAccessory as any, mockWledDevice);

    expect(mockAccessory.getService(mockApi.hap.Service.Lightbulb.UUID)).toBeDefined();
    expect(mockAccessory.getService(mockApi.hap.Service.Television.UUID)).toBeDefined();
    expect(mockWledDevice.addStateListener).toHaveBeenCalled();
  });

  it('delegates light power to the device', async () => {
    const accessory = new WLEDCombinedAccessory(platform, mockAccessory as any, mockWledDevice);
    await accessory.setOn(true);
    expect(mockWledDevice.setPower).toHaveBeenCalledWith(true);
  });

  it('syncs HyperHDR when light power changes and not when HyperHDR client is absent', async () => {
    const mockHyperHDR = {
      setPower: jest.fn().mockResolvedValue(undefined),
      setBrightness: jest.fn().mockResolvedValue(undefined),
      getState: jest.fn().mockResolvedValue(false),
      startPolling: jest.fn(),
      stopPolling: jest.fn(),
    };
    mockAccessory.context.device.deviceSettings = {
      enabledPresets: [],
      hyperHDR: { enabled: true, host: '192.168.1.50', port: 8090, component: 'LEDDEVICE' },
    };

    const accessory = new WLEDCombinedAccessory(
      platform,
      mockAccessory as any,
      mockWledDevice,
      mockHyperHDR as any,
    );
    mockHyperHDR.setPower.mockClear();
    mockHyperHDR.setBrightness.mockClear();

    await accessory.setOn(true);
    expect(mockHyperHDR.setPower).toHaveBeenCalledWith(true);

    // External brightness change (e.g. TV remote) reaches HyperHDR via state listener
    mockHyperHDR.setBrightness.mockClear();
    const listener = mockWledDevice.addStateListener.mock.calls[0][0];
    listener({
      on: true,
      brightness: 70,
      colorMode: 'rgb',
      color: { r: 0, g: 0, b: 0 },
      hue: 0,
      saturation: 0,
      colorTemperature: 370,
      effect: 0,
      presetId: -1,
    });
    expect(mockHyperHDR.setBrightness).toHaveBeenCalledWith(70);
  });
});
