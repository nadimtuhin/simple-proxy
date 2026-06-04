import type { Context } from 'koa';
import {
  ProxyErrorCode,
  ShortCircuitResponse,
  ProxyStats,
  ProxyError,
  ProxyResponse,
  ProxyRequestPayload,
  CurlCommandOptions,
  UrlVariables,
  QueryParams,
  FileUpload,
  DEFAULT_TIMEOUT,
  MAX_REQUEST_SIZE,
} from '@nadimtuhin/simple-proxy-core';

export type {
  ProxyErrorCode,
  ShortCircuitResponse,
  ProxyStats,
  ProxyError,
  ProxyResponse,
  ProxyRequestPayload,
  CurlCommandOptions,
  UrlVariables,
  QueryParams,
  FileUpload,
};
export { DEFAULT_TIMEOUT, MAX_REQUEST_SIZE };

/** Koa-flavoured hook — receives the native Koa Context */
export type KoaBeforeRequestHook = (
  payload: ProxyRequestPayload,
  ctx: Context
) => void | ShortCircuitResponse | Promise<void | ShortCircuitResponse>;

/** Koa-flavoured stats callback — receives Koa Context */
export type KoaOnResponseCallback = (stats: ProxyStats, ctx: Context) => void | Promise<void>;

/** Koa error handler — receives Koa Context */
export type KoaErrorHandler = (error: ProxyError, ctx: Context) => void | Promise<void>;

export interface KoaProxyConfig {
  baseURL: string;
  headers?: (ctx: Context) => Record<string, string>;
  timeout?: number;
  beforeRequest?: KoaBeforeRequestHook;
  onResponse?: KoaOnResponseCallback;
  errorHandler?: KoaErrorHandler;
}
