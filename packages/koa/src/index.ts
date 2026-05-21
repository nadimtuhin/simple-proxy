export { createKoaProxyMiddleware, defaultKoaErrorHandler } from './middleware.js';
export { createKoaProxyMiddleware as default } from './middleware.js';

export {
  urlJoin,
  replaceUrlTemplate,
  buildQueryString,
  parseSize,
  resolveProxyPath,
  generateCurlCommand,
  createFormDataPayload,
  classifyResponseError,
  classifyNetworkError,
  isShortCircuitResponse,
  buildErrorResponseBody,
  filterProxyResponseHeaders,
  axiosProxyRequest,
} from '@nadimtuhin/simple-proxy-core';

export { DEFAULT_TIMEOUT, MAX_REQUEST_SIZE } from './types.js';

export type {
  KoaProxyConfig,
  KoaBeforeRequestHook,
  KoaOnResponseCallback,
  KoaErrorHandler,
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
} from './types.js';
