import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { axiosProxyRequest } from '../src/proxy.js';

type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
const routes = new Map<string, RouteHandler>();
let server: Server;
let base: string;
let closedPort: number;

beforeAll(async () => {
  // Reserve a port with no listener for ECONNREFUSED tests.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  closedPort = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const key = `${req.method} ${path}`;
    const handler = routes.get(key);
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (handler) return handler(req, res, body);
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'no route' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => routes.clear());

function route(method: string, path: string, status: number, data: unknown, headers: Record<string, string> = {}) {
  routes.set(`${method} ${path}`, (_req, res, _body) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
  });
}

describe('axiosProxyRequest', () => {
  it('returns 200 JSON response', async () => {
    const data = { id: 1, name: 'Alice' };
    route('GET', '/users/1', 200, data);

    const res = await axiosProxyRequest({ url: `${base}/users/1`, method: 'GET', headers: {}, timeout: 5000 });
    expect(res.status).toBe(200);
    expect(res.data).toEqual(data);
  });

  it('throws on 4xx with UPSTREAM_AUTH for 401', async () => {
    route('GET', '/secure', 401, { message: 'Unauthorized' });

    await expect(axiosProxyRequest({ url: `${base}/secure`, method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toMatchObject({ status: 401, code: 'UPSTREAM_AUTH' });
  });

  it('throws on 403 with UPSTREAM_AUTH', async () => {
    route('GET', '/secure', 403, {});

    await expect(axiosProxyRequest({ url: `${base}/secure`, method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toMatchObject({ code: 'UPSTREAM_AUTH' });
  });

  it('throws on 500', async () => {
    route('GET', '/fail', 500, { message: 'Server error' });

    await expect(axiosProxyRequest({ url: `${base}/fail`, method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toMatchObject({ status: 500 });
  });

  it('throws UPSTREAM_TIMEOUT on ECONNABORTED', async () => {
    // Real upstream that never responds in time → axios aborts with ECONNABORTED.
    routes.set('GET /slow', () => {
      /* intentionally never call res.end() */
    });

    await expect(axiosProxyRequest({ url: `${base}/slow`, method: 'GET', headers: {}, timeout: 100 }))
      .rejects.toMatchObject({ status: 503, code: 'UPSTREAM_TIMEOUT' });
  });

  it('throws UPSTREAM_UNREACHABLE on ECONNREFUSED', async () => {
    // Point at a port with no listener → real ECONNREFUSED.
    await expect(axiosProxyRequest({ url: `http://127.0.0.1:${closedPort}/gone`, method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toMatchObject({ code: 'UPSTREAM_UNREACHABLE' });
  });

  it('throws for missing url', async () => {
    await expect(axiosProxyRequest({ url: '', method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toThrow('url is required');
  });

  it('sends POST body', async () => {
    let received: unknown;
    routes.set('POST /users', (_req, res, body) => {
      received = JSON.parse(body);
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 2 }));
    });

    const res = await axiosProxyRequest({ url: `${base}/users`, method: 'POST', headers: { 'Content-Type': 'application/json' }, data: { name: 'Bob' }, timeout: 5000 });
    expect(res.status).toBe(201);
    expect(received).toEqual({ name: 'Bob' });
  });
});
