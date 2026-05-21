import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createFastifyProxyHandler, defaultFastifyErrorHandler } from '../../src/plugin.js';
import type { FastifyProxyConfig, ProxyError } from '../../src/types.js';

type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
const routes = new Map<string, RouteHandler>();
let server: Server;
let BASE: string;

function route(method: string, path: string, status: number, data: unknown, headers: Record<string, string> = {}) {
  routes.set(`${method} ${path}`, (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
  });
}

function mockRequest(overrides: Partial<{
  method: string;
  url: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}> = {}): FastifyRequest {
  return {
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '/',
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: overrides.headers ?? {},
    body: overrides.body ?? undefined,
  } as unknown as FastifyRequest;
}

function mockReply(): FastifyReply & { _status: number; _body: unknown; _headers: Record<string, string> } {
  const r = {
    sent: false,
    _status: 200,
    _body: undefined as unknown,
    _headers: {} as Record<string, string>,
    status: vi.fn().mockImplementation(function (this: typeof r, code: number) {
      r._status = code;
      return r;
    }),
    send: vi.fn().mockImplementation(function (this: typeof r, body: unknown) {
      r._body = body;
      r.sent = true;
      return r;
    }),
    header: vi.fn().mockImplementation(function (this: typeof r, name: string, value: string) {
      r._headers[name] = value;
      return r;
    }),
  };
  return r as any;
}

