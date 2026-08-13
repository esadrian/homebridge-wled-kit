import { HyperHDRClient } from '../src/device/hyperHDRClient';
import { MockLogger } from './mocks/homebridge';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

describe('HyperHDRClient', () => {
  let mockAxios: MockAdapter;
  let client: HyperHDRClient;
  const logger = new MockLogger();

  beforeEach(() => {
    mockAxios = new MockAdapter(axios);
    client = new HyperHDRClient(logger as any, {
      enabled: true,
      host: '192.168.1.50',
      port: 8090,
      component: 'LEDDEVICE',
    });
  });

  afterEach(() => {
    client.stopPolling();
    mockAxios.restore();
  });

  it('getState fetches component enabled flag', async () => {
    mockAxios.onPost('http://192.168.1.50:8090/json-rpc').reply(200, {
      success: true,
      info: { components: [{ name: 'LEDDEVICE', enabled: true }] },
    });
    await expect(client.getState()).resolves.toBe(true);
  });

  it('setPower updates cache and does not throw on failure', async () => {
    mockAxios.onPost('http://192.168.1.50:8090/json-rpc').reply(200, { success: true });
    await expect(client.setPower(true)).resolves.toBeUndefined();

    mockAxios.reset();
    mockAxios.onPost('http://192.168.1.50:8090/json-rpc').networkError();
    await expect(client.setPower(false)).resolves.toBeUndefined();
  });

  it('ping reports online status', async () => {
    mockAxios.onPost('http://192.168.1.50:8090/json-rpc').reply(200, {
      success: true,
      info: { components: [{ name: 'LEDDEVICE', enabled: false }] },
    });
    await expect(client.ping()).resolves.toEqual({ online: true, enabled: false });
  });

  it('startPolling notifies on change', async () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    mockAxios.onPost('http://192.168.1.50:8090/json-rpc').replyOnce(200, {
      success: true,
      info: { components: [{ name: 'LEDDEVICE', enabled: false }] },
    }).onPost('http://192.168.1.50:8090/json-rpc').reply(200, {
      success: true,
      info: { components: [{ name: 'LEDDEVICE', enabled: true }] },
    });

    client.startPolling(2, onChange);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(2000);
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledWith(true);
    jest.useRealTimers();
  });

  it('stopPolling clears onChange so later fetchState does not notify', async () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    mockAxios.onPost('http://192.168.1.50:8090/json-rpc').reply(200, {
      success: true,
      info: { components: [{ name: 'LEDDEVICE', enabled: false }] },
    });

    client.startPolling(2, onChange);
    await Promise.resolve();
    client.stopPolling();
    onChange.mockClear();

    mockAxios.reset();
    mockAxios.onPost('http://192.168.1.50:8090/json-rpc').reply(200, {
      success: true,
      info: { components: [{ name: 'LEDDEVICE', enabled: true }] },
    });

    // Force a state fetch after stop — should not call onChange
    await (client as any).fetchState();
    expect(onChange).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
