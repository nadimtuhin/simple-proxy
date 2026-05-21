import { Request, Response, NextFunction } from 'express';
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

export const DEFAULT_RETRY_COUNT = 2;

export interface RequestWithLocals extends Request {
  locals?: {
    token?: string;
    [key: string]: unknown;
  };
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
  method: string;
  path: string;
  is: (type: string) => string | false | null;
}

export interface RequestWithFiles extends Omit<RequestWithLocals, 'file' | 'files'> {
  files?: FileUpload[] | { [fieldname: string]: FileUpload[] };
  file?: FileUpload;
}

export type ErrorHandler = (
  error: ProxyError,
  req: RequestWithLocals,
  res: Response
) => void | Promise<void>;

export type ErrorHandlerHook = (
  error: ProxyError,
  req: RequestWithLocals,
  res: Response
) => ProxyError | Promise<ProxyError>;

export type ResponseHandler = (
  req: RequestWithLocals,
  res: Response,
  remoteResponse: ProxyResponse
) => void | Promise<void>;

export type ProxyController = (
  proxyPath?: string,
  handler?: ResponseHandler | boolean
) => (req: RequestWithFiles, res: Response, next: NextFunction) => Promise<void>;

/** Express-flavoured hook — receives the native Express request */
export type BeforeRequestHook = (
  payload: ProxyRequestPayload,
  req: RequestWithFiles
) => void | ShortCircuitResponse | Promise<void | ShortCircuitResponse>;

/** Express-flavoured stats callback — receives req and res */
export type OnResponseCallback = (
  stats: ProxyStats,
  req: RequestWithFiles,
  res: Response
) => void | Promise<void>;

export interface ProxyConfig {
  baseURL: string;
  headers: (req: Request) => Record<string, string>;
  timeout?: number;
  responseHeaders?: (response: ProxyResponse) => Record<string, string>;
  errorHandler?: ErrorHandler;
  errorHandlerHook?: ErrorHandlerHook;
  beforeRequest?: BeforeRequestHook;
  onResponse?: OnResponseCallback;
}
