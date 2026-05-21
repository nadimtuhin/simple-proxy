import { axiosProxyRequest } from './proxy.js';
import { buildUpstreamStats, buildErrorStats } from './stats.js';
import { isShortCircuitResponse } from './errors.js';
import type {
  ProxyRequestPayload,
  ProxyResponse,
  ShortCircuitResponse,
  ProxyError,
  BeforeRequestHook,
  OnResponseCallback,
  ProxyStats,
} from './types.js';

export type PipelineHooks = {
  beforeRequest?: BeforeRequestHook;
  onResponse?: OnResponseCallback;
};

export type PipelineCallbacks = {
  onShortCircuit: (result: ShortCircuitResponse) => Promise<void>;
  onSuccess: (response: ProxyResponse) => Promise<void>;
  onError: (error: ProxyError) => Promise<ProxyError>;
};

function buildShortCircuitStats(
  payload: ProxyRequestPayload,
  status: number,
  startedAt: number
): ProxyStats {
  return {
    url: payload.url,
    method: payload.method,
    status,
    durationMs: Date.now() - startedAt,
    source: 'short-circuit',
  };
}

async function fireStats(
  onResponse: OnResponseCallback | undefined,
  stats: ProxyStats
): Promise<void> {
  if (!onResponse) return;
  try {
    await onResponse(stats);
  } catch (err) {
    console.error('onResponse callback error:', err);
  }
}

export async function runProxyPipeline(
  payload: ProxyRequestPayload,
  hooks: PipelineHooks,
  callbacks: PipelineCallbacks,
  startedAt: number
): Promise<void> {
  const { beforeRequest, onResponse } = hooks;

  try {
    if (beforeRequest) {
      const hookResult = await beforeRequest(payload, payload as never);
      if (isShortCircuitResponse(hookResult)) {
        await callbacks.onShortCircuit(hookResult);
        await fireStats(onResponse, buildShortCircuitStats(payload, hookResult.status, startedAt));
        return;
      }
    }

    const remoteResponse = await axiosProxyRequest(payload);
    await callbacks.onSuccess(remoteResponse);
    await fireStats(
      onResponse,
      buildUpstreamStats(payload, remoteResponse.status, startedAt, remoteResponse.headers as Record<string, string>)
    );
  } catch (error) {
    const processedError = await callbacks.onError(error as ProxyError);
    await fireStats(onResponse, buildErrorStats(payload, processedError, startedAt));
  }
}
