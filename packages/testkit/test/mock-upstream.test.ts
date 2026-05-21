import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMockUpstream } from '../src/mock-upstream.js';
import type { MockUpstream } from '../src/mock-upstream.js';

describe('createMockUpstream', () => {
  let upstream: MockUpstream;

  beforeAll(async () => {
    upstream = await createMockUpstream();
  });

  afterAll(async () => {
    await upstream.close();
  });

  beforeEach(() => {
    upstream.resetCounters();
  });

  describe('GET /rate-limit', () => {
    it('returns 200 for first 3 requests then 429', async () => {
      const results: Array<{ status: number; retryAfter?: string }> = [];

      for (let i = 0; i < 4; i++) {
        const res = await fetch(`${upstream.url}/rate-limit`);
        results.push({
          status: res.status,
          retryAfter: res.headers.get('retry-after') ?? undefined,
        });
      }

      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);
      expect(results[2].status).toBe(200);
      expect(results[3].status).toBe(429);
      expect(results[3].retryAfter).toBe('60');
    });
  });

  describe('DELETE /resource', () => {
    it('returns 204 with empty body for DELETE /resource/:id', async () => {
      const res = await fetch(`${upstream.url}/resource/123`, { method: 'DELETE' });
      expect(res.status).toBe(204);
      const text = await res.text();
      expect(text).toBe('');
    });
  });

  describe('GET /slow', () => {
    it('returns 200 after delay when request is not aborted', async () => {
      const res = await fetch(`${upstream.url}/slow?delay=50`);
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });
});
