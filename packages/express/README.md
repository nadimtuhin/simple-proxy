# @simple-proxy/express

Express adapter for [`@simple-proxy/core`](../core). Forward requests to an upstream service from any Express route.

## Install

```bash
npm install @simple-proxy/express
```

## Usage

```typescript
import express from 'express';
import { createProxyController } from '@simple-proxy/express';

const app = express();

const proxy = createProxyController({
  baseURL: 'https://api.example.com',
  headers: (req) => ({
    Authorization: req.headers.authorization ?? '',
  }),
});

app.use('/api', proxy);
app.listen(3000);
```

## Configuration

```typescript
interface ExpressProxyConfig {
  baseURL: string;

  // Forward headers from the incoming request to the upstream
  headers?: (req: Request) => Record<string, string>;

  // Request timeout in ms (default: 30000)
  timeout?: number;

  // Hook called before each upstream request; return ShortCircuitResponse to skip upstream
  beforeRequest?: (payload: ProxyRequestPayload, req: Request) => void | ShortCircuitResponse | Promise<void | ShortCircuitResponse>;

  // Called after each request (upstream or short-circuit) with stats
  onResponse?: (stats: ProxyStats, req: Request, res: Response) => void | Promise<void>;

  // Custom error handler
  errorHandler?: (error: ProxyError, req: Request, res: Response) => void | Promise<void>;
}
```

## Multipart / File Uploads

Mount `multer` before the proxy middleware. Files will be forwarded as `multipart/form-data`:

```typescript
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });
app.use('/upload', upload.any(), proxy);
```

## Short-circuit

Return a `ShortCircuitResponse` from `beforeRequest` to respond without hitting upstream:

```typescript
const proxy = createProxyController({
  baseURL: 'https://api.example.com',
  beforeRequest: async (payload) => {
    if (payload.url.includes('/blocked')) {
      return { status: 403, data: { error: 'Forbidden' } };
    }
  },
});
```

## See Also

- [`@simple-proxy/fastify`](../fastify) — Fastify adapter
- [`@simple-proxy/koa`](../koa) — Koa adapter
- [`@simple-proxy/core`](../core) — Framework-agnostic core
