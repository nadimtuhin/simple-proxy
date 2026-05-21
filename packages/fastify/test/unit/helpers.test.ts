import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  getRequestPath,
  buildBasePayload,
  attachJsonToPayload,
  applyShortCircuitToReply,
  buildShortCircuitStats,
  createFireStats,
} from '../../src/helpers.js';
import type { FastifyProxyConfig, ProxyRequestPayload } from '../../src/types.js';

function mockReply() {
  const r = {
    sent: false,
    _status: 200,
    _body: undefined as unknown,
    _headers: {} as Record<string, string>,
    status: vi.fn().mockImplementation(function (code: number) { r._status = code; return r; }),
    send: vi.fn().mockImplementation(function (body: unknown) { r._body = body; r.sent = true; return r; }),
    header: vi.fn().mockImplementation(function (name: string, value: string) { r._headers[name] = value; return r; }),
  };
  return r as unknown as FastifyReply & { _status: number; _body: unknown; _headers: Record<string, string> };
}

function mockRequest(overrides: Partial<{
  method: string; url: string; params: Record<string, string>;
  query: Record<string, string>; headers: Record<string, string>; body: unknown;
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

describe('getRequestPath', () => {
  it('returns path without query string', () => {
    expect(getRequestPath('/items?foo=bar')).toBe('/items');
  });

  it('returns full url when no query string', () => {
    expect(getRequestPath('/items/123')).toBe('/items/123');
  });
});

describe('buildBasePayload', () => {
  const config: FastifyProxyConfig = { baseURL: 'http://api.test' };

  it('builds payload with url, method, timeout', () => {
    const req = mockRequest({ url: '/users', method: 'GET' });
    const payload = buildBasePayload(config, req);
    expect(payload.url).toBe('http://api.test/users');
    expect(payload.method).toBe('GET');
    expect(payload.timeout).toBeGreaterThan(0);
  });

  it('resolves proxyPath template with params', () => {
    const req = mockRequest({ url: '/proxy/5', params: { id: '5' } });
    const payload = buildBasePayload(config, req, '/items/:id');
    expect(payload.url).toBe('http://api.test/items/5');
  });

  it('appends query string', () => {
    const req = mockRequest({ url: '/search?q=test', query: { q: 'test' } });
    const payload = buildBasePayload(config, req);
    expect(payload.url).toContain('?q=test');
  });

  it('calls headers factory with request', () => {
    const headers = vi.fn().mockReturnValue({ 'x-api-key': 'abc' });
    const req = mockRequest();
    const payload = buildBasePayload({ baseURL: 'http://api.test', headers }, req);
    expect(headers).toHaveBeenCalledWith(req);
    expect(payload.headers['x-api-key']).toBe('abc');
  });
});

describe('attachJsonToPayload', () => {
  it('sets data and Content-Type for POST with json body', () => {
    const payload: ProxyRequestPayload = { url: '', method: 'POST', headers: {}, timeout: 30000 };
    const req = mockRequest({ method: 'POST', body: { name: 'test' } });
    attachJsonToPayload(payload, req);
    expect(payload.data).toBe(JSON.stringify({ name: 'test' }));
    expect(payload.headers['Content-Type']).toBe('application/json');
  });

  it('does not set Content-Type if already present', () => {
    const payload: ProxyRequestPayload = {
      url: '', method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      timeout: 30000,
    };
    const req = mockRequest({ method: 'POST', body: 'raw string' });
    attachJsonToPayload(payload, req);
    expect(payload.headers['Content-Type']).toBe('text/plain');
    expect(payload.data).toBe('raw string');
  });

  it('does not set data for GET requests', () => {
    const payload: ProxyRequestPayload = { url: '', method: 'GET', headers: {}, timeout: 30000 };
    const req = mockRequest({ method: 'GET', body: { ignored: true } });
    attachJsonToPayload(payload, req);
    expect(payload.data).toBeUndefined();
  });

  it('skips body if null/undefined', () => {
    const payload: ProxyRequestPayload = { url: '', method: 'POST', headers: {}, timeout: 30000 };
    const req = mockRequest({ method: 'POST', body: null });
    attachJsonToPayload(payload, req);
    expect(payload.data).toBeUndefined();
  });
});

describe('applyShortCircuitToReply', () => {
  it('sets status and sends data', () => {
    const reply = mockReply();
    applyShortCircuitToReply({ status: 401, data: { error: 'unauthorized' } }, reply);
    expect(reply._status).toBe(401);
    expect(reply._body).toEqual({ error: 'unauthorized' });
  });

  it('sets response headers from hookResult', () => {
    const reply = mockReply();
    applyShortCircuitToReply({ status: 200, data: 'ok', headers: { 'x-cached': 'true' } }, reply);
    expect(reply._headers['x-cached']).toBe('true');
  });
});

describe('buildShortCircuitStats', () => {
  it('returns stats with short-circuit source', () => {
    const payload: ProxyRequestPayload = {
      url: 'http://api.test/test', method: 'GET', headers: {}, timeout: 30000,
    };
    const startedAt = Date.now() - 10;
    const stats = buildShortCircuitStats(payload, 401, startedAt);
    expect(stats.source).toBe('short-circuit');
    expect(stats.status).toBe(401);
    expect(stats.url).toBe(payload.url);
    expect(stats.durationMs).toBeGreaterThanOrEqual(10);
  });
});

describe('createFireStats', () => {
  it('calls onResponse once with stats', async () => {
    const onResponse = vi.fn().mockResolvedValue(undefined);
    const fireStats = createFireStats(onResponse, {} as FastifyRequest, mockReply());
    const stats = { url: 'u', method: 'GET', status: 200, durationMs: 5, source: 'upstream' as const };
    await fireStats(stats);
    expect(onResponse).toHaveBeenCalledOnce();
    expect(onResponse.mock.calls[0][0]).toBe(stats);
  });

  it('only fires once on repeated calls', async () => {
    const onResponse = vi.fn().mockResolvedValue(undefined);
    const fireStats = createFireStats(onResponse, {} as FastifyRequest, mockReply());
    const stats = { url: 'u', method: 'GET', status: 200, durationMs: 5, source: 'upstream' as const };
    await fireStats(stats);
    await fireStats(stats);
    expect(onResponse).toHaveBeenCalledOnce();
  });

  it('returns noop function when onResponse is undefined', async () => {
    const fireStats = createFireStats(undefined, {} as FastifyRequest, mockReply());
    const stats = { url: 'u', method: 'GET', status: 200, durationMs: 5, source: 'upstream' as const };
    await expect(fireStats(stats)).resolves.toBeUndefined();
  });
});
