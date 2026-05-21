import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'koa';
import {
  buildBasePayload,
  extractKoaFiles,
  attachKoaBodyToPayload,
  applyShortCircuitToCtx,
  buildShortCircuitStats,
  createFireStats,
} from '../../src/helpers.js';
import type { KoaProxyConfig, ProxyRequestPayload } from '../../src/types.js';

function mockCtx(overrides: Partial<{
  method: string; path: string; query: Record<string, string>;
  params: Record<string, string>; contentType: string; body: unknown; files: unknown;
}> = {}): Context {
  const _headers: Record<string, string> = {};
  const ct = overrides.contentType ?? '';
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/',
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    status: 200,
    body: undefined,
    request: { body: overrides.body ?? {}, files: overrides.files } as unknown,
    get: vi.fn((name: string) => name === 'content-type' ? ct : ''),
    set: vi.fn((name: string, value: string) => { _headers[name] = value; }),
    _headers,
  } as unknown as Context;
}

describe('buildBasePayload', () => {
  const config: KoaProxyConfig = { baseURL: 'http://api.test' };

  it('builds url from config.baseURL + ctx.path', () => {
    const ctx = mockCtx({ path: '/users' });
    const payload = buildBasePayload(config, ctx);
    expect(payload.url).toBe('http://api.test/users');
    expect(payload.method).toBe('GET');
  });

  it('resolves proxyPath template with ctx.params', () => {
    const ctx = mockCtx({ path: '/proxy/7', params: { id: '7' } });
    const payload = buildBasePayload(config, ctx, '/items/:id');
    expect(payload.url).toBe('http://api.test/items/7');
  });

  it('appends query string', () => {
    const ctx = mockCtx({ query: { search: 'hello' } });
    const payload = buildBasePayload(config, ctx);
    expect(payload.url).toContain('?search=hello');
  });

  it('calls headers factory with ctx', () => {
    const headers = vi.fn().mockReturnValue({ 'x-token': 'tok' });
    const ctx = mockCtx();
    buildBasePayload({ baseURL: 'http://api.test', headers }, ctx);
    expect(headers).toHaveBeenCalledWith(ctx);
  });
});

describe('extractKoaFiles', () => {
  it('returns empty array when rawFiles is undefined', () => {
    expect(extractKoaFiles(undefined)).toEqual([]);
  });

  it('handles array of files', () => {
    const raw = [{ fieldname: 'f', originalname: 'img.png', encoding: '7bit', mimetype: 'image/png', buffer: Buffer.from(''), size: 0 }];
    const result = extractKoaFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0].fieldname).toBe('f');
  });

  it('handles object map of files', () => {
    const raw = {
      photo: [{ fieldname: 'photo', originalname: 'a.jpg', encoding: '7bit', mimetype: 'image/jpeg', buffer: Buffer.from(''), size: 10 }],
    };
    const result = extractKoaFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0].originalname).toBe('a.jpg');
  });
});

describe('attachKoaBodyToPayload', () => {
  it('sets JSON data and Content-Type for POST', () => {
    const payload: ProxyRequestPayload = { url: '', method: 'POST', headers: {}, timeout: 30000 };
    const ctx = mockCtx({ method: 'POST', body: { key: 'val' } });
    attachKoaBodyToPayload(payload, ctx);
    expect(payload.data).toBe(JSON.stringify({ key: 'val' }));
    expect(payload.headers['Content-Type']).toBe('application/json');
  });

  it('does not set data for GET', () => {
    const payload: ProxyRequestPayload = { url: '', method: 'GET', headers: {}, timeout: 30000 };
    const ctx = mockCtx({ method: 'GET', body: { key: 'val' } });
    attachKoaBodyToPayload(payload, ctx);
    expect(payload.data).toBeUndefined();
  });

  it('handles multipart by creating FormData', () => {
    const payload: ProxyRequestPayload = { url: '', method: 'POST', headers: {}, timeout: 30000 };
    const ctx = mockCtx({ method: 'POST', contentType: 'multipart/form-data', body: { field: 'v' } });
    attachKoaBodyToPayload(payload, ctx);
    expect(payload.data).toBeDefined();
    // FormData produces headers
    expect(payload.headers['content-type']).toMatch(/multipart\/form-data/);
  });
});

describe('applyShortCircuitToCtx', () => {
  it('sets ctx.status and ctx.body', () => {
    const ctx = mockCtx();
    applyShortCircuitToCtx({ status: 403, data: { error: 'forbidden' } }, ctx);
    expect(ctx.status).toBe(403);
    expect(ctx.body).toEqual({ error: 'forbidden' });
  });

  it('sets response headers from hookResult', () => {
    const ctx = mockCtx();
    applyShortCircuitToCtx({ status: 200, data: 'ok', headers: { 'x-flag': '1' } }, ctx);
    expect(ctx.set).toHaveBeenCalledWith('x-flag', '1');
  });
});

describe('buildShortCircuitStats', () => {
  it('returns stats with short-circuit source', () => {
    const payload: ProxyRequestPayload = {
      url: 'http://api.test/x', method: 'POST', headers: {}, timeout: 30000,
    };
    const stats = buildShortCircuitStats(payload, 403, Date.now() - 5);
    expect(stats.source).toBe('short-circuit');
    expect(stats.status).toBe(403);
  });
});

describe('createFireStats', () => {
  it('calls onResponse once', async () => {
    const onResponse = vi.fn().mockResolvedValue(undefined);
    const fireStats = createFireStats(onResponse, mockCtx());
    const stats = { url: 'u', method: 'GET', status: 200, durationMs: 1, source: 'upstream' as const };
    await fireStats(stats);
    await fireStats(stats);
    expect(onResponse).toHaveBeenCalledOnce();
  });

  it('is a noop when onResponse is undefined', async () => {
    const fireStats = createFireStats(undefined, mockCtx());
    await expect(fireStats({ url: 'u', method: 'GET', status: 200, durationMs: 1, source: 'upstream' })).resolves.toBeUndefined();
  });
});
