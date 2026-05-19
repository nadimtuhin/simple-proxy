# @simple-proxy/core

Framework-agnostic HTTP proxy core for Node.js. Handles request forwarding, error classification, header filtering, and multipart uploads via axios.

## Install

```bash
npm install @simple-proxy/core
```

## Usage

```typescript
import { axiosProxyRequest } from '@simple-proxy/core';

const response = await axiosProxyRequest({
  url: 'https://api.example.com/users',
  method: 'GET',
  headers: { Authorization: 'Bearer token' },
  timeout: 5000,
});
```

## API

### `axiosProxyRequest(payload)`

Forwards an HTTP request to an upstream service.

```typescript
interface ProxyRequestPayload {
  url: string;
  method: string;
  headers: Record<string, string>;
  timeout: number;
  data?: unknown;
}
```

Returns `Promise<ProxyResponse>` with `{ status, data, headers }`.

### `buildQueryString(query)`

Serializes a query parameter object to a URL query string (with leading `?`).

### `urlJoin(base, path, qs?)`

Joins a base URL, path, and optional query string safely.

### `resolveProxyPath(proxyPath, requestPath, params)`

Resolves a proxy path template against the incoming request path and route params.

### `createFormDataPayload({ body, files })`

Creates a `form-data` payload from body fields and file buffers. Returns a `FormData` instance ready to stream.

### `filterProxyResponseHeaders(headers)`

Strips hop-by-hop headers (e.g. `transfer-encoding`, `connection`) from upstream response headers before forwarding to the client.

### `buildErrorResponseBody(error)`

Converts a proxy error into a structured `{ error, message }` response body.

### `isShortCircuitResponse(value)`

Type guard for `ShortCircuitResponse` — used in `beforeRequest` hooks to short-circuit proxying.

## Framework Adapters

This package is the core. Use a framework adapter instead of calling it directly:

- [`@simple-proxy/express`](../express)
- [`@simple-proxy/fastify`](../fastify)
- [`@simple-proxy/koa`](../koa)
