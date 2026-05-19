import { describe } from 'vitest';
import { createServer } from 'node:http';
import express from 'express';
import multer from 'multer';
import { createProxyController } from '../../src/proxy.js';
import { runCompliance } from '../../../testkit/src/index.js';
import type { ComplianceAdapter, CreateProxyOptions, ProxyHandle } from '../../../testkit/src/index.js';

const expressAdapter: ComplianceAdapter = {
  async createProxy(options: CreateProxyOptions): Promise<ProxyHandle> {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    const upload = multer({ storage: multer.memoryStorage() });
    app.use(upload.any());

    const proxy = createProxyController({
      baseURL: options.upstreamUrl,
      headers: options.headers ?? (() => ({})),
      timeout: options.timeout,
      beforeRequest: options.beforeRequest
        ? (payload, _req) => options.beforeRequest!(payload)
        : undefined,
      onResponse: options.onResponse
        ? (stats, _req, _res) => options.onResponse!(stats)
        : undefined,
    });

    app.all('*', proxy(options.proxyPath) as any);

    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    return {
      url: `http://localhost:${port}`,
      close: () => new Promise<void>((res, rej) =>
        server.close(err => (err ? rej(err) : res()))
      ),
    };
  },
};

runCompliance(expressAdapter);
