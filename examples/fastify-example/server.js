// Fastify example: proxy all requests to jsonplaceholder.typicode.com
//
// Run:
//   node server.js
//
// Then try:
//   curl http://localhost:3000/todos/1
//   curl http://localhost:3000/posts/1

import Fastify from 'fastify';
import { createFastifyProxyHandler } from '@simple-proxy/fastify';

const fastify = Fastify({ logger: true });

// Create a proxy handler that forwards requests to the upstream API.
// Pass Authorization header through from the client request.
const handler = createFastifyProxyHandler({
  baseURL: 'https://jsonplaceholder.typicode.com',
  headers: (req) => ({
    ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
  }),
  onResponse: (stats) => {
    fastify.log.info({ proxy: stats }, 'proxy request complete');
  },
});

// Proxy all HTTP methods on every path to the upstream
fastify.route({
  method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  url: '/*',
  handler,
});

const PORT = Number(process.env.PORT ?? 3000);

fastify.listen({ port: PORT, host: '127.0.0.1' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
