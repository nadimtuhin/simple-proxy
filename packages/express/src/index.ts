export { createProxyController, axiosProxyRequest, defaultErrorHandler } from './proxy.js';

export {
  urlJoin,
  replaceUrlTemplate,
  buildQueryString,
  createFormDataPayload,
  generateCurlCommand,
  asyncWrapper,
  parseSize,
  resolveProxyPath,
} from './utils.js';

export {
  classifyResponseError,
  classifyNetworkError,
  isShortCircuitResponse,
  buildErrorResponseBody,
  filterProxyResponseHeaders,
} from '@nadimtuhin/simple-proxy-core';

export type {
  ProxyConfig,
  ProxyError,
  ProxyErrorCode,
  ProxyResponse,
  ProxyRequestPayload,
  ProxyStats,
  ShortCircuitResponse,
  BeforeRequestHook,
  OnResponseCallback,
  CurlCommandOptions,
  RequestWithLocals,
  RequestWithFiles,
  ErrorHandler,
  ErrorHandlerHook,
  ResponseHandler,
  ProxyController,
  UrlVariables,
  QueryParams,
  FileUpload,
} from './types.js';

export { DEFAULT_TIMEOUT, MAX_REQUEST_SIZE, DEFAULT_RETRY_COUNT } from './types.js';

export { createProxyController as default } from './proxy.js';
