import { WLEDLightAccessory } from '../src/accessories/platformAccessory';
import { WLEDDevice, WLEDState } from '../src/device/wledDevice';
import { MockLogger, MockAPI, MockPlatformAccessory, createMockPlatformConfig } from './mocks/homebridge';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

jest.mock('../src/device/wledDevice');

describe('WLEDLightAccessory', () => {
  let mockAxios: MockAdapter;
  let mockLogger: MockLogger;
  let mockApi: MockAPI;
  let mockAccessory: MockPlatformAccessory;
  let mockWledDevice: jest.Mocked<WLEDDevice>;
  let platform: any;
  let accessory: WLEDLightAccessory;

  beforeEach(() => {
    mockAxios = new MockAdapter(axios);
    mockLogger = new MockLogger();
    mockApi = new MockAPI();

    platform = {
      log: mockLogger,
      config: createMockPlatformConfig(),
      api: mockApi,
      Service: mockApi.hap.Service,
      Characteristic: mockApi.hap.Characteristic,
    };

    mockAccessory = new MockPlatformAccessory('Test WLED', 'test-uuid', mockApi.hap.Categories.LIGHTBULB);
    mockAccessory.context.device = {
      name: 'Test WLED',
      host: '192.168.1.100',
      port: 80,
    };

    const initialState: WLEDState = {
      on: false,
      brightness: 0,
      colorMode: 'rgb',
      color: { r: 0, g: 0, b: 0 },
      hue: 0,
      saturation: 0,
      colorTemperature: 140,
      effect: 0,
      presetId: -1,
    };

    mockWledDevice = {
      getState: jest.fn(() => initialState),
      addStateListener: jest.fn(),
      removeStateListener: jest.fn(),
      refreshState: jest.fn().mockResolvedValue(undefined),
      setPower: jest.fn().mockResolvedValue(undefined),
      setBrightness: jest.fn().mockResolvedValue(undefined),
      setHSV: jest.fn().mockResolvedValue(undefined),
      setColorTemperature: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn(),
    } as any;

    jest.clearAllMocks();
  });

  afterEach(() => {
    mockAxios.restore();
  });

  describe('Initialization', () => {
    it('should create accessory with lightbulb service', () => {
      accessory = new WLEDLightAccessory(platform, mockAccessory as any, mockWledDevice);

      const lightService = mockAccessory.getService(mockApi.hap.Service.Lightbulb.UUID);
      expect(lightService).toBeDefined();
    });

    it('should set accessory information', () => {
      accessory = new WLEDLightAccessory(platform, mockAccessory as any, mockWledDevice);

      const infoService = mockAccessory.getService(mockApi.hap.Service.AccessoryInformation.UUID);
      expect(infoService).toBeDefined();
    });

    it('should register state listener', () => {
      accessory = new WLEDLightAccessory(platform, mockAccessory as any, mockWledDevice);

      expect(mockWledDevice.addStateListener).toHaveBeenCalled();
    });
  });

  describe('Power Control', () => {
    beforeEach(() => {
      accessory = new WLEDLightAccessory(platform, mockAccessory as any, mockWledDevice);
    });

    it('should get power state', async () => {
      mockWledDevice.getState.mockReturnValue({
        on: true,
        brightness: 50,
        colorMode: 'rgb',
        color: { r: 0, g: 0, b: 0 },
        hue: 0,
        saturation: 0,
        colorTemperature: 140,
        effect: 0,
        presetId: -1,
      });

      const on = await (accessory as any).getOn();
      expect(on).toBe(true);
    });

    it('should set power state on', async () => {
      await (accessory as any).setOn(true);
      expect(mockWledDevice.setPower).toHaveBeenCalledWith(true);
    });

    it('should set power state off', async () => {
      await (accessory as any).setOn(true);
      mockWledDevice.setPower.mockClear();
      await (accessory as any).setOn(false);
      expect(mockWledDevice.setPower).toHaveBeenCalledWith(false);
    });
  });

  describe('Brightness Control', () => {
    beforeEach(() => {
      accessory = new WLEDLightAccessory(platform, mockAccessory as any, mockWledDevice);
    });

    it('should get brightness', async () => {
      mockWledDevice.getState.mockReturnValue({
        on: true,
        brightness: 75,
        colorMode: 'rgb',
        color: { r: 0, g: 0, b: 0 },
        hue: 0,
        saturation: 0,
        colorTemperature: 140,
        effect: 0,
        presetId: -1,
      });

      const brightness = await (accessory as any).getBrightness();
      expect(brightness).toBe(75);
    });

    it('should set brightness', async () => {
      await (accessory as any).setBrightness(80);
      expect(mockWledDevice.setBrightness).toHaveBeenCalledWith(80);
    });
  });

  describe('HyperHDR Sync', () => {
    let mockHyperHDR: { setPower: jest.Mock; setBrightness: jest.Mock; getState: jest.Mock; startPolling: jest.Mock; stopPolling: jest.Mock };

    beforeEach(() => {
      mockHyperHDR = {
        setPower: jest.fn().mockResolvedValue(undefined),
        setBrightness: jest.fn().mockResolvedValue(undefined),
        getState: jest.fn().mockResolvedValue(false),
        startPolling: jest.fn(),
        stopPolling: jest.fn(),
      };
      mockAccessory.context.device.deviceSettings = {
        hyperHDR: { enabled: true, host: '192.168.1.50', port: 8090, component: 'LEDDEVICE' },
      };
      accessory = new WLEDLightAccessory(platform, mockAccessory as any, mockWledDevice, mockHyperHDR as any);
      mockHyperHDR.setPower.mockClear();
      mockHyperHDR.setBrightness.mockClear();
    });

    it('mirrors power to HyperHDR on HomeKit setOn', async () => {
      await accessory.setOn(true);
      expect(mockWledDevice.setPower).toHaveBeenCalledWith(true);
      expect(mockHyperHDR.setPower).toHaveBeenCalledWith(true);
    });

    it('mirrors brightness to HyperHDR on HomeKit setBrightness', async () => {
      await accessory.setBrightness(60);
      expect(mockWledDevice.setBrightness).toHaveBeenCalledWith(60);
      expect(mockHyperHDR.setBrightness).toHaveBeenCalledWith(60);
    });

    it('mirrors external WLED state changes to HyperHDR via state listener', () => {
      const listener = mockWledDevice.addStateListener.mock.calls[0][0];
      listener({
        on: true,
        brightness: 40,
        colorMode: 'rgb',
        color: { r: 0, g: 0, b: 0 },
        hue: 0,
        saturation: 0,
        colorTemperature: 370,
        effect: 0,
        presetId: -1,
      });
      expect(mockHyperHDR.setPower).toHaveBeenCalledWith(true);
      expect(mockHyperHDR.setBrightness).toHaveBeenCalledWith(40);
    });

    it('does not re-sync HyperHDR on repeated identical external state', () => {
      const listener = mockWledDevice.addStateListener.mock.calls[0][0];
      const state = {
        on: true,
        brightness: 40,
        colorMode: 'rgb' as const,
        color: { r: 0, g: 0, b: 0 },
        hue: 0,
        saturation: 0,
        colorTemperature: 370,
        effect: 0,
        presetId: -1,
      };
      listener(state);
      mockHyperHDR.setPower.mockClear();
      mockHyperHDR.setBrightness.mockClear();
      listener(state);
      expect(mockHyperHDR.setPower).not.toHaveBeenCalled();
      expect(mockHyperHDR.setBrightness).not.toHaveBeenCalled();
    });

    it('attaches a HyperHDR switch service', () => {
      const switchSvc = mockAccessory.getServiceById(mockApi.hap.Service.Switch.UUID, 'hyperhdr-switch');
      expect(switchSvc).toBeDefined();
    });
  });

  describe('Without HyperHDR', () => {
    it('does not create HyperHDR switch when client is absent', () => {
      accessory = new WLEDLightAccessory(platform, mockAccessory as any, mockWledDevice);
      const switchSvc = mockAccessory.getServiceById(mockApi.hap.Service.Switch.UUID, 'hyperhdr-switch');
      expect(switchSvc).toBeUndefined();
    });
  });
});
