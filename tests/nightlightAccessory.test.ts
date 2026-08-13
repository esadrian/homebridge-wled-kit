import { WLEDNightlightAccessory } from '../src/accessories/nightlightAccessory';
import { WLEDDevice, WLEDState } from '../src/device/wledDevice';
import { MockLogger, MockAPI, MockPlatformAccessory, createMockPlatformConfig } from './mocks/homebridge';

jest.mock('../src/device/wledDevice');

describe('WLEDNightlightAccessory', () => {
  let mockLogger: MockLogger;
  let mockApi: MockAPI;
  let mockAccessory: MockPlatformAccessory;
  let mockWledDevice: jest.Mocked<WLEDDevice>;
  let platform: any;
  let stateListener: ((state: WLEDState) => void) | undefined;

  beforeEach(() => {
    mockLogger = new MockLogger();
    mockApi = new MockAPI();
    stateListener = undefined;

    platform = {
      log: mockLogger,
      config: createMockPlatformConfig({
        manualDevicesSection: {
          nightlight: { enabled: false, timers: [] },
          devices: [],
        },
      }),
      api: mockApi,
      Service: mockApi.hap.Service,
      Characteristic: mockApi.hap.Characteristic,
    };

    mockAccessory = new MockPlatformAccessory('Test Nightlight', 'nl-uuid');
    mockAccessory.context.device = {
      name: 'Test WLED',
      host: '192.168.1.100',
      port: 80,
      deviceSettings: {
        nightlight: {
          enabled: true,
          timers: [
            { name: '5 min', seconds: 300 },
            { name: '40 min', seconds: 2400 },
          ],
        },
      },
    };

    mockWledDevice = {
      getNightlightState: jest.fn(() => ({ active: false })),
      startNightlight: jest.fn().mockResolvedValue(undefined),
      stopNightlight: jest.fn().mockResolvedValue(undefined),
      addStateListener: jest.fn((listener: (state: WLEDState) => void) => {
        stateListener = listener;
      }),
      removeStateListener: jest.fn(),
      getState: jest.fn(),
    } as any;
  });

  it('should create a switch service per timer', () => {
    new WLEDNightlightAccessory(platform, mockAccessory as any, mockWledDevice);

    const switchA = mockAccessory.getServiceById(mockApi.hap.Service.Switch, 'nightlight-timer-0');
    const switchB = mockAccessory.getServiceById(mockApi.hap.Service.Switch, 'nightlight-timer-1');
    expect(switchA).toBeDefined();
    expect(switchB).toBeDefined();
    expect(mockWledDevice.addStateListener).toHaveBeenCalled();
  });

  it('should start nightlight when a timer switch is turned on', async () => {
    new WLEDNightlightAccessory(platform, mockAccessory as any, mockWledDevice);
    const switchA = mockAccessory.getServiceById(mockApi.hap.Service.Switch, 'nightlight-timer-0');
    await switchA!.getCharacteristic(mockApi.hap.Characteristic.On).setValue(true);

    expect(mockWledDevice.startNightlight).toHaveBeenCalledWith(300);
  });

  it('should clear active timer when WLED reports nightlight off', async () => {
    const accessory = new WLEDNightlightAccessory(platform, mockAccessory as any, mockWledDevice);
    const switchA = mockAccessory.getServiceById(mockApi.hap.Service.Switch, 'nightlight-timer-0');
    await switchA!.getCharacteristic(mockApi.hap.Characteristic.On).setValue(true);
    expect((accessory as any).activeTimerIndex).toBe(0);

    mockWledDevice.getNightlightState.mockReturnValue({ active: false });
    stateListener?.({} as WLEDState);

    expect((accessory as any).activeTimerIndex).toBeNull();
  });

  it('should match active timer from WLED duration', () => {
    mockWledDevice.getNightlightState.mockReturnValue({ active: true, durationMinutes: 40 });
    const accessory = new WLEDNightlightAccessory(platform, mockAccessory as any, mockWledDevice);

    expect((accessory as any).activeTimerIndex).toBe(1);
  });
});
