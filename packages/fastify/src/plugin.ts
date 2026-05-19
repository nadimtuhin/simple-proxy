import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  axiosProxyRequest,
  buildErrorResponseBody,
  filterProxyResponseHeaders,
  isShortCircuitResponse,
  urlJoin,
  buildQueryString,
  resolveProxyPath,
  parseSize,
  generateCurlCommand,
  createFormDataPayload,
} from '@simple-proxy/core';
import type { FileUpload } from '@simple-proxy/core';
import type { FastifyProxyConfig, ProxyError, ProxyStats, ProxyRequestPayload } from './types.js';
import { DEFAULT_TIMEOUT } from './types.js';

type MultipartRequest = FastifyRequest & {
  parts?: () => AsyncIterableIterator<{ type: string; toBuffer?: () => Promise<Buffer>; fieldname: string; filename?: string; encoding: string; mimetype?: string; value?: string }>;
};

async function attachMultipartBody(
  request: MultipartRequest,
  payload: ProxyRequestPayload
): Promise<void> {
  if (typeof request.parts !== 'function') return;
  const files: FileUpload[] = [];
  const body: Record<string, unknown> = {};
  for await (const part of request.parts()) {
    if (part.type === 'file' && part.toBuffer) {
      const buffer = await part.toBuffer();
      files.push({
        fieldname: part.fieldname,
        originalname: part.filename ?? part.fieldname,
        encoding: part.encoding,
        mimetype: part.mimetype ?? 'application/octet-stream',
        buffer,
        size: buffer.length,
      });
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
    Object.entries(filtered).forEach(([name, value]) => {
      reply.header(name, value);
    });
  }

  reply.status(status).send(errorResponse);
}

function getRequestPath(request: FastifyRequest): string {
  const url = request.url;
  const qIdx = url.indexOf('?');
  return qIdx === -1 ? url : url.slice(0, qIdx);
}

function buildRequestPayload(
  config: FastifyProxyConfig,
  request: FastifyRequest,
  proxyPath?: string
): ProxyRequestPayload {
  const path = getRequestPath(request);
  const qs = buildQueryString(
    request.query as Record<string, string | string[] | undefined>
  );
  const resolvedPath = resolveProxyPath(
    proxyPath,
    path,
    request.params as Record<string, string>
  );

  const payload: ProxyRequestPayload = {
    url: urlJoin(config.baseURL, resolvedPath, qs),
    headers: config.headers ? { ...config.headers(request) } : {},
    method: request.method,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const contentType = (request.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
      if (request.body !== undefined && request.body !== null) {
        // Fastify auto-parses JSON — re-serialize before forwarding
        payload.data =
          typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        if (!payload.headers['Content-Type'] && !payload.headers['content-type']) {
          payload.headers['Content-Type'] = 'application/json';
        }
      }
    }
    // multipart: handled asynchronously in the main handler via attachMultipartBody
  }

  return payload;
}

export function createFastifyProxyHandler(
  config: FastifyProxyConfig,
  proxyPath?: string
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { errorHandler = defaultFastifyErrorHandler, beforeRequest, onResponse } = config;

  return async function fastifyProxyHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const startedAt = Date.now();
    let statsFired = false;

    const fireStats = async (stats: ProxyStats): Promise<void> => {
      if (statsFired || !onResponse) return;
      statsFired = true;
      try {
        await onResponse(stats, request, reply);
      } catch (err) {
        console.error('onResponse callback error:', err);
      }
    };

    const payload = buildRequestPayload(config, request, proxyPath);

    // If @fastify/multipart is registered, consume parts and attach FormData
    const contentType = (request.headers['content-type'] ?? '').toLowerCase();
    if (contentType.includes('multipart/form-data')) {
      await attachMultipartBody(request as MultipartRequest, payload);
    }

    try {
      if (process.env.NODE_ENV === 'development') {
        console.log(
          '🔄 Proxy Request:',
          generateCurlCommand(payload, { body: request.body as Record<string, unknown> })
        );
      }

      if (beforeRequest) {
        const hookResult = await beforeRequest(payload, request);
        if (isShortCircuitResponse(hookResult)) {
          if (hookResult.headers) {
            Object.entries(hookResult.headers).forEach(([k, v]) => reply.header(k, v));
          }
          reply.status(hookResult.status).send(hookResult.data);
          await fireStats({
            url: payload.url,
            method: payload.method,
            status: hookResult.status,
            durationMs: Date.now() - startedAt,
            source: 'short-circuit',
          });
          return;
        }
      }

      const remoteResponse = await axiosProxyRequest(payload);

      if (!reply.sent) {
        reply.status(remoteResponse.status).send(remoteResponse.data);
      }

      const size = parseSize(remoteResponse.headers['content-length']);
      const upstreamStats: ProxyStats = {
        url: payload.url,
        method: payload.method,
        status: remoteResponse.status,
        durationMs: Date.now() - startedAt,
        source: 'upstream',
      };
      if (size !== undefined) {
        upstreamStats.responseSizeBytes = size;
      }
      await fireStats(upstreamStats);
    } catch (error) {
      const proxyError = error as ProxyError;
      await fireStats({
        url: payload.url,
        method: payload.method,
        status: proxyError.status ?? 500,
        durationMs: Date.now() - startedAt,
        source: 'upstream',
      });
      if (!reply.sent) {
        try {
          await errorHandler(proxyError, request, reply);
        } catch (handlerError) {
          console.error('Custom error handler failed:', handlerError);
          if (!reply.sent) {
            defaultFastifyErrorHandler(proxyError, request, reply);
          }
        }
      }
    }
  };
}
