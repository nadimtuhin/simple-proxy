# @nadimtuhin/simple-proxy-testkit

Internal compliance test suite for [`@simple-proxy`](../../) adapters. Not published to npm.

This package provides a shared set of behavioural scenarios that every framework adapter must pass. Running compliance tests against an adapter guarantees consistent proxy semantics across Express, Fastify, Koa, and any future adapter.

## Purpose

Adapter packages import `runCompliance` and wire up their framework-specific proxy under test. The suite then exercises forwarding, error shapes, timeouts, hooks, and more — without duplicating test logic per adapter.

## How adapters use it

Implement the `ComplianceAdapter` interface and call `runCompliance` inside a Vitest test file.

```typescript
import { describe } from 'vitest';
import { runCompliance } from '../../../testkit/src/index.js';
import type { ComplianceAdapter, CreateProxyOptions, ProxyHandle } from '../../../testkit/src/index.js';

const myAdapter: ComplianceAdapter = {
  async createProxy(options: CreateProxyOptions): Promise<ProxyHandle> {
    // 1. Create a framework app/server
    // 2. Mount the adapter's proxy using options.upstreamUrl, options.timeout, etc.
    // 3. Start listening on a random port (pass 0)
    // 4. Return { url, close() }
    const port = /* … */ 0;
    return {
      url: `http://localhost:${port}`,
      close: () => new Promise((res, rej) => server.close(err => (err ? rej(err) : res()))),
    };
  },
};

runCompliance(myAdapter);
```

See [`packages/express/test/compliance/express-compliance.test.ts`](../express/test/compliance/express-compliance.test.ts) for a complete working example.

## API

### `runCompliance(adapter)`

Registers a Vitest `describe` block named `compliance suite` containing all scenarios. Call it once per adapter test file.

### `createMockUpstream()`

Starts a lightweight HTTP server used by the compliance suite as the upstream target. Exposed for use in adapter-specific tests that need a controllable upstream.

```typescript
import { createMockUpstream } from '@nadimtuhin/simple-proxy-testkit';

const upstream = await createMockUpstream();
// upstream.url   — base URL to point the proxy at
// upstream.close()       — shut down the server
// upstream.resetCounters() — reset stateful endpoints (e.g. rate-limit counter)
```

#### Mock upstream routes

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | 200 `{ status: 'ok', timestamp }` |
| POST | `/echo` | 201 `{ data: <request body> }` |
| GET | `/headers` | 200 `{ data: { receivedHeaders } }` |
| GET | `/slow?delay=N` | 200 after N ms (cancellable) |
| GET | `/error/400` | 400 error body |
| GET | `/error/500` | 500 error body |
| GET | `/error/404` | 404 error body |
| GET | `/rate-limit` | 200 for first 3 calls, then 429 |
| DELETE | `/resource*` | 204 no content |

### Types

```typescript
interface CreateProxyOptions {
  upstreamUrl: string;
  headers?: () => Record<string, string>;
  beforeRequest?: (payload: ProxyRequestPayload) => void | ShortCircuitResponse | Promise<void | ShortCircuitResponse>;
  onResponse?: (stats: ProxyStats) => void | Promise<void>;
  timeout?: number;
  proxyPath?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  route?: string;
}

interface ProxyHandle {
  url: string;
  close(): Promise<void>;
}

interface ComplianceAdapter {
  createProxy(options: CreateProxyOptions): Promise<ProxyHandle>;
}
```

## Test scenarios

| Scenario | What it checks |
|----------|----------------|
| GET proxied 200 | Basic forwarding — status and body pass through |
| POST JSON body echoed | Request body forwarded correctly |
| 4xx error body shape | Upstream 4xx returned with `error.code` in body |
| 5xx error body shape | Upstream 5xx returned with `error.code` in body |
| Timeout → UPSTREAM_TIMEOUT | Proxy returns 503 with `UPSTREAM_TIMEOUT` error code |
| Unreachable → UPSTREAM_UNREACHABLE | Proxy returns 503 with `UPSTREAM_UNREACHABLE` error code |
| `beforeRequest` short-circuit | Returning a `ShortCircuitResponse` skips upstream |
| `beforeRequest` mutates headers | Header mutations are forwarded to upstream |
| `onResponse` fires on success | Hook receives correct `ProxyStats` for 2xx responses |
| `onResponse` fires on error path | Hook receives correct `ProxyStats` for error responses |

## Running tests

Tests are run from inside each adapter package, not from this package directly.

```bash
# Run compliance tests for the Express adapter
cd packages/express
npm test

# Run compliance tests for the Fastify adapter
cd packages/fastify
npm test

# Run compliance tests for the Koa adapter
cd packages/koa
npm test
```

To typecheck the testkit itself:

```bash
cd packages/testkit
npm run typecheck
```

## See Also

- [`@simple-proxy/core`](../core) — Framework-agnostic proxy core
- [`@simple-proxy/express`](../express) — Express adapter
- [`@simple-proxy/fastify`](../fastify) — Fastify adapter
- [`@simple-proxy/koa`](../koa) — Koa adapter
