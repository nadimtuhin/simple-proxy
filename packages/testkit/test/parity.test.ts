/**
 * Cross-adapter parity integration tests.
 *
 * Spins up all three adapters (express, fastify, koa) pointed at the same
 * mock upstream and asserts that each returns the same status code, body
 * shape, and headers for every scenario. This guards against one adapter
 * silently drifting from the shared contract.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// ── express ──────────────────────────────────────────────────────────────────
import express from 'express';
import multer from 'multer';
import { createProxyController } from '@nadimtuhin/simple-proxy-express';

// ── fastify ───────────────────────────────────────────────────────────────────
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { createFastifyProxyHandler } from '@nadimtuhin/simple-proxy-fastify';

// ── koa ───────────────────────────────────────────────────────────────────────
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createKoaProxyMiddleware } from '@nadimtuhin/simple-proxy-koa';

// ── testkit ───────────────────────────────────────────────────────────────────
import { createMockUpstream } from '../src/mock-upstream.js';
import type { MockUpstream } from '../src/mock-upstream.js';
import type { CreateProxyOptions, ProxyHandle } from '../src/types.js';

// ---------------------------------------------------------------------------
// Adapter factories — each creates a real HTTP server and returns a ProxyHandle
// ---------------------------------------------------------------------------

async function createExpressProxy(options: CreateProxyOptions): Promise<ProxyHandle> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  const upload = multer({ storage: multer.memoryStorage() });
  app.use(upload.any());

  const config: any = {
    baseURL: options.upstreamUrl,
    headers: options.headers ?? (() => ({})),
    timeout: options.timeout,
  };
  if (options.beforeRequest) {
    config.beforeRequest = (payload: any, _req: any) => options.beforeRequest!(payload);
  }
  if (options.onResponse) {
    config.onResponse = (stats: any, _req: any, _res: any) => options.onResponse!(stats);
  }
  const proxy = createProxyController(config);

  app.all('*', proxy(options.proxyPath) as any);

  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://localhost:${port}`,
    close: () => new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res()))),
  };
}

async function createFastifyProxy(options: CreateProxyOptions): Promise<ProxyHandle> {
  const fastify = Fastify({ logger: false });

  const config: any = {
    baseURL: options.upstreamUrl,
    headers: options.headers ? (_req: FastifyRequest) => options.headers!() : () => ({}),
    timeout: options.timeout,
  };
  if (options.beforeRequest) {
    config.beforeRequest = (payload: any, _req: any) => options.beforeRequest!(payload);
  }
  if (options.onResponse) {
    config.onResponse = (stats: any, _req: any, _reply: any) => options.onResponse!(stats);
  }
  const handler = createFastifyProxyHandler(config, options.proxyPath);

  fastify.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    url: '/*',
    // handler typed against the adapter's bundled fastify version; cast to local fastify route type
    handler: handler as unknown as Parameters<typeof fastify.route>[0]['handler'],
  });

  await fastify.listen({ port: 0 });
  const port = (fastify.server.address() as AddressInfo).port;

  return {
    url: `http://localhost:${port}`,
    close: () => fastify.close(),
  };
}

async function createKoaProxy(options: CreateProxyOptions): Promise<ProxyHandle> {
  const app = new Koa();
  const router = new Router();

  app.use(bodyParser());

  const config: any = {
    baseURL: options.upstreamUrl,
    headers: options.headers ? (_ctx: any) => options.headers!() : () => ({}),
    timeout: options.timeout,
  };
  if (options.beforeRequest) {
    config.beforeRequest = (payload: any, _ctx: any) => options.beforeRequest!(payload);
  }
  if (options.onResponse) {
    config.onResponse = (stats: any, _ctx: any) => options.onResponse!(stats);
  }
  const middleware = createKoaProxyMiddleware(config, options.proxyPath);

  router.all('(.*)', middleware);
  app.use(router.routes());
  app.use(router.allowedMethods());

  const server = createServer(app.callback());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res()))),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AdapterName = 'express' | 'fastify' | 'koa';
type AdapterFactory = (options: CreateProxyOptions) => Promise<ProxyHandle>;

const ADAPTERS: [AdapterName, AdapterFactory][] = [
  ['express', createExpressProxy],
  ['fastify', createFastifyProxy],
  ['koa', createKoaProxy],
];

/** Run options against all three adapters and return [name, response] pairs */
async function withAllAdapters(
  options: CreateProxyOptions
): Promise<[AdapterName, Response][]> {
  const handles = await Promise.all(
    ADAPTERS.map(async ([name, factory]) => {
      const handle = await factory(options);
      return { name, handle };
    })
  );

  const results = await Promise.all(
    handles.map(async ({ name, handle }) => {
      const method = options.method ?? 'GET';
      const route = options.route ?? '/health';
      const fetchOptions: RequestInit = { method };
      const res = await fetch(`${handle.url}${route}`, fetchOptions);
      return { name, res, handle };
    })
  );

  await Promise.all(results.map(({ handle }) => handle.close()));

  return results.map(({ name, res }) => [name as AdapterName, res]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cross-adapter parity', () => {
  let mockUpstream: MockUpstream;

  beforeAll(async () => {
    mockUpstream = await createMockUpstream();
  });

  afterAll(async () => {
    await mockUpstream.close();
  });

  // ── Happy-path scenarios ─────────────────────────────────────────────────

  it('GET /health → 200 { status: "ok" } from all adapters', async () => {
    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({ upstreamUrl: mockUpstream.url, method: 'GET', route: '/health' })
      )
    );

    const results = await Promise.all(
      handles.map(async (handle, i) => {
        const res = await fetch(`${handle.url}/health`);
        const body = (await res.json()) as any;
        await handle.close();
        return { adapter: ADAPTERS[i]![0]!, status: res.status, body } as const;
      })
    );

    for (const result of results) {
      expect(result.status, `${result.adapter} status`).toBe(200);
      expect(result.body.status, `${result.adapter} body.status`).toBe('ok');
    }
  });

  it('POST /echo → 201 with echoed body from all adapters', async () => {
    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({ upstreamUrl: mockUpstream.url, method: 'POST', route: '/echo' })
      )
    );

    const results = await Promise.all(
      handles.map(async (handle, i) => {
        const res = await fetch(`${handle.url}/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'parity-test' }),
        });
        const body = (await res.json()) as any;
        await handle.close();
        return { adapter: ADAPTERS[i]![0]!, status: res.status, body } as const;
      })
    );

    for (const { adapter, status, body } of results) {
      expect(status, `${adapter} status`).toBe(201);
      expect(body.data, `${adapter} body.data`).toMatchObject({ name: 'parity-test' });
    }
  });

  // ── Error status codes ───────────────────────────────────────────────────

  it('GET /error/400 → 400 with UNKNOWN_ERROR code from all adapters', async () => {
    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({ upstreamUrl: mockUpstream.url, method: 'GET', route: '/error/400' })
      )
    );

    const results = await Promise.all(
      handles.map(async (handle, i) => {
        const res = await fetch(`${handle.url}/error/400`);
        const body = (await res.json()) as any;
        await handle.close();
        return { adapter: ADAPTERS[i]![0]!, status: res.status, body } as const;
      })
    );

    for (const { adapter, status, body } of results) {
      expect(status, `${adapter} status`).toBe(400);
      expect(body.error?.code, `${adapter} error.code`).toBe('UNKNOWN_ERROR');
    }
  });

  it('GET /error/500 → 500 with UNKNOWN_ERROR code from all adapters', async () => {
    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({ upstreamUrl: mockUpstream.url, method: 'GET', route: '/error/500' })
      )
    );

    const results = await Promise.all(
      handles.map(async (handle, i) => {
        const res = await fetch(`${handle.url}/error/500`);
        const body = (await res.json()) as any;
        await handle.close();
        return { adapter: ADAPTERS[i]![0]!, status: res.status, body } as const;
      })
    );

    for (const { adapter, status, body } of results) {
      expect(status, `${adapter} status`).toBe(500);
      expect(body.error?.code, `${adapter} error.code`).toBe('UNKNOWN_ERROR');
    }
  });

  // ── Timeout / unreachable ────────────────────────────────────────────────

  it('GET /slow with timeout=500 → 503 UPSTREAM_TIMEOUT from all adapters', async () => {
    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({
          upstreamUrl: mockUpstream.url,
          method: 'GET',
          route: '/slow',
          timeout: 500,
        })
      )
    );

    const results = await Promise.all(
      handles.map(async (handle, i) => {
        const res = await fetch(`${handle.url}/slow?delay=2000`);
        const body = (await res.json()) as any;
        await handle.close();
        return { adapter: ADAPTERS[i]![0]!, status: res.status, body } as const;
      })
    );

    for (const { adapter, status, body } of results) {
      expect(status, `${adapter} status`).toBe(503);
      expect(body.error?.code, `${adapter} error.code`).toBe('UPSTREAM_TIMEOUT');
    }
  }, 10000);

  it('Unreachable upstream → 503 UPSTREAM_UNREACHABLE from all adapters', async () => {
    // Pick a port that nothing listens on
    const port = await new Promise<number>(resolve => {
      const s = createServer();
      s.listen(0, () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });

    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({
          upstreamUrl: `http://localhost:${port}`,
          method: 'GET',
          route: '/health',
          timeout: 500,
        })
      )
    );

    const results = await Promise.all(
      handles.map(async (handle, i) => {
        const res = await fetch(`${handle.url}/health`);
        const body = (await res.json()) as any;
        await handle.close();
        return { adapter: ADAPTERS[i]![0]!, status: res.status, body } as const;
      })
    );

    for (const { adapter, status, body } of results) {
      expect(status, `${adapter} status`).toBe(503);
      expect(body.error?.code, `${adapter} error.code`).toBe('UPSTREAM_UNREACHABLE');
    }
  });

  // ── Header forwarding ────────────────────────────────────────────────────

  it('Header injection via beforeRequest reaches upstream in all adapters', async () => {
    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({
          upstreamUrl: mockUpstream.url,
          method: 'GET',
          route: '/headers',
          beforeRequest: payload => {
            payload.headers['x-parity'] = 'injected';
          },
        })
      )
    );

    const results = await Promise.all(
      handles.map(async (handle, i) => {
        const res = await fetch(`${handle.url}/headers`);
        const body = (await res.json()) as any;
        await handle.close();
        return { adapter: ADAPTERS[i]![0]!, status: res.status, body } as const;
      })
    );

    for (const { adapter, status, body } of results) {
      expect(status, `${adapter} status`).toBe(200);
      expect(
        body.data?.receivedHeaders?.['x-parity'],
        `${adapter} injected header`
      ).toBe('injected');
    }
  });

  // ── Short-circuit ────────────────────────────────────────────────────────

  it('beforeRequest short-circuit returns 202 with custom headers from all adapters', async () => {
    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({
          upstreamUrl: mockUpstream.url,
          method: 'GET',
          route: '/health',
          beforeRequest: () => ({
            status: 202,
            data: { cached: true },
            headers: { 'x-source': 'cache' },
          }),
        })
      )
    );

    const results = await Promise.all(
      handles.map(async (handle, i) => {
        const res = await fetch(`${handle.url}/health`);
        const body = (await res.json()) as any;
        const xSource = res.headers.get('x-source');
        await handle.close();
        return { adapter: ADAPTERS[i]![0]!, status: res.status, body, xSource };
      })
    );

    for (const result of results) {
      const { adapter, status, body, xSource } = result;
      expect(status, `${adapter} status`).toBe(202);
      expect(body, `${adapter} body`).toMatchObject({ cached: true });
      expect(xSource, `${adapter} x-source header`).toBe('cache');
    }
  });

  // ── onResponse callback ──────────────────────────────────────────────────

  it('onResponse fires with correct stats for upstream success in all adapters', async () => {
    const callbacks = ADAPTERS.map(() => vi.fn());

    const handles = await Promise.all(
      ADAPTERS.map(([, factory], i) =>
        factory({
          upstreamUrl: mockUpstream.url,
          method: 'GET',
          route: '/health',
          onResponse: callbacks[i]!,
        })
      )
    );

    await Promise.all(
      handles.map(async (handle, i) => {
        await fetch(`${handle.url}/health`);
        await handle.close();
        expect(callbacks[i]!, `${ADAPTERS[i]![0]} onResponse called`).toHaveBeenCalledTimes(1);
        expect(callbacks[i]!.mock.calls[0]![0]!, `${ADAPTERS[i]![0]} stats`).toMatchObject({
          method: 'GET',
          status: 200,
          source: 'upstream',
          durationMs: expect.any(Number),
        });
      })
    );
  });

  // ── Body shape parity (error.code, error.message, error.details) ──────────

  it('4xx error body shape is identical across all adapters', async () => {
    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({ upstreamUrl: mockUpstream.url, method: 'GET', route: '/error/400' })
      )
    );

    const bodies = await Promise.all(
      handles.map(async handle => {
        const res = await fetch(`${handle.url}/error/400`);
        const body = (await res.json()) as any;
        await handle.close();
        return body;
      })
    );

    // All adapters should produce the same error body shape
    const [expressBody, fastifyBody, koaBody] = bodies;
    expect(expressBody.error.code, 'express vs fastify error.code').toBe(fastifyBody.error.code);
    expect(expressBody.error.code, 'express vs koa error.code').toBe(koaBody.error.code);
    expect(expressBody.error.message, 'express vs fastify error.message').toBe(
      fastifyBody.error.message
    );
    expect(expressBody.error.message, 'express vs koa error.message').toBe(koaBody.error.message);
  });

  it('5xx error body shape is identical across all adapters', async () => {
    const handles = await Promise.all(
      ADAPTERS.map(([, factory]) =>
        factory({ upstreamUrl: mockUpstream.url, method: 'GET', route: '/error/500' })
      )
    );

    const bodies = await Promise.all(
      handles.map(async handle => {
        const res = await fetch(`${handle.url}/error/500`);
        const body = (await res.json()) as any;
        await handle.close();
        return body;
      })
    );

    const [expressBody, fastifyBody, koaBody] = bodies;
    expect(expressBody.error.code).toBe(fastifyBody.error.code);
    expect(expressBody.error.code).toBe(koaBody.error.code);
    expect(expressBody.error.message).toBe(fastifyBody.error.message);
    expect(expressBody.error.message).toBe(koaBody.error.message);
  });
});
