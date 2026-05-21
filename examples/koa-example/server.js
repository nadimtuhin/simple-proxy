// Koa example: proxy all requests to jsonplaceholder.typicode.com
//
// Run:
//   node server.js
//
// Then try:
//   curl http://localhost:3001/todos/1
//   curl http://localhost:3001/posts/1

import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createKoaProxyMiddleware } from '@simple-proxy/koa';

const app = new Koa();
const router = new Router();

// Parse JSON and form bodies before the proxy middleware
app.use(bodyParser());

// Create a proxy middleware that forwards requests to the upstream API.
// Pass Authorization header through from the client request.
const proxy = createKoaProxyMiddleware({
  baseURL: 'https://jsonplaceholder.typicode.com',
  headers: (ctx) => ({
    ...(ctx.get('authorization') ? { Authorization: ctx.get('authorization') } : {}),
  }),
  onResponse: (stats, ctx) => {
    console.log(`[proxy] ${stats.method} ${stats.url} -> ${stats.status} (${stats.durationMs}ms)`);
  },
});

// Proxy all paths to the upstream
router.all('(.*)', proxy);

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Koa proxy listening on http://localhost:${PORT}`);
});
