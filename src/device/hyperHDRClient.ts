import { Logger } from 'homebridge';
import axios from 'axios';

export interface HyperHDRConfig {
  enabled: boolean;
  host: string;
  port: number;
  component: 'LEDDEVICE' | 'ALL';
  token?: string;
  /** Optional seconds between HyperHDR→HomeKit state polls. */
  pollInterval?: number;
}

export class HyperHDRClient {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private cachedState: boolean | undefined;
  private pollTimer?: NodeJS.Timeout;
  private onChange?: (on: boolean) => void;

  constructor(private readonly log: Logger, private readonly config: HyperHDRConfig) {
    this.url = `http://${config.host}:${config.port}/json-rpc`;
    this.headers = config.token ? { Authorization: `token ${config.token}` } : {};
  }

  async getState(): Promise<boolean> {
    if (this.cachedState !== undefined) {
      this.fetchState().catch(() => {});
      return this.cachedState;
    }
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
        const next = comp?.enabled ?? false;
        const changed = this.cachedState !== undefined && this.cachedState !== next;
        this.cachedState = next;
        this.log.debug(`[HyperHDR] getState() → ${this.config.component} = ${this.cachedState}`);
        if (changed && this.onChange) {
          this.onChange(next);
        }
      }
    } catch (error: any) {
      this.log.warn(`[HyperHDR] getState() failed: ${error?.message ?? error}`);
    }
    return this.cachedState ?? false;
  }

  /**
   * Poll HyperHDR and notify when component state changes (HomeKit sync).
   */
  startPolling(intervalSeconds: number, onChange?: (on: boolean) => void): void {
    this.stopPolling();
    this.onChange = onChange;
    const ms = Math.max(2, intervalSeconds) * 1000;
    this.pollTimer = setInterval(() => {
      this.fetchState().catch(() => {});
    }, ms);
    this.fetchState().catch(() => {});
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.onChange = undefined;
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
    }
  }

  /** Lightweight reachability/component probe for the Custom UI. */
  async ping(): Promise<{ online: boolean; enabled?: boolean; version?: string; message?: string }> {
    try {
      const response = await axios.post(this.url, { command: 'serverinfo' }, { headers: this.headers, timeout: 4000 });
      if (response.data?.success === false) {
        return { online: false, message: response.data?.error || 'Rejected' };
      }
      const components: Array<{ name: string; enabled: boolean }> = response.data?.info?.components || [];
      const comp = components.find(c => c.name === this.config.component);
      return {
        online: true,
        enabled: comp?.enabled ?? false,
        version: response.data?.info?.hyperhdr?.version || response.data?.info?.version,
      };
    } catch (error: any) {
      return { online: false, message: error?.code || error?.message || 'Unreachable' };
    }
  }

  /** One-shot ping without keeping a long-lived client (Custom UI). */
  static async pingOnce(opts: {
    host: string;
    port?: number;
    token?: string;
    component?: string;
  }): Promise<{ online: boolean; enabled?: boolean; version?: string; message?: string }> {
    const noopLog = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      log: () => {},
      success: () => {},
    } as unknown as Logger;
    const client = new HyperHDRClient(noopLog, {
      enabled: true,
      host: opts.host,
      port: opts.port || 8090,
      component: (opts.component || 'LEDDEVICE') as HyperHDRConfig['component'],
      token: opts.token,
    });
    return client.ping();
  }
}
