import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  buildErrorResponseBody,
  filterProxyResponseHeaders,
  generateCurlCommand,
  createFormDataPayload,
  runProxyPipeline,
} from '@nadimtuhin/simple-proxy-core';
import type { FileUpload, PipelineCallbacks, PipelineHooks } from '@nadimtuhin/simple-proxy-core';
import type { FastifyProxyConfig, ProxyError, ProxyRequestPayload } from './types.js';
import {
  buildBasePayload,
  attachJsonToPayload,
  applyShortCircuitToReply,
  createFireStats,
} from './helpers.js';

type MultipartPart = {
  type: string;
  toBuffer?: () => Promise<Buffer>;
  fieldname: string;
  filename?: string;
  encoding: string;
  mimetype?: string;
  value?: string;
};

type MultipartFilePart = MultipartPart & { toBuffer: () => Promise<Buffer> };

type MultipartRequest = FastifyRequest & {
  parts?: () => AsyncIterableIterator<MultipartPart>;
};

async function partToFileUpload(part: MultipartFilePart): Promise<FileUpload> {
  const buffer = await part.toBuffer();
  return {
    fieldname: part.fieldname,
    originalname: part.filename ?? part.fieldname,
    encoding: part.encoding,
    mimetype: part.mimetype ?? 'application/octet-stream',
    buffer,
    size: buffer.length,
  };
}

async function attachMultipartBody(
  request: MultipartRequest,
  payload: ProxyRequestPayload
): Promise<void> {
  if (typeof request.parts !== 'function') return;
  const files: FileUpload[] = [];
  const body: Record<string, unknown> = {};
  for await (const part of request.parts()) {
    if (part.type === 'file' && part.toBuffer) {
      files.push(await partToFileUpload(part as MultipartFilePart));
    } else if (part.type === 'field') {
      body[part.fieldname] = part.value;
    }
  }
  const formData = createFormDataPayload({ body, files });
  payload.data = formData;
  Object.assign(payload.headers, formData.getHeaders());
}

export function defaultFastifyErrorHandler(
  error: ProxyError,
  _req: FastifyRequest,
  reply: FastifyReply
): void {
  const status = error.status ?? 500;
  const errorResponse = buildErrorResponseBody(error);
  if (error.headers) {
    const filtered = filterProxyResponseHeaders(error.headers);
    Object.entries(filtered).forEach(([name, value]) => reply.header(name, value));
  }
  reply.status(status).send(errorResponse);
}

async function buildRequestPayload(
  config: FastifyProxyConfig,
  request: FastifyRequest,
  proxyPath?: string
): Promise<ProxyRequestPayload> {
  const payload = buildBasePayload(config, request, proxyPath);
  const contentType = (request.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    await attachMultipartBody(request as MultipartRequest, payload);
  } else {
    attachJsonToPayload(payload, request);
  }
  return payload;
}

function logDevRequest(payload: ProxyRequestPayload, body: unknown): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.log(
    'Proxy Request:',
    generateCurlCommand(payload, { body: body as Record<string, unknown> })
  );
}

async function runFastifyProxy(
  config: FastifyProxyConfig,
  errorHandler: NonNullable<FastifyProxyConfig['errorHandler']>,
  proxyPath: string | undefined,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const startedAt = Date.now();
  const fireStats = createFireStats(config.onResponse, request, reply);
  const payload = await buildRequestPayload(config, request, proxyPath);
  logDevRequest(payload, request.body);

  const hooks: PipelineHooks = {
    ...(config.beforeRequest ? { beforeRequest: (pl) => config.beforeRequest!(pl, request) } : {}),
    ...(fireStats ? { onResponse: fireStats } : {}),
  };

  const callbacks: PipelineCallbacks = {
    onShortCircuit: async (hookResult) => applyShortCircuitToReply(hookResult, reply),
    onSuccess: async (remoteResponse) => {
      if (!reply.sent) reply.status(remoteResponse.status).send(remoteResponse.data);
    },
    onError: async (error) => {
      if (!reply.sent) {
        try {
          await errorHandler(error as ProxyError, request, reply);
        } catch (handlerError) {
          console.error('Custom error handler failed:', handlerError);
          if (!reply.sent) defaultFastifyErrorHandler(error as ProxyError, request, reply);
        }
      }
      return error;
    },
  };

  await runProxyPipeline(payload, hooks, callbacks, startedAt);
}

export function createFastifyProxyHandler(
  config: FastifyProxyConfig,
  proxyPath?: string
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { errorHandler = defaultFastifyErrorHandler } = config;
  return (request, reply) => runFastifyProxy(config, errorHandler, proxyPath, request, reply);
}
