# Contributing

## Prerequisites

- Node.js ≥ 18
- pnpm ≥ 9 (`npm install -g pnpm`)

## Setup

```bash
git clone https://github.com/nadimtuhin/simple-proxy.git
cd simple-proxy
pnpm install
pnpm build
pnpm test
```

## Dev workflow

1. Work on a feature branch off `main`.
2. Write tests first — all packages use [Vitest](https://vitest.dev/).
3. Run the full suite before opening a PR:
   ```bash
   pnpm test
   pnpm typecheck
   ```
4. Add a changeset describing what changed (skip for docs/chore):
   ```bash
   pnpm changeset
   ```
   Commit the generated `.changeset/*.md` file with your changes.
5. Open a PR. CI runs build → test → typecheck.

## Adding a new adapter

A new adapter is a package under `packages/` that wraps `@simple-proxy/core`.

### Steps

1. Create `packages/<framework>/` with a `package.json`, `tsconfig.json`, and `vitest.config.ts` modelled on an existing adapter (e.g. `packages/koa`).
2. Implement the adapter so it accepts `CreateProxyOptions` and returns a standard proxy handler.
3. Wire up the testkit compliance suite in `packages/<framework>/test/compliance/<framework>-compliance.test.ts`:

   ```typescript
   import { describe } from 'vitest';
   import { runCompliance } from '../../../testkit/src/index.js';
   import type { ComplianceAdapter, CreateProxyOptions, ProxyHandle } from '../../../testkit/src/index.js';

   const myAdapter: ComplianceAdapter = {
     async createProxy(options: CreateProxyOptions): Promise<ProxyHandle> {
       // 1. Create a framework app/server
       // 2. Mount the proxy using options.upstreamUrl, options.headers, etc.
       // 3. Listen on port 0 (OS-assigned)
       // 4. Return { url, close() }
     },
   };

   runCompliance(myAdapter);
   ```

   All ten compliance scenarios must pass before the adapter is considered complete. See [`packages/testkit/README.md`](packages/testkit/README.md) for the full scenario list.

4. Add the package to the root `pnpm-workspace.yaml` and the adapter table in the root `README.md`.
5. Because `@nadimtuhin/simple-proxy-testkit` is private, reference it via workspace path in `devDependencies`:
   ```json
   "@nadimtuhin/simple-proxy-testkit": "workspace:*"
   ```

## Running integration tests

The cross-adapter parity suite lives in `packages/testkit/test/parity.test.ts`. It spins up all three adapters against a shared mock upstream and asserts identical behaviour.

```bash
# From the repo root — builds first, then runs all tests including parity
pnpm build && pnpm test

# Scoped to testkit only
cd packages/testkit
pnpm test
```

The mock upstream can also be used in adapter-specific tests:

```typescript
import { createMockUpstream } from '@nadimtuhin/simple-proxy-testkit';

const upstream = await createMockUpstream();
// upstream.url, upstream.close(), upstream.resetCounters()
```

## Release process

Releases are handled by CI. See the [Release Process](README.md#release-process) section in the root README.
