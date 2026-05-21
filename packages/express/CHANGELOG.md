# @simple-proxy/express

## 0.3.0

### Minor Changes

- Refactor: extract shared proxy execution pipeline, decompose god functions into pure helpers.
  - `runProxyPipeline` exported from core — shared by all adapters, eliminates 3x duplication
  - `buildUpstreamStats` / `buildErrorStats` exported from core — pure stat builders
  - All adapter functions decomposed to ≤20 lines each, pure where possible
  - Bug fix: `replaceUrlTemplate` regex collision for prefix param names (`:id` inside `:idCard`)
  - 3-layer test strategy: +49 unit tests, +18 E2E tests (real subprocess), 332 total

### Patch Changes

- Updated dependencies
  - @simple-proxy/core@0.3.0

## 0.2.0

### Minor Changes

- Initial public release of the @simple-proxy monorepo. Framework-agnostic HTTP proxy utilities for Express, Fastify, and Koa.

### Patch Changes

- Updated dependencies
  - @simple-proxy/core@0.2.0
