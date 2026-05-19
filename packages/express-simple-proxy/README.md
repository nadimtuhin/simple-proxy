# express-simple-proxy

> **Deprecated.** This package has moved to [`@simple-proxy/express`](../express).

## Migrate

```bash
npm uninstall express-simple-proxy
npm install @simple-proxy/express
```

Update imports:

```diff
- import createProxyController from 'express-simple-proxy';
+ import { createProxyController } from '@simple-proxy/express';
```

## About

`express-simple-proxy@2.x` is a thin re-export shim over `@simple-proxy/express`. All existing code continues to work without changes — but migrate to get direct access to the full API and future updates.
