# @simple-proxy/koa

Koa adapter for [`@simple-proxy/core`](../core). Forward requests to an upstream service from any Koa route.

## Install

```bash
npm install @simple-proxy/koa
```

## Usage

```typescript
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createKoaProxyMiddleware } from '@simple-proxy/koa';

const app = new Koa();
const router = new Router();

app.use(bodyParser());

const proxy = createKoaProxyMiddleware({
  baseURL: 'https://api.example.com',
  headers: (ctx) => ({
    Authorization: ctx.get('authorization'),
  }),
});

router.all('(.*)', proxy);
app.use(router.routes());
app.use(router.allowedMethods());

app.listen(3000);
```

## Configuration

```typescript
interface KoaProxyConfig {
  baseURL: string;

  // Forward headers from the incoming request to the upstream
  headers?: (ctx: Context) => Record<string, string>;

  // Request timeout in ms (default: 30000)
  timeout?: number;

  // Hook called before each upstream request; return ShortCircuitResponse to skip upstream
  beforeRequest?: (payload: ProxyRequestPayload, ctx: Context) => void | ShortCircuitResponse | Promise<void | ShortCircuitResponse>;

  // Called after each request (upstream or short-circuit) with stats
  onResponse?: (stats: ProxyStats, ctx: Context) => void | Promise<void>;

  // Custom error handler
  errorHandler?: (error: ProxyError, ctx: Context) => void | Promise<void>;
}
```

## Multipart / File Uploads

Mount `@koa/multer` before the proxy middleware. Files will be forwarded as `multipart/form-data`:

```typescript
import multer from '@koa/multer';

const upload = multer({ storage: multer.memoryStorage() });
router.post('/upload/(.*)', upload.any(), proxy);
```

## Short-circuit

Return a `ShortCircuitResponse` from `beforeRequest` to respond without hitting upstream:

```typescript
const proxy = createKoaProxyMiddleware({
  baseURL: 'https://api.example.com',
  beforeRequest: async (payload) => {
    if (payload.url.includes('/blocked')) {
      return { status: 403, data: { error: 'Forbidden' } };
    }
  },
});
```

## See Also

- [`@simple-proxy/express`](../express) — Express adapter
- [`@simple-proxy/fastify`](../fastify) — Fastify adapter
- [`@simple-proxy/core`](../core) — Framework-agnostic core
