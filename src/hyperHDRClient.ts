import { Logger } from 'homebridge';
import axios from 'axios';

export interface HyperHDRConfig {
  enabled: boolean;
  host: string;
  port: number;
  component: 'LEDDEVICE' | 'ALL';
  token?: string;
}

export class HyperHDRClient {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private cachedState: boolean | undefined;

  constructor(private readonly log: Logger, private readonly config: HyperHDRConfig) {
    this.url = `http://${config.host}:${config.port}/json-rpc`;
    this.headers = config.token ? { Authorization: `token ${config.token}` } : {};
  }

  async getState(): Promise<boolean> {
    if (this.cachedState !== undefined) {
      // Return cache immediately, refresh in background for next poll
      this.fetchState().catch(() => {});
      return this.cachedState;
    }
    // First call: fetch synchronously so HomeKit gets a real value
    return this.fetchState();
  }

  private async fetchState(): Promise<boolean> {
    try {
      const response = await axios.post(this.url, { command: 'serverinfo' }, { headers: this.headers, timeout: 5000 });
      if (response.data?.success === false) {
        this.log.warn(`[HyperHDR] getState() rejected: ${response.data?.error ?? 'unknown error'}`);
      } else {
        const components: Array<{ name: string; enabled: boolean }> = response.data?.info?.components || [];
        const comp = components.find(c => c.name === this.config.component);
        this.cachedState = comp?.enabled ?? false;
        this.log.debug(`[HyperHDR] getState() → ${this.config.component} = ${this.cachedState}`);
      }
    } catch (error: any) {
      this.log.warn(`[HyperHDR] getState() failed: ${error?.message ?? error}`);
    }
    return this.cachedState ?? false;
  }

  async setBrightness(brightness: number): Promise<void> {
    if (!this.config.enabled) return;
    const body = {
      command: 'adjustment',
      adjustment: { brightness: Math.max(0, Math.min(100, Math.round(brightness))) },
    };
    try {
      this.log.debug(`[HyperHDR] setBrightness(${brightness}) → ${this.url}`);
      await axios.post(this.url, body, { headers: this.headers, timeout: 5000 });
    } catch (error: any) {
      this.log.warn(`[HyperHDR] setBrightness(${brightness}) failed: ${error?.message ?? error}`);
    }
  }

  async setPower(on: boolean): Promise<void> {
    if (!this.config.enabled) return;
    const body = {
      command: 'componentstate',
      componentstate: { component: this.config.component, state: on },
    };
    try {
      this.log.debug(`[HyperHDR] setPower(${on}) → ${this.url}`);
      const response = await axios.post(this.url, body, { headers: this.headers, timeout: 5000 });
      if (response.data?.success === false) {
        this.log.warn(`[HyperHDR] setPower(${on}) rejected: ${response.data?.error ?? 'unknown error'}`);
      } else {
        this.cachedState = on;
      }
    } catch (error: any) {
      this.log.warn(`[HyperHDR] setPower(${on}) failed: ${error?.message ?? error}`);
      // Never re-throw — HyperHDR is a side-channel, WLED must continue
    }
  }
}
