import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  urlJoin,
  buildQueryString,
  resolveProxyPath,
} from '@nadimtuhin/simple-proxy-core';
import type {
  ProxyRequestPayload,
  ProxyStats,
  ShortCircuitResponse,
} from '@nadimtuhin/simple-proxy-core';
import type { FastifyProxyConfig, FastifyOnResponseCallback } from './types.js';
import { DEFAULT_TIMEOUT } from './types.js';

/** Pure: extract path without query string from a URL string. */
export function getRequestPath(url: string): string {
  const qIdx = url.indexOf('?');
  return qIdx === -1 ? url : url.slice(0, qIdx);
}

/** Pure: build the base ProxyRequestPayload (no body) from config + request. */
export function buildBasePayload(
  config: FastifyProxyConfig,
  request: FastifyRequest,
  proxyPath?: string
): ProxyRequestPayload {
  const path = getRequestPath(request.url);
  const qs = buildQueryString(request.query as Record<string, string | string[] | undefined>);
  const resolvedPath = resolveProxyPath(proxyPath, path, request.params as Record<string, string>);
  return {
    url: urlJoin(config.baseURL, resolvedPath, qs),
    headers: config.headers ? { ...config.headers(request) } : {},
    method: request.method,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
  };
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Mutates payload to attach a JSON/string body.
 * No-op for non-body methods or null/undefined bodies.
 */
export function attachJsonToPayload(
  payload: ProxyRequestPayload,
  request: FastifyRequest
): void {
  if (!BODY_METHODS.has(request.method)) return;
  const body = request.body;
  if (body === undefined || body === null) return;
  payload.data = typeof body === 'string' ? body : JSON.stringify(body);
  if (!payload.headers['Content-Type'] && !payload.headers['content-type']) {
    payload.headers['Content-Type'] = 'application/json';
  }
}

/** Applies a short-circuit response to a Fastify reply (headers + status + body). */
export function applyShortCircuitToReply(
  hookResult: ShortCircuitResponse,
  reply: FastifyReply
): void {
  if (hookResult.headers) {
    Object.entries(hookResult.headers).forEach(([k, v]) => reply.header(k, v));
  }
  reply.status(hookResult.status).send(hookResult.data);
}

/** Pure: build ProxyStats for a short-circuit response. */
export function buildShortCircuitStats(
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

/**
 * Creates a fire-once stats function bound to a specific request/reply.
 * Calling the returned function multiple times only fires onResponse once.
 */
export function createFireStats(
  onResponse: FastifyOnResponseCallback | undefined,
  request: FastifyRequest,
  reply: FastifyReply
): (stats: ProxyStats) => Promise<void> {
  let fired = false;
  return async (stats: ProxyStats): Promise<void> => {
    if (fired || !onResponse) return;
    fired = true;
    try {
      await onResponse(stats, request, reply);
    } catch (err) {
      console.error('onResponse callback error:', err);
    }
  };
}
