/**
 * E2E fixture: Koa proxy server.
 * Starts a real HTTP server, writes "READY:<port>" to stdout when ready.
 * Designed to be spawned as a child process.
 */
import { createServer } from 'node:http';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createKoaProxyMiddleware } from '@simple-proxy/koa';
import { createMockUpstream } from '../src/mock-upstream.ts';

const upstream = await createMockUpstream();

const app = new Koa();
const router = new Router();

app.use(bodyParser());

const timeout = process.env['PROXY_TIMEOUT'] ? parseInt(process.env['PROXY_TIMEOUT'], 10) : undefined;

const middleware = createKoaProxyMiddleware({
  baseURL: upstream.url,
  headers: () => ({}),
  ...(timeout !== undefined ? { timeout } : {}),
});

router.all('(.*)', middleware);
app.use(router.routes());
app.use(router.allowedMethods());

const server = createServer(app.callback());
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const addr = server.address() as { port: number };
process.stdout.write(`READY:${addr.port}\n`);

process.on('SIGTERM', async () => {
  server.close(() => {});
  await upstream.close();
  process.exit(0);
});
