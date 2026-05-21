import type { ProxyStats, ProxyRequestPayload, ProxyError } from './types.js';
import { parseSize } from './utils.js';

/** Pure: build ProxyStats for a successful upstream response. */
export function buildUpstreamStats(
  payload: ProxyRequestPayload,
  status: number,
  startedAt: number,
  responseHeaders: Record<string, string>
): ProxyStats {
  const stats: ProxyStats = {
    url: payload.url,
    method: payload.method,
    status,
    durationMs: Date.now() - startedAt,
    source: 'upstream',
  };
  const size = parseSize(responseHeaders['content-length']);
  if (size !== undefined) {
    stats.responseSizeBytes = size;
  }
  return stats;
}

/** Pure: build ProxyStats for an error (upstream failure). */
export function buildErrorStats(
  payload: ProxyRequestPayload,
  error: ProxyError,
  startedAt: number
): ProxyStats {
  return {
    url: payload.url,
    method: payload.method,
    status: error.status ?? 500,
    durationMs: Date.now() - startedAt,
    source: 'upstream',
  };
}
