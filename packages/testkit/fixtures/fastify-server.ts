/**
 * E2E fixture: Fastify proxy server.
 * Starts a real HTTP server, writes "READY:<port>" to stdout when ready.
 * Designed to be spawned as a child process.
 */
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { createFastifyProxyHandler } from '@simple-proxy/fastify';
import { createMockUpstream } from '../src/mock-upstream.ts';

const upstream = await createMockUpstream();

const fastify = Fastify({ logger: false });

const timeout = process.env['PROXY_TIMEOUT'] ? parseInt(process.env['PROXY_TIMEOUT'], 10) : undefined;

const handler = createFastifyProxyHandler({
  baseURL: upstream.url,
  headers: (_req: FastifyRequest) => ({}),
  ...(timeout !== undefined ? { timeout } : {}),
});

fastify.route({
  method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  url: '/*',
  handler,
});

await fastify.listen({ port: 0 });
const addr = fastify.server.address() as { port: number };
process.stdout.write(`READY:${addr.port}\n`);

process.on('SIGTERM', async () => {
  await fastify.close();
  await upstream.close();
  process.exit(0);
});
