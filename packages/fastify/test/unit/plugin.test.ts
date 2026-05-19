import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createFastifyProxyHandler, defaultFastifyErrorHandler } from '../../src/plugin.js';
import type { FastifyProxyConfig, ProxyError } from '../../src/types.js';

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
  const BASE = 'http://upstream.test';

  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('proxies GET and sends status + body', async () => {
    nock(BASE).get('/health').reply(200, { ok: true });
    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const req = mockRequest({ url: '/health' });
    const reply = mockReply();
    await handler(req, reply);
    expect(reply._status).toBe(200);
    expect(reply._body).toEqual({ ok: true });
  });

  it('re-serializes JSON body for POST', async () => {
    let received: unknown;
    nock(BASE).post('/echo').reply(200, function (_uri, body) {
      received = body;
      return body;
    });
    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const req = mockRequest({ method: 'POST', url: '/echo', body: { name: 'test' } });
    await handler(req, mockReply());
    expect(received).toEqual({ name: 'test' });
  });

  it('resolves proxyPath template from request.params', async () => {
    let calledPath = '';
    nock(BASE).get('/items/99').reply(200, function (uri) {
      calledPath = uri;
      return {};
    });
    const handler = createFastifyProxyHandler({ baseURL: BASE }, '/items/:id');
    const req = mockRequest({ url: '/proxy/99', params: { id: '99' } });
    await handler(req, mockReply());
    expect(calledPath).toBe('/items/99');
  });

  it('beforeRequest short-circuits without hitting upstream', async () => {
    const upstreamSpy = vi.fn();
    nock(BASE).get('/any').reply(200, upstreamSpy);
    const beforeRequest = vi.fn().mockResolvedValue({ status: 401, data: { error: 'unauthorized' } });
    const handler = createFastifyProxyHandler({ baseURL: BASE, beforeRequest });
    const req = mockRequest({ url: '/any' });
    const reply = mockReply();
    await handler(req, reply);
    expect(reply._status).toBe(401);
    expect(upstreamSpy).not.toHaveBeenCalled();
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
    const handler = createFastifyProxyHandler({ baseURL: BASE, beforeRequest });
    await handler(mockRequest({ url: '/secure' }), mockReply());
    expect(sentHeaders['x-injected']).toBe('yes');
  });

  it('onResponse fires with correct stats on success', async () => {
    nock(BASE).get('/ping').reply(200, {});
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
    nock(BASE).get('/fail').reply(500, { message: 'boom' });
    const errorHandler = vi.fn();
    const handler = createFastifyProxyHandler({ baseURL: BASE, errorHandler });
    await handler(mockRequest({ url: '/fail' }), mockReply());
    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0]).toMatchObject({ status: 500 });
  });

  it('uses defaultFastifyErrorHandler when no custom handler provided', async () => {
    nock(BASE).get('/err').reply(503, { message: 'unavailable' });
    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const reply = mockReply();
    await handler(mockRequest({ url: '/err' }), reply);
    expect(reply._status).toBe(503);
    expect((reply._body as any).error).toBeDefined();
  });

  it('onResponse fires with error stats on upstream failure', async () => {
    nock(BASE).get('/bad').reply(400, {});
    const onResponse = vi.fn();
    const handler = createFastifyProxyHandler({ baseURL: BASE, onResponse });
    await handler(mockRequest({ url: '/bad' }), mockReply());
    expect(onResponse).toHaveBeenCalledOnce();
    expect(onResponse.mock.calls[0][0].status).toBe(400);
  });

  it('headers() factory is called with request', async () => {
    nock(BASE).get('/').reply(200, {});
    const headers = vi.fn().mockReturnValue({ 'x-custom': 'value' });
    const handler = createFastifyProxyHandler({ baseURL: BASE, headers });
    const req = mockRequest();
    await handler(req, mockReply());
    expect(headers).toHaveBeenCalledWith(req);
  });

  it('skips send when reply.sent is already true', async () => {
    nock(BASE).get('/').reply(200, { data: 1 });
    const handler = createFastifyProxyHandler({ baseURL: BASE });
    const reply = mockReply();
    reply.sent = true;
    await handler(mockRequest(), reply);
    expect(reply.send).not.toHaveBeenCalled();
  });
});
