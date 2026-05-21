import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runProxyPipeline } from '../src/pipeline.js';
import type { PipelineHooks, PipelineCallbacks } from '../src/pipeline.js';
import type { ProxyRequestPayload, ProxyResponse, ShortCircuitResponse, ProxyError } from '../src/types.js';

type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
const routes = new Map<string, RouteHandler>();
let server: Server;
let base: string;
let closedPort: number;

beforeAll(async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  closedPort = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

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
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => routes.clear());

function route(method: string, path: string, status: number, data: unknown, headers: Record<string, string> = {}) {
  routes.set(`${method} ${path}`, (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
  });
}

function makePayload(path = '/api/data'): ProxyRequestPayload {
  return { url: `${base}${path}`, method: 'GET', headers: {}, timeout: 5000 };
}

function makeCallbacks(overrides?: Partial<PipelineCallbacks>): PipelineCallbacks {
  return {
    onShortCircuit: vi.fn().mockResolvedValue(undefined),
    onSuccess: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn().mockImplementation((err: ProxyError) => Promise.resolve(err)),
    ...overrides,
  };
}

describe('runProxyPipeline', () => {
  describe('happy path — upstream request', () => {
    it('calls axiosProxyRequest and invokes onSuccess', async () => {
      const responseData = { id: 1 };
      route('GET', '/api/data', 200, responseData);

      const callbacks = makeCallbacks();
      const hooks: PipelineHooks = {};

      await runProxyPipeline(makePayload(), hooks, callbacks, Date.now());

      expect(callbacks.onSuccess).toHaveBeenCalledOnce();
      const successArg = (callbacks.onSuccess as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProxyResponse;
      expect(successArg.status).toBe(200);
      expect(successArg.data).toEqual(responseData);
    });

    it('does not call onShortCircuit or onError on success', async () => {
      route('GET', '/api/data', 200, {});

      const callbacks = makeCallbacks();
      await runProxyPipeline(makePayload(), {}, callbacks, Date.now());

      expect(callbacks.onShortCircuit).not.toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('fires onResponse stats with source=upstream after success', async () => {
      route('GET', '/api/data', 200, { x: 1 });

      const onResponse = vi.fn();
      const callbacks = makeCallbacks();
      const startedAt = Date.now();
      const payload = makePayload();

      await runProxyPipeline(payload, { onResponse }, callbacks, startedAt);

      expect(onResponse).toHaveBeenCalledOnce();
      const stats = onResponse.mock.calls[0][0];
      expect(stats.source).toBe('upstream');
      expect(stats.url).toBe(payload.url);
      expect(stats.method).toBe(payload.method);
      expect(stats.status).toBe(200);
      expect(typeof stats.durationMs).toBe('number');
    });

    it('calls beforeRequest hook when provided and it returns void', async () => {
      route('GET', '/api/data', 200, { ok: true });

      const beforeRequest = vi.fn().mockResolvedValue(undefined);
      const callbacks = makeCallbacks();

      await runProxyPipeline(makePayload(), { beforeRequest }, callbacks, Date.now());

      expect(beforeRequest).toHaveBeenCalledOnce();
      expect(callbacks.onSuccess).toHaveBeenCalledOnce();
    });
  });

  describe('short-circuit path', () => {
    it('calls onShortCircuit and skips axios when beforeRequest returns ShortCircuitResponse', async () => {
      const shortCircuit: ShortCircuitResponse = { status: 200, data: { cached: true } };
      const beforeRequest = vi.fn().mockResolvedValue(shortCircuit);
      const callbacks = makeCallbacks();

      await runProxyPipeline(makePayload(), { beforeRequest }, callbacks, Date.now());

      expect(callbacks.onShortCircuit).toHaveBeenCalledWith(shortCircuit);
      expect(callbacks.onSuccess).not.toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('fires onResponse stats with source=short-circuit', async () => {
      const shortCircuit: ShortCircuitResponse = { status: 403, data: { blocked: true } };
      const beforeRequest = vi.fn().mockResolvedValue(shortCircuit);
      const onResponse = vi.fn();
      const callbacks = makeCallbacks();

      await runProxyPipeline(makePayload(), { beforeRequest, onResponse }, callbacks, Date.now());

      expect(onResponse).toHaveBeenCalledOnce();
      const stats = onResponse.mock.calls[0][0];
      expect(stats.source).toBe('short-circuit');
      expect(stats.status).toBe(403);
    });
  });

  describe('error path', () => {
    it('calls onError when axios throws', async () => {
      route('GET', '/api/data', 500, { error: 'boom' });

      const callbacks = makeCallbacks();
      await runProxyPipeline(makePayload(), {}, callbacks, Date.now());

      expect(callbacks.onError).toHaveBeenCalledOnce();
      expect(callbacks.onSuccess).not.toHaveBeenCalled();
    });

    it('fires stats using error returned from onError callback', async () => {
      route('GET', '/api/data', 500, { error: 'boom' });

      const transformedError: ProxyError = Object.assign(new Error('transformed'), { status: 503, code: 'UPSTREAM_TIMEOUT' });
      const onResponse = vi.fn();
      const callbacks = makeCallbacks({
        onError: vi.fn().mockResolvedValue(transformedError),
      });

      await runProxyPipeline(makePayload(), { onResponse }, callbacks, Date.now());

      expect(onResponse).toHaveBeenCalledOnce();
      const stats = onResponse.mock.calls[0][0];
      expect(stats.status).toBe(503);
      expect(stats.source).toBe('upstream');
    });

    it('fires stats even if onError is slow (stats use transformed error)', async () => {
      // Unreachable upstream → real network error.
      const onResponse = vi.fn();
      const callbacks = makeCallbacks();
      const payload: ProxyRequestPayload = { url: `http://127.0.0.1:${closedPort}/api/data`, method: 'GET', headers: {}, timeout: 5000 };
      await runProxyPipeline(payload, { onResponse }, callbacks, Date.now());

      expect(onResponse).toHaveBeenCalledOnce();
    });
  });

  describe('onResponse edge cases', () => {
    it('does not throw when onResponse is undefined', async () => {
      route('GET', '/api/data', 200, {});
      const callbacks = makeCallbacks();

      await expect(runProxyPipeline(makePayload(), {}, callbacks, Date.now())).resolves.toBeUndefined();
    });

    it('swallows errors thrown by onResponse (success path)', async () => {
      route('GET', '/api/data', 200, {});

      const onResponse = vi.fn().mockRejectedValue(new Error('stats callback crash'));
      const callbacks = makeCallbacks();

      await expect(runProxyPipeline(makePayload(), { onResponse }, callbacks, Date.now())).resolves.toBeUndefined();
    });

    it('swallows errors thrown by onResponse (short-circuit path)', async () => {
      const shortCircuit: ShortCircuitResponse = { status: 200, data: {} };
      const beforeRequest = vi.fn().mockResolvedValue(shortCircuit);
      const onResponse = vi.fn().mockRejectedValue(new Error('crash'));
      const callbacks = makeCallbacks();

      await expect(
        runProxyPipeline(makePayload(), { beforeRequest, onResponse }, callbacks, Date.now())
      ).resolves.toBeUndefined();
    });

    it('fires onResponse at most once (fire-once semantics)', async () => {
      route('GET', '/api/data', 200, {});

      const onResponse = vi.fn().mockResolvedValue(undefined);
      const callbacks = makeCallbacks();

      await runProxyPipeline(makePayload(), { onResponse }, callbacks, Date.now());
      expect(onResponse).toHaveBeenCalledTimes(1);
    });
  });

  describe('no beforeRequest hook', () => {
    it('skips beforeRequest call when hook is absent', async () => {
      route('GET', '/api/data', 200, {});
      const callbacks = makeCallbacks();

      await runProxyPipeline(makePayload(), {}, callbacks, Date.now());

      expect(callbacks.onSuccess).toHaveBeenCalledOnce();
    });
  });
});
