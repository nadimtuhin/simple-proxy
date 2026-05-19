import { Readable } from 'stream';
import { AxiosResponse } from 'axios';

export type ProxyErrorCode =
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_UNREACHABLE'
  | 'NETWORK_ERROR'
  | 'UPSTREAM_AUTH'
  | 'REQUEST_ERROR'
  | 'UNKNOWN_ERROR';

export interface ShortCircuitResponse {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
  statusText?: string;
}

export interface ProxyStats {
  url: string;
  method: string;
  status: number;
  durationMs: number;
  responseSizeBytes?: number;
  source: 'upstream' | 'short-circuit';
}

export interface ProxyError extends Error {
  status?: number;
  code?: string;
  data?: unknown;
  headers?: Record<string, string>;
}

export interface ProxyResponse extends AxiosResponse {
  data: unknown;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface ProxyRequestPayload {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: unknown;
  timeout: number;
}

export interface CurlCommandOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: unknown;
}

export interface UrlVariables {
  [key: string]: string | number;
}

export interface QueryParams {
  [key: string]: string | string[] | number | boolean | undefined;
}

export interface FileUpload {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
  stream?: Readable | undefined;
  destination?: string;
  filename?: string;
  path?: string;
}

/** Generic normalised request shape — adapters convert their native request to this. */
export interface ProxyRequestInput {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: QueryParams;
  body: unknown;
  isMultipart: boolean;
  files?: FileUpload[];
}

/** Generic response interface — adapters implement this wrapping their native response. */
export interface ProxyResponder {
  status(code: number): void;
  setHeader(name: string, value: string): void;
  send(body: unknown): void;
}

export type BeforeRequestHook = (
  payload: ProxyRequestPayload,
  input: ProxyRequestInput
) => void | ShortCircuitResponse | Promise<void | ShortCircuitResponse>;

export type OnResponseCallback = (stats: ProxyStats) => void | Promise<void>;

export const DEFAULT_TIMEOUT = 30000;
export const MAX_REQUEST_SIZE = 100 * 1024 * 1024; // 100MB
