import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import { createMockUpstream, type MockUpstream } from './mock-upstream.js';
import type { ComplianceAdapter } from './types.js';

async function getFreePort(): Promise<number> {
  return new Promise(resolve => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export function runCompliance(adapter: ComplianceAdapter): void {
  describe('compliance suite', () => {
    let mockUpstream: MockUpstream;

    beforeAll(async () => {
      mockUpstream = await createMockUpstream();
    });

    afterAll(async () => {
      await mockUpstream.close();
    });

    beforeEach(() => {
      mockUpstream.resetCounters();
    });

    it('GET proxied 200', async () => {
      const handle = await adapter.createProxy({
        upstreamUrl: mockUpstream.url,
        method: 'GET',
        route: '/health',
      });
      try {
        const res = await fetch(`${handle.url}/health`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.status).toBe('ok');
      } finally {
        await handle.close();
      }
    });

    it('POST JSON body echoed', async () => {
      const handle = await adapter.createProxy({
        upstreamUrl: mockUpstream.url,
        method: 'POST',
        route: '/echo',
      });
      try {
        const res = await fetch(`${handle.url}/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test' }),
        });
        expect(res.status).toBe(201);
        const body = await res.json() as any;
        expect(body.data).toMatchObject({ name: 'test' });
      } finally {
        await handle.close();
      }
    });

    it('4xx error body shape', async () => {
      const handle = await adapter.createProxy({
        upstreamUrl: mockUpstream.url,
        method: 'GET',
        route: '/error/400',
      });
      try {
        const res = await fetch(`${handle.url}/error/400`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error.code).toBe('UNKNOWN_ERROR');
      } finally {
        await handle.close();
      }
    });

    it('5xx error body shape', async () => {
      const handle = await adapter.createProxy({
        upstreamUrl: mockUpstream.url,
        method: 'GET',
        route: '/error/500',
      });
      try {
        const res = await fetch(`${handle.url}/error/500`);
        expect(res.status).toBe(500);
        const body = await res.json() as any;
        expect(body.error.code).toBe('UNKNOWN_ERROR');
      } finally {
        await handle.close();
      }
    });

    it('Timeout → UPSTREAM_TIMEOUT', async () => {
      const handle = await adapter.createProxy({
        upstreamUrl: mockUpstream.url,
        method: 'GET',
        route: '/slow',
        timeout: 500,
      });
      try {
        const res = await fetch(`${handle.url}/slow?delay=2000`);
        expect(res.status).toBe(503);
        const body = await res.json() as any;
        expect(body.error.code).toBe('UPSTREAM_TIMEOUT');
      } finally {
        await handle.close();
      }
    });

    it('Unreachable → UPSTREAM_UNREACHABLE', async () => {
      const port = await getFreePort();
      const handle = await adapter.createProxy({
        upstreamUrl: `http://localhost:${port}`,
        method: 'GET',
        route: '/health',
        timeout: 500,
      });
      try {
        const res = await fetch(`${handle.url}/health`);
        expect(res.status).toBe(503);
        const body = await res.json() as any;
        expect(body.error.code).toBe('UPSTREAM_UNREACHABLE');
      } finally {
        await handle.close();
      }
    });

    it('beforeRequest short-circuit', async () => {
      const handle = await adapter.createProxy({
        upstreamUrl: mockUpstream.url,
        method: 'GET',
        route: '/health',
        beforeRequest: () => ({
          status: 202,
          data: { cached: true },
          headers: { 'x-source': 'cache' },
        }),
      });
      try {
        const res = await fetch(`${handle.url}/health`);
        expect(res.status).toBe(202);
        const body = await res.json() as any;
        expect(body).toMatchObject({ cached: true });
        expect(res.headers.get('x-source')).toBe('cache');
      } finally {
        await handle.close();
      }
    });

    it('beforeRequest mutates headers', async () => {
      const handle = await adapter.createProxy({
        upstreamUrl: mockUpstream.url,
        method: 'GET',
        route: '/headers',
        beforeRequest: (payload) => {
          payload.headers['x-injected'] = 'testkit';
        },
      });
      try {
        const res = await fetch(`${handle.url}/headers`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.data.receivedHeaders['x-injected']).toBe('testkit');
      } finally {
        await handle.close();
      }
    });

    it('onResponse fires upstream success', async () => {
      const onResp = vi.fn();
      const handle = await adapter.createProxy({
        upstreamUrl: mockUpstream.url,
        method: 'GET',
        route: '/health',
        onResponse: onResp,
      });
      try {
        const res = await fetch(`${handle.url}/health`);
        expect(res.status).toBe(200);
        expect(onResp).toHaveBeenCalledTimes(1);
        expect(onResp).toHaveBeenCalledWith(expect.objectContaining({
          method: 'GET',
          status: 200,
          source: 'upstream',
          url: expect.any(String),
          durationMs: expect.any(Number),
        }));
      } finally {
        await handle.close();
      }
    });

    it('onResponse fires on error path', async () => {
      const onResp = vi.fn();
      const handle = await adapter.createProxy({
        upstreamUrl: mockUpstream.url,
        method: 'GET',
        route: '/error/404',
        onResponse: onResp,
      });
      try {
        const res = await fetch(`${handle.url}/error/404`);
        expect(res.status).toBe(404);
        expect(onResp).toHaveBeenCalledTimes(1);
        expect(onResp).toHaveBeenCalledWith(expect.objectContaining({
          status: 404,
          source: 'upstream',
        }));
      } finally {
        await handle.close();
      }
    });
  });
}
