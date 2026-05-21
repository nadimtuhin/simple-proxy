# koa-example

Minimal proxy server built with Koa and `@simple-proxy/koa`.

Proxies all requests to [jsonplaceholder.typicode.com](https://jsonplaceholder.typicode.com).

## Run

```bash
# from repo root
pnpm install
node examples/koa-example/server.js

# or from this directory
pnpm start
```

## Try it

```bash
curl http://localhost:3001/todos/1
curl http://localhost:3001/posts/1
curl -X POST http://localhost:3001/posts \
  -H 'Content-Type: application/json' \
  -d '{"title":"hello","body":"world","userId":1}'
```

## How it works

`createKoaProxyMiddleware` returns a Koa middleware function.
Mount it on a router route and pass `baseURL` to point at your upstream API.

```js
const proxy = createKoaProxyMiddleware({
  baseURL: 'https://api.example.com',
  headers: (ctx) => ({
    Authorization: ctx.get('authorization'),
  }),
});

router.all('(.*)', proxy);
app.use(router.routes());
app.use(router.allowedMethods());
```
