import { describe } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createKoaProxyMiddleware } from '../../src/index.js';
import { runCompliance } from '../../../testkit/src/index.js';
import type { ComplianceAdapter, CreateProxyOptions, ProxyHandle } from '../../../testkit/src/index.js';

const koaAdapter: ComplianceAdapter = {
  async createProxy(options: CreateProxyOptions): Promise<ProxyHandle> {
    const app = new Koa();
    const router = new Router();

    app.use(bodyParser());

    const middleware = createKoaProxyMiddleware(
      {
        baseURL: options.upstreamUrl,
        headers: options.headers ? (_ctx) => options.headers!() : () => ({}),
        timeout: options.timeout,
        beforeRequest: options.beforeRequest
          ? (payload, _ctx) => options.beforeRequest!(payload)
          : undefined,
        onResponse: options.onResponse
          ? (stats, _ctx) => options.onResponse!(stats)
          : undefined,
      },
      options.proxyPath
    );

    router.all('(.*)', middleware);
    app.use(router.routes());
    app.use(router.allowedMethods());

    const server = createServer(app.callback());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    return {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((res, rej) =>
        server.close(err => (err ? rej(err) : res()))
      ),
    };
  },
};

runCompliance(koaAdapter);
