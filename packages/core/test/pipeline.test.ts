import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { runProxyPipeline } from '../src/pipeline.js';
import type { PipelineHooks, PipelineCallbacks } from '../src/pipeline.js';
import type { ProxyRequestPayload, ProxyResponse, ShortCircuitResponse, ProxyError } from '../src/types.js';

const BASE_PAYLOAD: ProxyRequestPayload = {
  url: 'http://example.com/api/data',
  method: 'GET',
  headers: {},
  timeout: 5000,
};

function makeCallbacks(overrides?: Partial<PipelineCallbacks>): PipelineCallbacks {
  return {
    onShortCircuit: vi.fn().mockResolvedValue(undefined),
    onSuccess: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn().mockImplementation((err: ProxyError) => Promise.resolve(err)),
    ...overrides,
  };
}

describe('runProxyPipeline', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  describe('happy path — upstream request', () => {
    it('calls axiosProxyRequest and invokes onSuccess', async () => {
      const responseData = { id: 1 };
      nock('http://example.com').get('/api/data').reply(200, responseData);

      const callbacks = makeCallbacks();
      const hooks: PipelineHooks = {};

      await runProxyPipeline(BASE_PAYLOAD, hooks, callbacks, Date.now());

      expect(callbacks.onSuccess).toHaveBeenCalledOnce();
      const successArg = (callbacks.onSuccess as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProxyResponse;
      expect(successArg.status).toBe(200);
      expect(successArg.data).toEqual(responseData);
    });

    it('does not call onShortCircuit or onError on success', async () => {
      nock('http://example.com').get('/api/data').reply(200, {});

      const callbacks = makeCallbacks();
      await runProxyPipeline(BASE_PAYLOAD, {}, callbacks, Date.now());

      expect(callbacks.onShortCircuit).not.toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('fires onResponse stats with source=upstream after success', async () => {
      nock('http://example.com').get('/api/data').reply(200, { x: 1 }, { 'content-length': '9' });

      const onResponse = vi.fn();
      const callbacks = makeCallbacks();
      const startedAt = Date.now();

      await runProxyPipeline(BASE_PAYLOAD, { onResponse }, callbacks, startedAt);

      expect(onResponse).toHaveBeenCalledOnce();
      const stats = onResponse.mock.calls[0][0];
      expect(stats.source).toBe('upstream');
      expect(stats.url).toBe(BASE_PAYLOAD.url);
      expect(stats.method).toBe(BASE_PAYLOAD.method);
      expect(stats.status).toBe(200);
      expect(typeof stats.durationMs).toBe('number');
    });

    it('calls beforeRequest hook when provided and it returns void', async () => {
      nock('http://example.com').get('/api/data').reply(200, { ok: true });

      const beforeRequest = vi.fn().mockResolvedValue(undefined);
      const callbacks = makeCallbacks();

      await runProxyPipeline(BASE_PAYLOAD, { beforeRequest }, callbacks, Date.now());

      expect(beforeRequest).toHaveBeenCalledOnce();
      expect(callbacks.onSuccess).toHaveBeenCalledOnce();
    });
  });

  describe('short-circuit path', () => {
    it('calls onShortCircuit and skips axios when beforeRequest returns ShortCircuitResponse', async () => {
      const shortCircuit: ShortCircuitResponse = { status: 200, data: { cached: true } };
      const beforeRequest = vi.fn().mockResolvedValue(shortCircuit);
      const callbacks = makeCallbacks();

      await runProxyPipeline(BASE_PAYLOAD, { beforeRequest }, callbacks, Date.now());

      expect(callbacks.onShortCircuit).toHaveBeenCalledWith(shortCircuit);
      expect(callbacks.onSuccess).not.toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
      // axios should NOT have been called — nock would throw if it were
    });

    it('fires onResponse stats with source=short-circuit', async () => {
      const shortCircuit: ShortCircuitResponse = { status: 403, data: { blocked: true } };
      const beforeRequest = vi.fn().mockResolvedValue(shortCircuit);
      const onResponse = vi.fn();
      const callbacks = makeCallbacks();

      await runProxyPipeline(BASE_PAYLOAD, { beforeRequest, onResponse }, callbacks, Date.now());

      expect(onResponse).toHaveBeenCalledOnce();
      const stats = onResponse.mock.calls[0][0];
      expect(stats.source).toBe('short-circuit');
      expect(stats.status).toBe(403);
    });
  });

  describe('error path', () => {
    it('calls onError when axios throws', async () => {
      nock('http://example.com').get('/api/data').reply(500, { error: 'boom' });

      const callbacks = makeCallbacks();
      await runProxyPipeline(BASE_PAYLOAD, {}, callbacks, Date.now());

      expect(callbacks.onError).toHaveBeenCalledOnce();
      expect(callbacks.onSuccess).not.toHaveBeenCalled();
    });

    it('fires stats using error returned from onError callback', async () => {
      nock('http://example.com').get('/api/data').reply(500, { error: 'boom' });

      const transformedError: ProxyError = Object.assign(new Error('transformed'), { status: 503, code: 'UPSTREAM_TIMEOUT' });
      const onResponse = vi.fn();
      const callbacks = makeCallbacks({
        onError: vi.fn().mockResolvedValue(transformedError),
      });

      await runProxyPipeline(BASE_PAYLOAD, { onResponse }, callbacks, Date.now());

      expect(onResponse).toHaveBeenCalledOnce();
      const stats = onResponse.mock.calls[0][0];
      expect(stats.status).toBe(503);
      expect(stats.source).toBe('upstream');
    });

    it('fires stats even if onError is slow (stats use transformed error)', async () => {
      nock('http://example.com').get('/api/data').replyWithError({ message: 'refused', code: 'ECONNREFUSED' });

      const onResponse = vi.fn();
      const callbacks = makeCallbacks();
      await runProxyPipeline(BASE_PAYLOAD, { onResponse }, callbacks, Date.now());

      expect(onResponse).toHaveBeenCalledOnce();
    });
  });

  describe('onResponse edge cases', () => {
    it('does not throw when onResponse is undefined', async () => {
      nock('http://example.com').get('/api/data').reply(200, {});
      const callbacks = makeCallbacks();

      await expect(runProxyPipeline(BASE_PAYLOAD, {}, callbacks, Date.now())).resolves.toBeUndefined();
    });

    it('swallows errors thrown by onResponse (success path)', async () => {
      nock('http://example.com').get('/api/data').reply(200, {});

      const onResponse = vi.fn().mockRejectedValue(new Error('stats callback crash'));
      const callbacks = makeCallbacks();

      await expect(runProxyPipeline(BASE_PAYLOAD, { onResponse }, callbacks, Date.now())).resolves.toBeUndefined();
    });

    it('swallows errors thrown by onResponse (short-circuit path)', async () => {
      const shortCircuit: ShortCircuitResponse = { status: 200, data: {} };
      const beforeRequest = vi.fn().mockResolvedValue(shortCircuit);
      const onResponse = vi.fn().mockRejectedValue(new Error('crash'));
      const callbacks = makeCallbacks();

      await expect(
        runProxyPipeline(BASE_PAYLOAD, { beforeRequest, onResponse }, callbacks, Date.now())
      ).resolves.toBeUndefined();
    });

    it('fires onResponse at most once (fire-once semantics)', async () => {
      nock('http://example.com').get('/api/data').reply(200, {});

      const onResponse = vi.fn().mockResolvedValue(undefined);
      const callbacks = makeCallbacks();

      await runProxyPipeline(BASE_PAYLOAD, { onResponse }, callbacks, Date.now());
      expect(onResponse).toHaveBeenCalledTimes(1);
    });
  });

  describe('no beforeRequest hook', () => {
    it('skips beforeRequest call when hook is absent', async () => {
      nock('http://example.com').get('/api/data').reply(200, {});
      const callbacks = makeCallbacks();

      await runProxyPipeline(BASE_PAYLOAD, {}, callbacks, Date.now());

      expect(callbacks.onSuccess).toHaveBeenCalledOnce();
    });
  });
});
