import { describe, it, expect, vi } from 'vitest';
import { Response } from 'express';
import {
  buildShortCircuitStats,
  buildUpstreamStats,
  buildErrorStats,
  sendShortCircuit,
  reportStats,
} from '../../src/proxy.js';
import type { ProxyRequestPayload, ProxyStats } from '../../src/types.js';
import type { RequestWithFiles } from '../../src/types.js';

const basePayload: ProxyRequestPayload = {
  url: 'http://example.com/users',
  method: 'GET',
  headers: {},
  timeout: 5000,
};

describe('buildShortCircuitStats', () => {
  it('returns a ProxyStats with source=short-circuit', () => {
    const startedAt = Date.now() - 50;
    const stats = buildShortCircuitStats(basePayload, 202, startedAt);
    expect(stats).toMatchObject({
      url: 'http://example.com/users',
      method: 'GET',
      status: 202,
      source: 'short-circuit',
    });
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('is a pure function — no side effects', () => {
    const startedAt = Date.now();
    const s1 = buildShortCircuitStats(basePayload, 200, startedAt);
    const s2 = buildShortCircuitStats(basePayload, 200, startedAt);
    expect(s1).toEqual(s2);
  });
});

describe('buildUpstreamStats', () => {
  it('returns ProxyStats with source=upstream', () => {
    const startedAt = Date.now() - 100;
    const remoteResponse = { status: 200, data: {}, headers: {} };
    const stats = buildUpstreamStats(basePayload, remoteResponse as any, startedAt);
    expect(stats).toMatchObject({ source: 'upstream', status: 200 });
  });

  it('includes responseSizeBytes when content-length header present', () => {
    const startedAt = Date.now();
    const remoteResponse = { status: 200, data: {}, headers: { 'content-length': '512' } };
    const stats = buildUpstreamStats(basePayload, remoteResponse as any, startedAt);
    expect(stats.responseSizeBytes).toBe(512);
  });

  it('omits responseSizeBytes when content-length header absent', () => {
    const startedAt = Date.now();
    const remoteResponse = { status: 200, data: {}, headers: {} };
    const stats = buildUpstreamStats(basePayload, remoteResponse as any, startedAt);
    expect(stats).not.toHaveProperty('responseSizeBytes');
  });
});

describe('buildErrorStats', () => {
  it('returns ProxyStats with source=upstream and error status', () => {
    const startedAt = Date.now() - 30;
    const error = Object.assign(new Error('fail'), { status: 404 });
    const stats = buildErrorStats(basePayload, error as any, startedAt);
    expect(stats).toMatchObject({ source: 'upstream', status: 404 });
  });

  it('defaults status to 500 when error.status is undefined', () => {
    const startedAt = Date.now();
    const error = new Error('oops');
    const stats = buildErrorStats(basePayload, error as any, startedAt);
    expect(stats.status).toBe(500);
  });
});

describe('sendShortCircuit', () => {
  it('sets headers when hookResult.headers present', () => {
    const mockRes = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    sendShortCircuit(mockRes, { status: 200, data: { ok: true }, headers: { 'x-cache': 'HIT' } });
    expect(mockRes.set).toHaveBeenCalledWith({ 'x-cache': 'HIT' });
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ ok: true });
  });

  it('skips set() when no headers in hookResult', () => {
    const mockRes = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    sendShortCircuit(mockRes, { status: 202, data: {} });
    expect(mockRes.set).not.toHaveBeenCalled();
  });
});

describe('reportStats', () => {
  it('calls onResponse with stats, req, res', async () => {
    const onResponse = vi.fn();
    const mockReq = {} as RequestWithFiles;
    const mockRes = {} as Response;
    const stats: ProxyStats = { url: 'x', method: 'GET', status: 200, durationMs: 10, source: 'upstream' };
    await reportStats(onResponse, stats, mockReq, mockRes);
    expect(onResponse).toHaveBeenCalledWith(stats, mockReq, mockRes);
  });

  it('does nothing when onResponse is undefined', async () => {
    const mockReq = {} as RequestWithFiles;
    const mockRes = {} as Response;
    const stats: ProxyStats = { url: 'x', method: 'GET', status: 200, durationMs: 10, source: 'upstream' };
    await expect(reportStats(undefined, stats, mockReq, mockRes)).resolves.toBeUndefined();
  });

  it('swallows errors thrown by onResponse', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onResponse = vi.fn().mockRejectedValue(new Error('boom'));
    const mockReq = {} as RequestWithFiles;
    const mockRes = {} as Response;
    const stats: ProxyStats = { url: 'x', method: 'GET', status: 200, durationMs: 10, source: 'upstream' };
    await expect(reportStats(onResponse, stats, mockReq, mockRes)).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});
