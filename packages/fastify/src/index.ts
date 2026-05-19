export { createFastifyProxyHandler, defaultFastifyErrorHandler } from './plugin.js';
export { createFastifyProxyHandler as default } from './plugin.js';

export {
  urlJoin,
  replaceUrlTemplate,
  buildQueryString,
  parseSize,
  resolveProxyPath,
  generateCurlCommand,
  createFormDataPayload,
} from '@simple-proxy/core';

export {
  classifyResponseError,
  classifyNetworkError,
  isShortCircuitResponse,
  buildErrorResponseBody,
  filterProxyResponseHeaders,
  axiosProxyRequest,
} from '@simple-proxy/core';

export { DEFAULT_TIMEOUT, MAX_REQUEST_SIZE } from './types.js';

export type {
  FastifyProxyConfig,
  FastifyBeforeRequestHook,
  FastifyOnResponseCallback,
  FastifyErrorHandler,
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
