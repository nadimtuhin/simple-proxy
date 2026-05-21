import type { FastifyRequest, FastifyReply } from 'fastify';
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

/** Fastify-flavoured hook — receives the native FastifyRequest */
export type FastifyBeforeRequestHook = (
  payload: ProxyRequestPayload,
  req: FastifyRequest
) => void | ShortCircuitResponse | Promise<void | ShortCircuitResponse>;

/** Fastify-flavoured stats callback — receives req and reply */
export type FastifyOnResponseCallback = (
  stats: ProxyStats,
  req: FastifyRequest,
  reply: FastifyReply
) => void | Promise<void>;

/** Fastify error handler — receives req and reply */
export type FastifyErrorHandler = (
  error: ProxyError,
  req: FastifyRequest,
  reply: FastifyReply
) => void | Promise<void>;

export interface FastifyProxyConfig {
  baseURL: string;
  headers?: (req: FastifyRequest) => Record<string, string>;
  timeout?: number;
  beforeRequest?: FastifyBeforeRequestHook;
  onResponse?: FastifyOnResponseCallback;
  errorHandler?: FastifyErrorHandler;
}
