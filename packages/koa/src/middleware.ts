import type { Context, Middleware } from 'koa';
import {
  axiosProxyRequest,
  buildErrorResponseBody,
  filterProxyResponseHeaders,
  isShortCircuitResponse,
  urlJoin,
  buildQueryString,
  resolveProxyPath,
  parseSize,
  generateCurlCommand,
  createFormDataPayload,
} from '@simple-proxy/core';
import type { FileUpload } from '@simple-proxy/core';
import type { KoaProxyConfig, ProxyError, ProxyStats, ProxyRequestPayload } from './types.js';
import { DEFAULT_TIMEOUT } from './types.js';

interface MulFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export function defaultKoaErrorHandler(error: ProxyError, ctx: Context): void {
  const status = error.status ?? 500;
  const errorResponse = buildErrorResponseBody(error);

  if (error.headers) {
    const filtered = filterProxyResponseHeaders(error.headers);
    Object.entries(filtered).forEach(([name, value]) => {
      ctx.set(name, value);
    });
  }

  ctx.status = status;
  ctx.body = errorResponse;
}

function buildRequestPayload(
  config: KoaProxyConfig,
  ctx: Context,
  proxyPath?: string
): ProxyRequestPayload {
  const qs = buildQueryString(
    ctx.query as Record<string, string | string[] | undefined>
  );
  const resolvedPath = resolveProxyPath(
    proxyPath,
    ctx.path,
    (ctx.params ?? {}) as Record<string, string>
  );

  const payload: ProxyRequestPayload = {
    url: urlJoin(config.baseURL, resolvedPath, qs),
    headers: config.headers ? { ...config.headers(ctx) } : {},
    method: ctx.method,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)) {
    const contentType = (ctx.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('multipart/form-data')) {
      // Caller must mount @koa/multer (or equivalent) before this middleware.
      // Multer stores files in ctx.request.files (array) or ctx.files (object).
      const req = ctx.request as unknown as {
        body?: Record<string, unknown>;
        files?: { [field: string]: MulFile[] } | MulFile[];
      };
      const rawFiles = req.files;
      const files: FileUpload[] = rawFiles
        ? (Array.isArray(rawFiles)
            ? rawFiles
            : Object.values(rawFiles).flat()
          ).map((f) => ({
            fieldname: f.fieldname,
            originalname: f.originalname,
            encoding: f.encoding,
            mimetype: f.mimetype,
            buffer: f.buffer,
            size: f.size,
          }))
        : [];
      const bodyFormData = createFormDataPayload({ body: req.body ?? {}, files });
      payload.data = bodyFormData;
      Object.assign(payload.headers, bodyFormData.getHeaders());
    } else {
      const body = (ctx.request as unknown as { body?: unknown }).body;
      if (body !== undefined && body !== null) {
        // koa-bodyparser auto-parses JSON — re-serialize before forwarding
        payload.data = typeof body === 'string' ? body : JSON.stringify(body);
        if (!payload.headers['Content-Type'] && !payload.headers['content-type']) {
          payload.headers['Content-Type'] = 'application/json';
        }
      }
    }
  }

  return payload;
}

export function createKoaProxyMiddleware(
  config: KoaProxyConfig,
  proxyPath?: string
): Middleware {
  const { errorHandler = defaultKoaErrorHandler, beforeRequest, onResponse } = config;

  return async function koaProxyMiddleware(ctx: Context): Promise<void> {
    const startedAt = Date.now();
    let statsFired = false;

    const fireStats = async (stats: ProxyStats): Promise<void> => {
      if (statsFired || !onResponse) return;
      statsFired = true;
      try {
        await onResponse(stats, ctx);
      } catch (err) {
        console.error('onResponse callback error:', err);
      }
    };

    const payload = buildRequestPayload(config, ctx, proxyPath);

    try {
      if (process.env.NODE_ENV === 'development') {
        const body = (ctx.request as unknown as { body?: unknown }).body;
        console.log(
          '🔄 Proxy Request:',
          generateCurlCommand(payload, { body: body as Record<string, unknown> })
        );
      }

      if (beforeRequest) {
        const hookResult = await beforeRequest(payload, ctx);
        if (isShortCircuitResponse(hookResult)) {
          if (hookResult.headers) {
            Object.entries(hookResult.headers).forEach(([k, v]) => ctx.set(k, v));
          }
          ctx.status = hookResult.status;
          ctx.body = hookResult.data;
          await fireStats({
            url: payload.url,
            method: payload.method,
            status: hookResult.status,
            durationMs: Date.now() - startedAt,
            source: 'short-circuit',
          });
          return;
        }
      }

      const remoteResponse = await axiosProxyRequest(payload);

      ctx.status = remoteResponse.status;
      ctx.body = remoteResponse.data;

      const size = parseSize(remoteResponse.headers['content-length']);
      const upstreamStats: ProxyStats = {
        url: payload.url,
        method: payload.method,
        status: remoteResponse.status,
        durationMs: Date.now() - startedAt,
        source: 'upstream',
      };
      if (size !== undefined) {
        upstreamStats.responseSizeBytes = size;
      }
      await fireStats(upstreamStats);
    } catch (error) {
      const proxyError = error as ProxyError;
      await fireStats({
        url: payload.url,
        method: payload.method,
        status: proxyError.status ?? 500,
        durationMs: Date.now() - startedAt,
        source: 'upstream',
      });
      try {
        await errorHandler(proxyError, ctx);
      } catch (handlerError) {
        console.error('Custom error handler failed:', handlerError);
        defaultKoaErrorHandler(proxyError, ctx);
      }
    }
  };
}
