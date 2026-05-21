import { Response } from 'express';
import {
  axiosProxyRequest,
  buildErrorResponseBody,
  filterProxyResponseHeaders,
  isShortCircuitResponse,
} from '@simple-proxy/core';
import type { ProxyResponse, ShortCircuitResponse } from '@simple-proxy/core';
import {
  buildQueryString,
  resolveProxyPath,
  urlJoin,
  parseSize,
  createFormDataPayload,
  generateCurlCommand,
  asyncWrapper,
} from './utils.js';
import type {
  ProxyConfig,
  ProxyError,
  ProxyStats,
  ProxyRequestPayload,
  RequestWithLocals,
  RequestWithFiles,
  ResponseHandler,
  ProxyController,
  OnResponseCallback,
} from './types.js';
import { DEFAULT_TIMEOUT } from './types.js';

export { axiosProxyRequest };

export function defaultErrorHandler(
  error: ProxyError,
  _req: RequestWithLocals,
  res: Response
): void {
  const status = error.status ?? 500;
  const errorResponse = buildErrorResponseBody(error);

  if (error.headers) {
    const filtered = filterProxyResponseHeaders(error.headers);
    Object.entries(filtered).forEach(([name, value]) => {
      res.set(name, value);
    });
  }

  res.status(status).json(errorResponse);
}

function validateConfig(config: ProxyConfig): void {
  if (!config) throw new Error('config is required for createProxyController');
  if (!config.baseURL) throw new Error('config.baseURL is required');
  if (typeof config.headers !== 'function') throw new Error('config.headers must be a function');
  if (config.errorHandler && typeof config.errorHandler !== 'function') {
    throw new Error('config.errorHandler must be a function');
  }
  if (config.errorHandlerHook && typeof config.errorHandlerHook !== 'function') {
    throw new Error('config.errorHandlerHook must be a function');
  }
}

function attachRequestBody(
  payload: ProxyRequestPayload,
  req: RequestWithLocals,
  reqWithFiles: RequestWithFiles
): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  if (req.is('multipart/form-data')) {
    const bodyFormData = createFormDataPayload(reqWithFiles);
    payload.data = bodyFormData;
    Object.assign(payload.headers, bodyFormData.getHeaders());
  } else {
    payload.data = JSON.stringify(req.body);
    if (!payload.headers['Content-Type']) {
      payload.headers['Content-Type'] = 'application/json';
    }
  }
}

function buildRequestPayload(
  config: ProxyConfig,
  req: RequestWithLocals,
  reqWithFiles: RequestWithFiles,
  proxyPath: string | undefined
): ProxyRequestPayload {
  const qs = buildQueryString(req.query);
  const modifiedProxyPath = resolveProxyPath(proxyPath, req.path, req.params);
  const payload: ProxyRequestPayload = {
    url: urlJoin(config.baseURL, modifiedProxyPath, qs),
    headers: { ...config.headers(req) },
    method: req.method,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
  };
  attachRequestBody(payload, req, reqWithFiles);
  return payload;
}

async function dispatchUpstreamResponse(
  handler: ResponseHandler | boolean | undefined,
  req: RequestWithLocals,
  res: Response,
  remoteResponse: ProxyResponse,
  config: ProxyConfig
): Promise<void> {
  if (!handler) {
    res.status(remoteResponse.status);
    if (config.responseHeaders) {
      res.set(config.responseHeaders(remoteResponse));
    }
    res.json(remoteResponse.data);
  } else if (typeof handler === 'function') {
    await handler(req, res, remoteResponse);
  } else {
    res.json(remoteResponse.data);
  }
}

async function runErrorHook(
  error: ProxyError,
  req: RequestWithLocals,
  res: Response,
  errorHandlerHook: ProxyConfig['errorHandlerHook']
): Promise<ProxyError> {
  if (!errorHandlerHook) return error;
  try {
    const hookResult = await errorHandlerHook(error, req, res);
    if (hookResult && (hookResult instanceof Error || 'message' in hookResult)) {
      return hookResult;
    }
  } catch (hookError) {
    // eslint-disable-next-line no-console
    console.error('Error handler hook failed:', hookError);
  }
  return error;
}

