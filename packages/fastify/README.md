# @simple-proxy/fastify

Fastify adapter for [`@simple-proxy/core`](../core). Forward requests to an upstream service from any Fastify route.

## Install

```bash
npm install @simple-proxy/fastify
```

## Usage

```typescript
import Fastify from 'fastify';
import { createFastifyProxyHandler } from '@simple-proxy/fastify';

const fastify = Fastify();

const handler = createFastifyProxyHandler({
  baseURL: 'https://api.example.com',
  headers: (req) => ({
    Authorization: req.headers.authorization ?? '',
  }),
});

fastify.route({
  method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  url: '/*',
  handler,
});

fastify.listen({ port: 3000 });
```

## Configuration

```typescript
interface FastifyProxyConfig {
  baseURL: string;

  // Forward headers from the incoming request to the upstream
  headers?: (req: FastifyRequest) => Record<string, string>;

  // Request timeout in ms (default: 30000)
  timeout?: number;

  // Hook called before each upstream request; return ShortCircuitResponse to skip upstream
  beforeRequest?: (payload: ProxyRequestPayload, req: FastifyRequest) => void | ShortCircuitResponse | Promise<void | ShortCircuitResponse>;

  // Called after each request (upstream or short-circuit) with stats
  onResponse?: (stats: ProxyStats, req: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

  // Custom error handler
  errorHandler?: (error: ProxyError, req: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
}
```

## Multipart / File Uploads

Register `@fastify/multipart` before the route. Files are consumed asynchronously and forwarded as `multipart/form-data`:

```typescript
import multipart from '@fastify/multipart';

await fastify.register(multipart);
fastify.route({ method: ['POST'], url: '/upload/*', handler });
```

## Short-circuit

Return a `ShortCircuitResponse` from `beforeRequest` to respond without hitting upstream:

```typescript
const handler = createFastifyProxyHandler({
  baseURL: 'https://api.example.com',
  beforeRequest: async (payload) => {
    if (payload.url.includes('/blocked')) {
      return { status: 403, data: { error: 'Forbidden' } };
    }
  },
});
```

## Path Routing

Pass a `proxyPath` to rewrite the incoming URL path:

```typescript
// Incoming: /v1/users/123
// Forwarded: /api/users/123
const handler = createFastifyProxyHandler({ baseURL: 'https://api.example.com' }, '/api/:rest*');
```

## See Also

- [`@simple-proxy/express`](../express) — Express adapter
- [`@simple-proxy/koa`](../koa) — Koa adapter
- [`@simple-proxy/core`](../core) — Framework-agnostic core
