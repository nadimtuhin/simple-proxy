import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Context } from 'koa';
import { createKoaProxyMiddleware, defaultKoaErrorHandler } from '../../src/middleware.js';
import type { KoaProxyConfig, ProxyError } from '../../src/types.js';

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

function mockCtx(overrides: Partial<{
  method: string;
  path: string;
  query: Record<string, string>;
  params: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}>= {}): Context {
  const _headers: Record<string, string> = {};
  const body = overrides.body ?? {};
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/',
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    status: 200,
    body: undefined,
    request: { body } as any,
    get: vi.fn((name: string) => overrides.headers?.[name.toLowerCase()] ?? ''),
    set: vi.fn((name: string, value: string) => { _headers[name] = value; }),
  } as unknown as Context;
}

describe('defaultKoaErrorHandler', () => {
  it('sets status and body from error', () => {
    const ctx = mockCtx();
    const error: ProxyError = Object.assign(new Error('Bad request'), { status: 400, code: 'REQUEST_ERROR' });
    defaultKoaErrorHandler(error, ctx);
    expect(ctx.status).toBe(400);
    expect((ctx.body as any).error.message).toBe('Bad request');
    expect((ctx.body as any).error.code).toBe('REQUEST_ERROR');
  });

  it('defaults to 500 when status missing', () => {
    const ctx = mockCtx();
    defaultKoaErrorHandler(new Error('oops') as ProxyError, ctx);
    expect(ctx.status).toBe(500);
  });

  it('forwards filtered upstream headers', () => {
    const ctx = mockCtx();
    const error: ProxyError = Object.assign(new Error('Rate limit'), {
      status: 429,
      headers: { 'retry-after': '30', 'content-length': '50' },
    });
    defaultKoaErrorHandler(error, ctx);
    expect(ctx.set).toHaveBeenCalledWith('retry-after', '30');
    expect(ctx.set).not.toHaveBeenCalledWith('content-length', '50');
  });
});

describe('createKoaProxyMiddleware', () => {
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

  it('proxies GET and sets ctx.status + ctx.body', async () => {
    route('GET', '/health', 200, { ok: true });
    const mw = createKoaProxyMiddleware({ baseURL: BASE });
    const ctx = mockCtx({ path: '/health' });
    await mw(ctx, vi.fn());
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ ok: true });
  });

  it('re-serializes JSON body for POST', async () => {
    let received: unknown;
    routes.set('POST /echo', (_req, res, body) => {
      received = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
    const mw = createKoaProxyMiddleware({ baseURL: BASE });
    const ctx = mockCtx({ method: 'POST', path: '/echo', body: { name: 'test' } });
    await mw(ctx, vi.fn());
    expect(received).toEqual({ name: 'test' });
  });

  it('resolves proxyPath template from ctx.params', async () => {
    let calledPath = '';
    routes.set('GET /items/42', (req, res) => {
      calledPath = (req.url ?? '').split('?')[0];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    });
    const mw = createKoaProxyMiddleware({ baseURL: BASE }, '/items/:id');
    const ctx = mockCtx({ path: '/proxy/42', params: { id: '42' } });
    await mw(ctx, vi.fn());
    expect(calledPath).toBe('/items/42');
  });

  it('beforeRequest short-circuits without hitting upstream', async () => {
    const upstream = vi.fn();
    routes.set('GET /any', (_req, res) => {
      upstream();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    });
    const beforeRequest = vi.fn().mockResolvedValue({ status: 403, data: { error: 'forbidden' } });
    const mw = createKoaProxyMiddleware({ baseURL: BASE, beforeRequest });
    const ctx = mockCtx({ path: '/any' });
    await mw(ctx, vi.fn());
    expect(ctx.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
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
    const mw = createKoaProxyMiddleware({ baseURL: BASE, beforeRequest });
    const ctx = mockCtx({ path: '/secure' });
    await mw(ctx, vi.fn());
    expect(sentHeaders['x-injected']).toBe('yes');
  });

  it('onResponse fires with correct stats on success', async () => {
    route('GET', '/ping', 200, {});
    const onResponse = vi.fn();
    const mw = createKoaProxyMiddleware({ baseURL: BASE, onResponse });
    const ctx = mockCtx({ path: '/ping' });
    await mw(ctx, vi.fn());
    expect(onResponse).toHaveBeenCalledOnce();
    const stats = onResponse.mock.calls[0][0];
    expect(stats.status).toBe(200);
    expect(stats.source).toBe('upstream');
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('invokes custom errorHandler on upstream error', async () => {
    route('GET', '/fail', 500, { message: 'boom' });
    const errorHandler = vi.fn();
    const mw = createKoaProxyMiddleware({ baseURL: BASE, errorHandler });
    const ctx = mockCtx({ path: '/fail' });
    await mw(ctx, vi.fn());
    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0]).toMatchObject({ status: 500 });
  });

  it('uses defaultKoaErrorHandler when no custom handler provided', async () => {
    route('GET', '/err', 503, { message: 'unavailable' });
    const mw = createKoaProxyMiddleware({ baseURL: BASE });
    const ctx = mockCtx({ path: '/err' });
    await mw(ctx, vi.fn());
    expect(ctx.status).toBe(503);
    expect((ctx.body as any).error).toBeDefined();
  });

  it('onResponse fires with error stats on upstream failure', async () => {
    route('GET', '/bad', 400, {});
    const onResponse = vi.fn();
    const mw = createKoaProxyMiddleware({ baseURL: BASE, onResponse });
    const ctx = mockCtx({ path: '/bad' });
    await mw(ctx, vi.fn());
    expect(onResponse).toHaveBeenCalledOnce();
    const stats = onResponse.mock.calls[0][0];
    expect(stats.status).toBe(400);
  });

  it('headers() factory is called with ctx', async () => {
    route('GET', '/', 200, {});
    const headers = vi.fn().mockReturnValue({ 'x-custom': 'value' });
    const mw = createKoaProxyMiddleware({ baseURL: BASE, headers });
    const ctx = mockCtx();
    await mw(ctx, vi.fn());
    expect(headers).toHaveBeenCalledWith(ctx);
  });
});
