# simple-proxy

Framework-agnostic HTTP proxy utilities for Node.js. Built on axios.

[![CI](https://github.com/nadimtuhin/simple-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/nadimtuhin/simple-proxy/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@simple-proxy/core)](https://www.npmjs.com/package/@simple-proxy/core)
[![npm](https://img.shields.io/npm/v/@simple-proxy/express)](https://www.npmjs.com/package/@simple-proxy/express)
[![npm](https://img.shields.io/npm/v/@simple-proxy/fastify)](https://www.npmjs.com/package/@simple-proxy/fastify)
[![npm](https://img.shields.io/npm/v/@simple-proxy/koa)](https://www.npmjs.com/package/@simple-proxy/koa)

## Packages

| Package | Description |
|---------|-------------|
| [`@simple-proxy/core`](./packages/core) | Framework-agnostic proxy core |
| [`@simple-proxy/express`](./packages/express) | Express adapter |
| [`@simple-proxy/fastify`](./packages/fastify) | Fastify adapter |
| [`@simple-proxy/koa`](./packages/koa) | Koa adapter |
| [`express-simple-proxy`](./packages/express-simple-proxy) | **Deprecated** — migrate to `@simple-proxy/express` |
| [`@nadimtuhin/simple-proxy-testkit`](./packages/testkit) | Shared compliance suite for adapter authors (internal, not published to npm) |

## Quick Start

### Express

```bash
npm install @simple-proxy/express
```

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

### Fastify

```bash
npm install @simple-proxy/fastify
```

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

### Koa

```bash
npm install @simple-proxy/koa
```

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

## Adapter Feature Matrix

| Feature | Express | Fastify | Koa |
|---------|---------|---------|-----|
| `baseURL` | yes | yes | yes |
| `headers` hook | yes | yes | yes |
| `timeout` | yes | yes | yes |
| `beforeRequest` hook | yes | yes | yes |
| `onResponse` hook | yes | yes | yes |
| `errorHandler` | yes | yes | yes |
| Multipart / file uploads | `multer` | `@fastify/multipart` | `@koa/multer` |
| Short-circuit response | yes | yes | yes |

## Examples

Runnable example apps are in the [`examples/`](./examples) directory.

| Example | Adapter | Path |
|---------|---------|------|
| Fastify proxy | `@simple-proxy/fastify` | [`examples/fastify-example/`](./examples/fastify-example) |
| Koa proxy | `@simple-proxy/koa` | [`examples/koa-example/`](./examples/koa-example) |

Each example proxies `https://jsonplaceholder.typicode.com` and starts with a single `node` command:

```bash
pnpm install
node examples/fastify-example/server.js  # http://localhost:3000
node examples/koa-example/server.js      # http://localhost:3001
```

## Development

```bash
pnpm install
pnpm build        # build all packages
pnpm test         # test all packages
pnpm typecheck    # typecheck all packages
```

## Release Process

This monorepo uses [Changesets](https://github.com/changesets/changesets) with pnpm.

**Publishing flow:**

1. After merging changes, add a changeset describing what changed:
   ```bash
   pnpm changeset
   ```
2. Commit the generated `.changeset/*.md` file and push to main.
3. CI automatically opens a "Version Packages" PR that bumps versions and updates changelogs.
4. Merge that PR — CI then runs build → test → typecheck → `changeset publish` to npm.

**Manual publish (maintainers only):**
```bash
pnpm release   # builds all packages then runs changeset publish
```

`@nadimtuhin/simple-proxy-testkit` is private (`"private": true`) and excluded from all publishes via `.changeset/config.json`.

## License

MIT
