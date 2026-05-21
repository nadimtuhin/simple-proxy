import type { Context } from 'koa';
import {
  urlJoin,
  buildQueryString,
  resolveProxyPath,
  createFormDataPayload,
} from '@nadimtuhin/simple-proxy-core';
import type {
  ProxyRequestPayload,
  ProxyStats,
  ShortCircuitResponse,
  FileUpload,
} from '@nadimtuhin/simple-proxy-core';
import type { KoaProxyConfig, KoaOnResponseCallback } from './types.js';
import { DEFAULT_TIMEOUT } from './types.js';

interface MulFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

type RawFiles = { [field: string]: MulFile[] } | MulFile[] | undefined;

/** Pure: normalize multer file formats to FileUpload[]. */
export function extractKoaFiles(rawFiles: RawFiles): FileUpload[] {
  if (!rawFiles) return [];
  const list = Array.isArray(rawFiles)
    ? rawFiles
    : Object.values(rawFiles).flat();
  return list.map((f) => ({
    fieldname: f.fieldname,
    originalname: f.originalname,
    encoding: f.encoding,
    mimetype: f.mimetype,
    buffer: f.buffer,
    size: f.size,
  }));
}

/** Pure: build the base ProxyRequestPayload (no body) from config + koa ctx. */
export function buildBasePayload(
  config: KoaProxyConfig,
  ctx: Context,
  proxyPath?: string
): ProxyRequestPayload {
  const qs = buildQueryString(ctx.query as Record<string, string | string[] | undefined>);
  const resolvedPath = resolveProxyPath(
    proxyPath,
    ctx.path,
    (ctx.params ?? {}) as Record<string, string>
  );
  return {
    url: urlJoin(config.baseURL, resolvedPath, qs),
    headers: config.headers ? { ...config.headers(ctx) } : {},
    method: ctx.method,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
  };
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Mutates payload to attach body data from koa ctx.
 * Handles both multipart/form-data and JSON bodies.
 */
export function attachKoaBodyToPayload(
  payload: ProxyRequestPayload,
  ctx: Context
): void {
  if (!BODY_METHODS.has(ctx.method)) return;
  const contentType = (ctx.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    attachMultipartBody(payload, ctx);
  } else {
    attachJsonBody(payload, ctx);
  }
}

function attachMultipartBody(payload: ProxyRequestPayload, ctx: Context): void {
  const req = ctx.request as unknown as { body?: Record<string, unknown>; files?: RawFiles };
  const files = extractKoaFiles(req.files);
  const formData = createFormDataPayload({ body: req.body ?? {}, files });
  payload.data = formData;
  Object.assign(payload.headers, formData.getHeaders());
}

function attachJsonBody(payload: ProxyRequestPayload, ctx: Context): void {
  const body = (ctx.request as unknown as { body?: unknown }).body;
  if (body === undefined || body === null) return;
  payload.data = typeof body === 'string' ? body : JSON.stringify(body);
  if (!payload.headers['Content-Type'] && !payload.headers['content-type']) {
    payload.headers['Content-Type'] = 'application/json';
  }
}

/** Applies a short-circuit response to a Koa context. */
export function applyShortCircuitToCtx(
  hookResult: ShortCircuitResponse,
  ctx: Context
): void {
  if (hookResult.headers) {
    Object.entries(hookResult.headers).forEach(([k, v]) => ctx.set(k, v));
  }
  ctx.status = hookResult.status;
  ctx.body = hookResult.data;
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
 * Creates a fire-once stats function bound to a koa context.
 * Calling the returned function multiple times only fires onResponse once.
 */
export function createFireStats(
  onResponse: KoaOnResponseCallback | undefined,
  ctx: Context
): (stats: ProxyStats) => Promise<void> {
  let fired = false;
  return async (stats: ProxyStats): Promise<void> => {
    if (fired || !onResponse) return;
    fired = true;
    try {
      await onResponse(stats, ctx);
    } catch (err) {
      console.error('onResponse callback error:', err);
    }
  };
}
