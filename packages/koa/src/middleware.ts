import type { Context, Middleware } from 'koa';
import {
  buildErrorResponseBody,
  filterProxyResponseHeaders,
  generateCurlCommand,
  runProxyPipeline,
} from '@nadimtuhin/simple-proxy-core';
import type { PipelineCallbacks, PipelineHooks } from '@nadimtuhin/simple-proxy-core';
import type { KoaProxyConfig, ProxyError, ProxyRequestPayload } from './types.js';
import {
  buildBasePayload,
  attachKoaBodyToPayload,
  applyShortCircuitToCtx,
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
  if (process.env.NODE_ENV !== 'development') return;
  const body = (ctx.request as unknown as { body?: unknown }).body;
  console.log(
    'Proxy Request:',
    generateCurlCommand(payload, { body: body as Record<string, unknown> })
  );
}

async function runKoaProxy(
  config: KoaProxyConfig,
  errorHandler: NonNullable<KoaProxyConfig['errorHandler']>,
  proxyPath: string | undefined,
  ctx: Context
): Promise<void> {
  const startedAt = Date.now();
  const fireStats = createFireStats(config.onResponse, ctx);
  const payload = buildPayload(config, ctx, proxyPath);
  logDevRequest(payload, ctx);

  const hooks: PipelineHooks = {
    ...(config.beforeRequest ? { beforeRequest: (pl) => config.beforeRequest!(pl, ctx) } : {}),
    onResponse: fireStats,
  };

  const callbacks: PipelineCallbacks = {
    onShortCircuit: async (hookResult) => applyShortCircuitToCtx(hookResult, ctx),
    onSuccess: async (remoteResponse) => {
      ctx.status = remoteResponse.status;
      ctx.body = remoteResponse.data;
    },
    onError: async (error) => {
      try {
        await errorHandler(error as ProxyError, ctx);
      } catch (handlerError) {
        console.error('Custom error handler failed:', handlerError);
        defaultKoaErrorHandler(error as ProxyError, ctx);
      }
      return error;
    },
  };

  await runProxyPipeline(payload, hooks, callbacks, startedAt);
}

export function createKoaProxyMiddleware(config: KoaProxyConfig, proxyPath?: string): Middleware {
  const { errorHandler = defaultKoaErrorHandler } = config;
  return (ctx) => runKoaProxy(config, errorHandler, proxyPath, ctx);
}
