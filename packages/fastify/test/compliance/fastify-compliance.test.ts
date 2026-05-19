import { describe } from 'vitest';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { createFastifyProxyHandler } from '../../src/index.js';
import { runCompliance } from '../../../testkit/src/index.js';
import type { ComplianceAdapter, CreateProxyOptions, ProxyHandle } from '../../../testkit/src/index.js';

const fastifyAdapter: ComplianceAdapter = {
  async createProxy(options: CreateProxyOptions): Promise<ProxyHandle> {
    const fastify = Fastify({ logger: false });

    const handler = createFastifyProxyHandler(
      {
        baseURL: options.upstreamUrl,
        headers: options.headers ? (_req: FastifyRequest) => options.headers!() : () => ({}),
        timeout: options.timeout,
        beforeRequest: options.beforeRequest
          ? (payload, _req) => options.beforeRequest!(payload)
          : undefined,
        onResponse: options.onResponse
          ? (stats, _req, _reply) => options.onResponse!(stats)
          : undefined,
      },
      options.proxyPath
    );

    fastify.route({
      method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
      url: '/*',
      handler,
    });

    await fastify.listen({ port: 0, host: '127.0.0.1' });
    const { port } = fastify.server.address() as AddressInfo;

    return {
      url: `http://127.0.0.1:${port}`,
      close: () => fastify.close(),
    };
  },
};

runCompliance(fastifyAdapter);
