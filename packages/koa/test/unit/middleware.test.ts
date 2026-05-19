import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import type { Context } from 'koa';
import { createKoaProxyMiddleware, defaultKoaErrorHandler } from '../../src/middleware.js';
import type { KoaProxyConfig, ProxyError } from '../../src/types.js';

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
  const BASE = 'http://upstream.test';

  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('proxies GET and sets ctx.status + ctx.body', async () => {
    nock(BASE).get('/health').reply(200, { ok: true });
    const mw = createKoaProxyMiddleware({ baseURL: BASE });
    const ctx = mockCtx({ path: '/health' });
    await mw(ctx, vi.fn());
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ ok: true });
  });

  it('re-serializes JSON body for POST', async () => {
    let received: string | undefined;
    nock(BASE).post('/echo').reply(200, function (_uri, body) {
      received = body as string;
      return body;
    });
    const mw = createKoaProxyMiddleware({ baseURL: BASE });
    const ctx = mockCtx({ method: 'POST', path: '/echo', body: { name: 'test' } });
    await mw(ctx, vi.fn());
    expect(received).toEqual({ name: 'test' });
  });

  it('resolves proxyPath template from ctx.params', async () => {
    let calledPath = '';
    nock(BASE).get('/items/42').reply(200, function (uri) {
      calledPath = uri;
      return {};
    });
    const mw = createKoaProxyMiddleware({ baseURL: BASE }, '/items/:id');
    const ctx = mockCtx({ path: '/proxy/42', params: { id: '42' } });
    await mw(ctx, vi.fn());
    expect(calledPath).toBe('/items/42');
  });

  it('beforeRequest short-circuits without hitting upstream', async () => {
    const upstream = vi.fn();
    nock(BASE).get('/any').reply(200, upstream);
    const beforeRequest = vi.fn().mockResolvedValue({ status: 403, data: { error: 'forbidden' } });
    const mw = createKoaProxyMiddleware({ baseURL: BASE, beforeRequest });
    const ctx = mockCtx({ path: '/any' });
    await mw(ctx, vi.fn());
    expect(ctx.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('beforeRequest can mutate payload headers', async () => {
    let sentHeaders: Record<string, string> = {};
    nock(BASE).get('/secure').reply(200, function () {
      sentHeaders = this.req.headers as Record<string, string>;
      return {};
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
    nock(BASE).get('/ping').reply(200, {});
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
    nock(BASE).get('/fail').reply(500, { message: 'boom' });
    const errorHandler = vi.fn();
    const mw = createKoaProxyMiddleware({ baseURL: BASE, errorHandler });
    const ctx = mockCtx({ path: '/fail' });
    await mw(ctx, vi.fn());
    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0]).toMatchObject({ status: 500 });
  });

  it('uses defaultKoaErrorHandler when no custom handler provided', async () => {
    nock(BASE).get('/err').reply(503, { message: 'unavailable' });
    const mw = createKoaProxyMiddleware({ baseURL: BASE });
    const ctx = mockCtx({ path: '/err' });
    await mw(ctx, vi.fn());
    expect(ctx.status).toBe(503);
    expect((ctx.body as any).error).toBeDefined();
  });

  it('onResponse fires with error stats on upstream failure', async () => {
    nock(BASE).get('/bad').reply(400, {});
    const onResponse = vi.fn();
    const mw = createKoaProxyMiddleware({ baseURL: BASE, onResponse });
    const ctx = mockCtx({ path: '/bad' });
    await mw(ctx, vi.fn());
    expect(onResponse).toHaveBeenCalledOnce();
    const stats = onResponse.mock.calls[0][0];
    expect(stats.status).toBe(400);
  });

  it('headers() factory is called with ctx', async () => {
    nock(BASE).get('/').reply(200, {});
    const headers = vi.fn().mockReturnValue({ 'x-custom': 'value' });
    const mw = createKoaProxyMiddleware({ baseURL: BASE, headers });
    const ctx = mockCtx();
    await mw(ctx, vi.fn());
    expect(headers).toHaveBeenCalledWith(ctx);
  });
});
