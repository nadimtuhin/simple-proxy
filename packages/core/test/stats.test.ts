import { describe, it, expect } from 'vitest';
import { buildUpstreamStats, buildErrorStats } from '../src/stats.js';
import type { ProxyRequestPayload, ProxyError } from '../src/types.js';

const payload: ProxyRequestPayload = {
  url: 'http://example.com/test',
  method: 'GET',
  headers: {},
  timeout: 30000,
};

describe('buildUpstreamStats', () => {
  it('builds stats with correct url/method/status/source', () => {
    const startedAt = Date.now() - 100;
    const stats = buildUpstreamStats(payload, 200, startedAt, {});
    expect(stats.url).toBe(payload.url);
    expect(stats.method).toBe(payload.method);
    expect(stats.status).toBe(200);
    expect(stats.source).toBe('upstream');
    expect(stats.durationMs).toBeGreaterThanOrEqual(100);
  });

  it('includes responseSizeBytes when content-length header is present', () => {
    const stats = buildUpstreamStats(payload, 200, Date.now(), { 'content-length': '512' });
    expect(stats.responseSizeBytes).toBe(512);
  });

  it('omits responseSizeBytes when content-length header is absent', () => {
    const stats = buildUpstreamStats(payload, 200, Date.now(), {});
    expect(stats.responseSizeBytes).toBeUndefined();
  });

  it('omits responseSizeBytes when content-length is not parseable', () => {
    const stats = buildUpstreamStats(payload, 200, Date.now(), { 'content-length': 'nan' });
    expect(stats.responseSizeBytes).toBeUndefined();
  });
});

describe('buildErrorStats', () => {
  it('builds stats with error status and upstream source', () => {
    const error: ProxyError = Object.assign(new Error('fail'), { status: 503 });
    const startedAt = Date.now() - 50;
    const stats = buildErrorStats(payload, error, startedAt);
    expect(stats.status).toBe(503);
    expect(stats.source).toBe('upstream');
    expect(stats.url).toBe(payload.url);
    expect(stats.method).toBe(payload.method);
    expect(stats.durationMs).toBeGreaterThanOrEqual(50);
  });

  it('defaults status to 500 when error has no status', () => {
    const error = new Error('no status') as ProxyError;
    const stats = buildErrorStats(payload, error, Date.now());
    expect(stats.status).toBe(500);
  });
});
