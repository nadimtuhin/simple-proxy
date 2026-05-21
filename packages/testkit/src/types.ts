import type { ProxyStats, ProxyRequestPayload, ShortCircuitResponse } from '@nadimtuhin/simple-proxy-core';

/** Options for creating a proxy server in a compliance test */
export interface CreateProxyOptions {
  upstreamUrl: string;
  headers?: () => Record<string, string>;
  /** beforeRequest hook — receives payload only (adapter wraps to its own signature) */
  beforeRequest?: (payload: ProxyRequestPayload) => void | ShortCircuitResponse | Promise<void | ShortCircuitResponse>;
  /** onResponse — receives ProxyStats only */
  onResponse?: (stats: ProxyStats) => void | Promise<void>;
  timeout?: number;
  proxyPath?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  route?: string;
}

export interface ProxyHandle {
  url: string;
  close(): Promise<void>;
}

/** Each framework adapter implements this to plug into the compliance suite */
export interface ComplianceAdapter {
  createProxy(options: CreateProxyOptions): Promise<ProxyHandle>;
}
