# fastify-example

Minimal proxy server built with Fastify and `@simple-proxy/fastify`.

Proxies all requests to [jsonplaceholder.typicode.com](https://jsonplaceholder.typicode.com).

## Run

```bash
# from repo root
pnpm install
node examples/fastify-example/server.js

# or from this directory
pnpm start
```

## Try it

```bash
curl http://localhost:3000/todos/1
curl http://localhost:3000/posts/1
curl -X POST http://localhost:3000/posts \
  -H 'Content-Type: application/json' \
  -d '{"title":"hello","body":"world","userId":1}'
```

## How it works

`createFastifyProxyHandler` returns a Fastify route handler.
Register it on any route and pass `baseURL` to point at your upstream API.

```js
const handler = createFastifyProxyHandler({
  baseURL: 'https://api.example.com',
  headers: (req) => ({
    Authorization: req.headers.authorization ?? '',
  }),
});

fastify.route({
  method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  url: '/*',
  handler,
});
```
