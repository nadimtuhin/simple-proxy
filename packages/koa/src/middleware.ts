import type { Context, Middleware } from 'koa';
import {
  axiosProxyRequest,
  buildErrorResponseBody,
  filterProxyResponseHeaders,
  isShortCircuitResponse,
  generateCurlCommand,
  buildUpstreamStats,
  buildErrorStats,
} from '@simple-proxy/core';
import type { KoaProxyConfig, ProxyError, ProxyRequestPayload } from './types.js';
import type { ProxyStats } from '@simple-proxy/core';
import {
  buildBasePayload,
  attachKoaBodyToPayload,
  applyShortCircuitToCtx,
  buildShortCircuitStats,
  createFireStats,
} from './helpers.js';

export function defaultKoaErrorHandler(error: ProxyError, ctx: Context): void {
  const status = error.status ?? 500;
  const errorResponse = buildErrorResponseBody(error);
  if (error.headers) {
    const filtered = filterProxyResponseHeaders(error.headers);
    Object.entries(filtered).forEach(([name, value]) => ctx.set(name, value));
  }
  ctx.status = status;
  ctx.body = errorResponse;
}

function buildPayload(
  config: KoaProxyConfig,
  ctx: Context,
  proxyPath?: string
): ProxyRequestPayload {
  const payload = buildBasePayload(config, ctx, proxyPath);
  attachKoaBodyToPayload(payload, ctx);
  return payload;
}

function logDevRequest(payload: ProxyRequestPayload, ctx: Context): void {
  if (process.env.NODE_ENV !== "development") return;
  const body = (ctx.request as unknown as { body?: unknown }).body;
  console.log(
    "Proxy Request:",
    generateCurlCommand(payload, { body: body as Record<string, unknown> })
  );
}

async function handleBeforeRequest(
  config: KoaProxyConfig,
  payload: ProxyRequestPayload,
  ctx: Context,
  startedAt: number,
  fireStats: (stats: ProxyStats) => Promise<void>
): Promise<boolean> {
  if (!config.beforeRequest) return false;
  const hookResult = await config.beforeRequest(payload, ctx);
  if (!isShortCircuitResponse(hookResult)) return false;
  applyShortCircuitToCtx(hookResult, ctx);
  await fireStats(buildShortCircuitStats(payload, hookResult.status, startedAt));
  return true;
}

async function handleUpstreamRequest(
  payload: ProxyRequestPayload,
  ctx: Context,
  startedAt: number,
  fireStats: (stats: ProxyStats) => Promise<void>
): Promise<void> {
  const remoteResponse = await axiosProxyRequest(payload);
  ctx.status = remoteResponse.status;
  ctx.body = remoteResponse.data;
  await fireStats(buildUpstreamStats(payload, remoteResponse.status, startedAt, remoteResponse.headers));
}

async function handleProxyError(
  error: ProxyError,
  payload: ProxyRequestPayload,
  ctx: Context,
  startedAt: number,
  errorHandler: NonNullable<KoaProxyConfig["errorHandler"]>,
  fireStats: (stats: ProxyStats) => Promise<void>
): Promise<void> {
  await fireStats(buildErrorStats(payload, error, startedAt));
  try {
    await errorHandler(error, ctx);
  } catch (handlerError) {
    console.error("Custom error handler failed:", handlerError);
    defaultKoaErrorHandler(error, ctx);
  }
}

async function runKoaProxy(
  config: KoaProxyConfig,
  errorHandler: NonNullable<KoaProxyConfig["errorHandler"]>,
  proxyPath: string | undefined,
  ctx: Context
): Promise<void> {
  const startedAt = Date.now();
  const fireStats = createFireStats(config.onResponse, ctx);
  const payload = buildPayload(config, ctx, proxyPath);
  try {
    logDevRequest(payload, ctx);
    const shortCircuited = await handleBeforeRequest(
      config, payload, ctx, startedAt, fireStats
    );
    if (shortCircuited) return;
    await handleUpstreamRequest(payload, ctx, startedAt, fireStats);
  } catch (error) {
    await handleProxyError(
      error as ProxyError, payload, ctx, startedAt, errorHandler, fireStats
    );
  }
}

export function createKoaProxyMiddleware(
  config: KoaProxyConfig,
  proxyPath?: string
): Middleware {
  const { errorHandler = defaultKoaErrorHandler } = config;
  return (ctx) => runKoaProxy(config, errorHandler, proxyPath, ctx);
}
