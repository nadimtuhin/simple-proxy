# simple-proxy

Framework-agnostic HTTP proxy utilities for Node.js. Built on axios.

## Packages

| Package | Description |
|---------|-------------|
| [`@simple-proxy/core`](./packages/core) | Framework-agnostic proxy core |
| [`@simple-proxy/express`](./packages/express) | Express adapter |
| [`@simple-proxy/fastify`](./packages/fastify) | Fastify adapter |
| [`@simple-proxy/koa`](./packages/koa) | Koa adapter |

## Quick Start

Pick the package for your framework:

```bash
# Express
npm install @simple-proxy/express

# Fastify
npm install @simple-proxy/fastify

# Koa
npm install @simple-proxy/koa
```

## Development

```bash
pnpm install
pnpm build        # build all packages
pnpm test         # test all packages
pnpm typecheck    # typecheck all packages
```

## License

MIT