async function applyErrorHook(
  error: ProxyError,
  req: RequestWithLocals,
  res: Response,
  errorHandlerHook: ProxyConfig['errorHandlerHook'],
  errorHandler: NonNullable<ProxyConfig['errorHandler']>
): Promise<ProxyError> {
  const processedError = await runErrorHook(error, req, res, errorHandlerHook);
  try {
    await errorHandler(processedError, req, res);
  } catch (handlerError) {
    // eslint-disable-next-line no-console
    console.error('Custom error handler failed:', handlerError);
    defaultErrorHandler(processedError, req, res);
  }
  return processedError;
}

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

export function buildUpstreamStats(
  payload: ProxyRequestPayload,
  remoteResponse: ProxyResponse,
  startedAt: number
): ProxyStats {
  const size = parseSize(remoteResponse.headers['content-length']);
  const stats: ProxyStats = {
    url: payload.url,
    method: payload.method,
    status: remoteResponse.status,
    durationMs: Date.now() - startedAt,
    source: 'upstream',
  };
  if (size !== undefined) {
    stats.responseSizeBytes = size;
  }
  return stats;
}

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

export function sendShortCircuit(res: Response, hookResult: ShortCircuitResponse): void {
  if (hookResult.headers) res.set(hookResult.headers);
  res.status(hookResult.status).json(hookResult.data);
}

export async function reportStats(
  onResponse: OnResponseCallback | undefined,
  stats: ProxyStats,
  req: RequestWithFiles,
  res: Response
): Promise<void> {
  if (!onResponse) return;
  try {
    await onResponse(stats, req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('onResponse callback error:', err);
  }
}

interface ProxyRequestContext {
  config: ProxyConfig;
  errorHandler: NonNullable<ProxyConfig['errorHandler']>;
  errorHandlerHook: ProxyConfig['errorHandlerHook'];
  beforeRequest: ProxyConfig['beforeRequest'];
  onResponse: ProxyConfig['onResponse'];
  handler: ResponseHandler | boolean | undefined;
  proxyPath: string | undefined;
}

async function tryUpstreamRequest(
  ctx: ProxyRequestContext,
  payload: ProxyRequestPayload,
  req: RequestWithLocals,
  reqWithFiles: RequestWithFiles,
  res: Response,
  startedAt: number
): Promise<void> {
  if (ctx.beforeRequest) {
    const hookResult = await ctx.beforeRequest(payload, reqWithFiles);
    if (isShortCircuitResponse(hookResult)) {
      sendShortCircuit(res, hookResult);
      await reportStats(ctx.onResponse, buildShortCircuitStats(payload, hookResult.status, startedAt), reqWithFiles, res);
      return;
    }
  }
  const remoteResponse = await axiosProxyRequest(payload);
  await dispatchUpstreamResponse(ctx.handler, req, res, remoteResponse, ctx.config);
  await reportStats(ctx.onResponse, buildUpstreamStats(payload, remoteResponse, startedAt), reqWithFiles, res);
}

async function executeProxyRequest(
  ctx: ProxyRequestContext,
  req: RequestWithLocals,
  res: Response
): Promise<void> {
  const startedAt = Date.now();
  const reqWithFiles = req as RequestWithFiles;
  const payload = buildRequestPayload(ctx.config, req, reqWithFiles, ctx.proxyPath);
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.log('🔄 Proxy Request:', generateCurlCommand(payload, reqWithFiles));
  }
  try {
    await tryUpstreamRequest(ctx, payload, req, reqWithFiles, res, startedAt);
  } catch (error) {
    const processedError = await applyErrorHook(error as ProxyError, req, res, ctx.errorHandlerHook, ctx.errorHandler);
    await reportStats(ctx.onResponse, buildErrorStats(payload, processedError, startedAt), reqWithFiles, res);
  }
}

export function createProxyController(config: ProxyConfig): ProxyController {
  validateConfig(config);
  const ctx: Omit<ProxyRequestContext, 'handler' | 'proxyPath'> = {
    config,
    errorHandler: config.errorHandler ?? defaultErrorHandler,
    errorHandlerHook: config.errorHandlerHook,
    beforeRequest: config.beforeRequest,
    onResponse: config.onResponse,
  };
  return function proxyController(proxyPath?: string, handler?: ResponseHandler | boolean) {
    return asyncWrapper((req: RequestWithLocals, res: Response) =>
      executeProxyRequest({ ...ctx, handler, proxyPath }, req, res)
    );
  };
}