describe('defaultFastifyErrorHandler', () => {
  it('sets status and sends error body', () => {
    const req = mockRequest();
    const reply = mockReply();
    const error: ProxyError = Object.assign(new Error('Bad request'), { status: 400, code: 'REQUEST_ERROR' });
    defaultFastifyErrorHandler(error, req, reply);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: 'Bad request' }) })
    );
  });

  it('defaults to 500 when status missing', () => {
    const reply = mockReply();
    defaultFastifyErrorHandler(new Error('oops') as ProxyError, mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('forwards filtered upstream headers', () => {
    const reply = mockReply();
    const error: ProxyError = Object.assign(new Error('Rate limit'), {
      status: 429,
      headers: { 'retry-after': '30', 'content-length': '50' },
    });
    defaultFastifyErrorHandler(error, mockRequest(), reply);
    expect(reply.header).toHaveBeenCalledWith('retry-after', '30');
    expect(reply.header).not.toHaveBeenCalledWith('content-length', '50');
  });
});

describe('createFastifyProxyHandler', () => {
  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      const handler = routes.get(`${req.method} ${path}`);
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (handler) return handler(req, res, body);
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'no route' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  afterEach(() => routes.clear());

  it('proxies GET and sends status + body', async () => {
    route('GET', '/health', 200, { ok: true });
    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const req = mockRequest({ url: '/health' });
    const reply = mockReply();
    await handler(req, reply);
    expect(reply._status).toBe(200);
    expect(reply._body).toEqual({ ok: true });
  });

  it('re-serializes JSON body for POST', async () => {
    let received: unknown;
    routes.set('POST /echo', (_req, res, body) => {
      received = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const req = mockRequest({ method: 'POST', url: '/echo', body: { name: 'test' } });
    await handler(req, mockReply());
    expect(received).toEqual({ name: 'test' });
  });

  it('resolves proxyPath template from request.params', async () => {
    let calledPath = '';
    routes.set('GET /items/99', (req, res) => {
      calledPath = (req.url ?? '').split('?')[0];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    });
    const handler = createFastifyProxyHandler({ baseURL: BASE }, '/items/:id');
    const req = mockRequest({ url: '/proxy/99', params: { id: '99' } });
    await handler(req, mockReply());
    expect(calledPath).toBe('/items/99');
  });

  it('beforeRequest short-circuits without hitting upstream', async () => {
    const upstreamSpy = vi.fn();
    routes.set('GET /any', (_req, res) => {
      upstreamSpy();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    });
    const beforeRequest = vi.fn().mockResolvedValue({ status: 401, data: { error: 'unauthorized' } });
    const handler = createFastifyProxyHandler({ baseURL: BASE, beforeRequest });
    const req = mockRequest({ url: '/any' });
    const reply = mockReply();
    await handler(req, reply);
    expect(reply._status).toBe(401);
    expect(upstreamSpy).not.toHaveBeenCalled();
  });

  it('beforeRequest can mutate payload headers', async () => {
    let sentHeaders: Record<string, string | string[] | undefined> = {};
    routes.set('GET /secure', (req, res) => {
      sentHeaders = req.headers;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    });
    const beforeRequest = vi.fn().mockImplementation((payload) => {
      payload.headers['x-injected'] = 'yes';
    });
    const handler = createFastifyProxyHandler({ baseURL: BASE, beforeRequest });
    await handler(mockRequest({ url: '/secure' }), mockReply());
    expect(sentHeaders['x-injected']).toBe('yes');
  });

  it('onResponse fires with correct stats on success', async () => {
    route('GET', '/ping', 200, {});
    const onResponse = vi.fn();
    const handler = createFastifyProxyHandler({ baseURL: BASE, onResponse });
    await handler(mockRequest({ url: '/ping' }), mockReply());
    expect(onResponse).toHaveBeenCalledOnce();
    const [stats] = onResponse.mock.calls[0];
    expect(stats.status).toBe(200);
    expect(stats.source).toBe('upstream');
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('invokes custom errorHandler on upstream error', async () => {
    route('GET', '/fail', 500, { message: 'boom' });
    const errorHandler = vi.fn();
    const handler = createFastifyProxyHandler({ baseURL: BASE, errorHandler });
    await handler(mockRequest({ url: '/fail' }), mockReply());
    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0]).toMatchObject({ status: 500 });
  });

  it('uses defaultFastifyErrorHandler when no custom handler provided', async () => {
    route('GET', '/err', 503, { message: 'unavailable' });
    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const reply = mockReply();
    await handler(mockRequest({ url: '/err' }), reply);
    expect(reply._status).toBe(503);
    expect((reply._body as any).error).toBeDefined();
  });

  it('onResponse fires with error stats on upstream failure', async () => {
    route('GET', '/bad', 400, {});
    const onResponse = vi.fn();
    const handler = createFastifyProxyHandler({ baseURL: BASE, onResponse });
    await handler(mockRequest({ url: '/bad' }), mockReply());
    expect(onResponse).toHaveBeenCalledOnce();
    expect(onResponse.mock.calls[0][0].status).toBe(400);
  });

  it('headers() factory is called with request', async () => {
    route('GET', '/', 200, {});
    const headers = vi.fn().mockReturnValue({ 'x-custom': 'value' });
    const handler = createFastifyProxyHandler({ baseURL: BASE, headers });
    const req = mockRequest();
    await handler(req, mockReply());
    expect(headers).toHaveBeenCalledWith(req);
  });

  it('skips send when reply.sent is already true', async () => {
    route('GET', '/', 200, { data: 1 });
    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const reply = mockReply();
    reply.sent = true;
    await handler(mockRequest(), reply);
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('handles multipart/form-data with file and field parts', async () => {
    let receivedContentType = '';
    routes.set('POST /upload', (req, res) => {
      receivedContentType = req.headers['content-type'] ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const fileBuffer = Buffer.from('hello file');
    async function* makeParts() {
      yield {
        type: 'file',
        fieldname: 'upload',
        filename: 'hello.txt',
        encoding: '7bit',
        mimetype: 'text/plain',
        toBuffer: async () => fileBuffer,
      };
      yield {
        type: 'field',
        fieldname: 'title',
        value: 'my title',
        encoding: '7bit',
      };
    }

    const req = mockRequest({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': 'multipart/form-data; boundary=xxx' },
    });
    (req as any).parts = makeParts;

    const reply = mockReply();
    await handler(req, reply);

    expect(reply._status).toBe(200);
    expect(receivedContentType).toContain('multipart/form-data');
  });

  it('logs request in development mode', async () => {
    route('GET', '/ping', 200, { ok: true });
    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      await handler(mockRequest({ url: '/ping' }), mockReply());
      expect(consoleSpy).toHaveBeenCalledWith('Proxy Request:', expect.any(String));
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      consoleSpy.mockRestore();
    }
  });

  it('falls back to defaultFastifyErrorHandler when custom errorHandler throws', async () => {
    route('GET', '/fail', 503, { message: 'unavailable' });
    const errorHandler = vi.fn().mockRejectedValue(new Error('handler exploded'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const handler = createFastifyProxyHandler({ baseURL: BASE, errorHandler });
      const reply = mockReply();
      await handler(mockRequest({ url: '/fail' }), reply);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Custom error handler failed:', expect.any(Error));
      expect(reply._status).toBe(503);
      expect(reply.send).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
