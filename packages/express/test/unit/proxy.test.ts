import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Response } from 'express';
import { axiosProxyRequest, createProxyController, defaultErrorHandler } from '../../src/proxy.js';
import type { ProxyConfig, ProxyError, RequestWithFiles } from '../../src/types.js';

type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
const routes = new Map<string, RouteHandler>();
let server: Server;
let base: string;
let closedPort: number;

beforeAll(async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  closedPort = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const handler = routes.get(`${req.method} ${path}`);
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (handler) return handler(req, res, body);
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'no route' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => routes.clear());

function route(method: string, path: string, status: number, data: unknown, headers: Record<string, string> = {}) {
  routes.set(`${method} ${path}`, (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
  });
}

describe('Proxy', () => {
  describe('axiosProxyRequest', () => {
    it('should make successful GET request', async () => {
      const mockData = { id: 1, name: 'John Doe' };
      route('GET', '/api/users/1', 200, mockData);

      const res = await axiosProxyRequest({ url: `${base}/api/users/1`, method: 'GET', headers: {}, timeout: 5000 });
      expect(res.status).toBe(200);
      expect(res.data).toEqual(mockData);
    });

    it('should make successful POST request', async () => {
      const requestData = { name: 'John Doe' };
      let received: unknown;
      routes.set('POST /api/users', (_req, res, body) => {
        received = JSON.parse(body);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 1, name: 'John Doe' }));
      });

      const res = await axiosProxyRequest({ url: `${base}/api/users`, method: 'POST', headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(requestData), timeout: 5000 });
      expect(res.status).toBe(201);
      expect(received).toEqual(requestData);
    });

    it('should handle 404 error', async () => {
      route('GET', '/api/users/999', 404, { message: 'User not found' });
      await expect(axiosProxyRequest({ url: `${base}/api/users/999`, method: 'GET', headers: {}, timeout: 5000 })).rejects.toMatchObject({ status: 404, message: 'User not found' });
    });

    it('should handle network error', async () => {
      await expect(axiosProxyRequest({ url: `http://127.0.0.1:${closedPort}/api/users`, method: 'GET', headers: {}, timeout: 5000 })).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_UNREACHABLE' });
    });

    it('should handle timeout', async () => {
      routes.set('GET /api/users', () => {
        /* never respond → axios aborts */
      });
      await expect(axiosProxyRequest({ url: `${base}/api/users`, method: 'GET', headers: {}, timeout: 100 })).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_TIMEOUT' });
    });

    it('should throw error for missing URL', async () => {
      await expect(axiosProxyRequest({ url: '', method: 'GET', headers: {}, timeout: 5000 })).rejects.toThrow('url is required for axiosProxyRequest');
    });
  });

  describe('defaultErrorHandler', () => {
    let mockRes: Partial<Response>;
    let mockReq: RequestWithFiles;

    beforeEach(() => {
      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
      };
      mockReq = {} as RequestWithFiles;
    });

    it('should handle basic error', () => {
      const error: ProxyError = Object.assign(new Error('Test error'), { status: 400, code: 'BAD_REQUEST' });
      defaultErrorHandler(error, mockReq as any, mockRes as Response);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: { message: 'Test error', code: 'BAD_REQUEST' } });
    });

    it('should handle error with data', () => {
      const error: ProxyError = Object.assign(new Error('Validation error'), { status: 422, code: 'VALIDATION_ERROR', data: { field: 'name' } });
      defaultErrorHandler(error, mockReq as any, mockRes as Response);
      expect(mockRes.json).toHaveBeenCalledWith({ error: { message: 'Validation error', code: 'VALIDATION_ERROR', details: { field: 'name' } } });
    });

    it('should filter content-length from error headers', () => {
      const error: ProxyError = Object.assign(new Error('Rate limited'), { status: 429, headers: { 'retry-after': '60', 'content-length': '100' } });
      defaultErrorHandler(error, mockReq as any, mockRes as Response);
      expect(mockRes.set).toHaveBeenCalledWith('retry-after', '60');
      expect(mockRes.set).not.toHaveBeenCalledWith('content-length', '100');
    });

    it('should use default values for missing properties', () => {
      defaultErrorHandler(new Error() as ProxyError, mockReq as any, mockRes as Response);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: { message: 'Internal server error', code: 'UNKNOWN_ERROR' } });
    });
  });

  describe('createProxyController', () => {
    let mockReq: RequestWithFiles;
    let mockRes: Partial<Response>;
    let mockNext: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockReq = { method: 'GET', path: '/users', query: {}, params: {}, body: {}, is: vi.fn(), locals: {} } as any;
      mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() };
      mockNext = vi.fn();
    });

    it('should validate required config', () => {
      expect(() => createProxyController(null as any)).toThrow('config is required');
    });

    it('should validate baseURL', () => {
      expect(() => createProxyController({ headers: () => ({}) } as any)).toThrow('config.baseURL is required');
    });

    it('should validate headers function', () => {
      expect(() => createProxyController({ baseURL: base, headers: 'not-a-function' } as any)).toThrow('config.headers must be a function');
    });

    it('should validate errorHandler function', () => {
      expect(() => createProxyController({ baseURL: 'http://x.com', headers: () => ({}), errorHandler: 'x' } as any)).toThrow('config.errorHandler must be a function');
    });

    it('should validate errorHandlerHook function', () => {
      expect(() => createProxyController({ baseURL: 'http://x.com', headers: () => ({}), errorHandlerHook: 'x' } as any)).toThrow('config.errorHandlerHook must be a function');
    });

    it('should create proxy controller with valid config', () => {
      const controller = createProxyController({ baseURL: base, headers: () => ({}) });
      expect(typeof controller).toBe('function');
      expect(typeof controller()).toBe('function');
    });

    it('should handle successful GET request', async () => {
      route('GET', '/users', 200, { id: 1 });
      const controller = createProxyController({ baseURL: base, headers: () => ({}) });
      await controller()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ id: 1 });
    });

    it('should handle custom proxy path', async () => {
      route('GET', '/api/users', 200, { id: 1 });
      await createProxyController({ baseURL: base, headers: () => ({}) })('/api/users')(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle URL parameters', async () => {
      mockReq.params = { id: '123' };
      route('GET', '/api/users/123', 200, { id: 123 });
      await createProxyController({ baseURL: base, headers: () => ({}) })('/api/users/:id')(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle query parameters', async () => {
      mockReq.query = { page: '1', limit: '10' };
      routes.set('GET /users', (req, res) => {
        const params = new URL(req.url ?? '', base).searchParams;
        if (params.get('page') !== '1' || params.get('limit') !== '10') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: 'bad query' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ users: [] }));
      });
      await createProxyController({ baseURL: base, headers: () => ({}) })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle POST request with JSON body', async () => {
      const requestData = { name: 'John Doe' };
      let received: unknown;
      routes.set('POST /users', (_req, res, body) => {
        received = JSON.parse(body);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 1, name: 'John Doe' }));
      });
      mockReq.method = 'POST';
      mockReq.body = requestData;
      (mockReq.is as any) = vi.fn().mockReturnValue(false);
      await createProxyController({ baseURL: base, headers: () => ({ 'Content-Type': 'application/json' }) })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(received).toEqual(requestData);
    });

    it('should handle custom response handler', async () => {
      route('GET', '/users', 200, { id: 1 });
      const customHandler = vi.fn();
      await createProxyController({ baseURL: base, headers: () => ({}) })(undefined, customHandler)(mockReq, mockRes as Response, mockNext);
      expect(customHandler).toHaveBeenCalledWith(mockReq, mockRes, expect.objectContaining({ status: 200 }));
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should handle errors with custom error handler', async () => {
      route('GET', '/users', 500, { message: 'Server error' });
      const customErrorHandler = vi.fn();
      await createProxyController({ baseURL: base, headers: () => ({}), errorHandler: customErrorHandler })()(mockReq, mockRes as Response, mockNext);
      expect(customErrorHandler).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }), mockReq, mockRes);
    });

    it('should handle error handler hook', async () => {
      route('GET', '/users', 500, { message: 'Server error' });
      const customErrorHandler = vi.fn();
      const errorHandlerHook = vi.fn().mockImplementation(error => { (error as any).context = 'hook'; return error; });
      await createProxyController({ baseURL: base, headers: () => ({}), errorHandler: customErrorHandler, errorHandlerHook })()(mockReq, mockRes as Response, mockNext);
      expect(errorHandlerHook).toHaveBeenCalled();
      expect(customErrorHandler).toHaveBeenCalledWith(expect.objectContaining({ status: 500, context: 'hook' }), mockReq, mockRes);
    });

    it('should handle responseHeaders config', async () => {
      route('GET', '/users', 200, { id: 1 }, { 'x-custom-header': 'value' });
      await createProxyController({ baseURL: base, headers: () => ({}), responseHeaders: (r) => ({ 'x-forwarded': r.headers['x-custom-header'] }) })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.set).toHaveBeenCalledWith({ 'x-forwarded': 'value' });
    });
  });

  describe('beforeRequest hook', () => {
    let mockReq: RequestWithFiles;
    let mockRes: Partial<Response>;
    let mockNext: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockReq = { method: 'GET', path: '/users', query: {}, params: {}, body: {}, is: vi.fn(), locals: {} } as any;
      mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() };
      mockNext = vi.fn();
    });

    it('should short-circuit and return custom response', async () => {
      await createProxyController({ baseURL: base, headers: () => ({}), beforeRequest: () => ({ status: 202, data: { cached: true } }) })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(202);
      expect(mockRes.json).toHaveBeenCalledWith({ cached: true });
    });

    it('should short-circuit with custom headers', async () => {
      await createProxyController({ baseURL: base, headers: () => ({}), beforeRequest: () => ({ status: 200, data: {}, headers: { 'x-cache': 'HIT' } }) })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.set).toHaveBeenCalledWith({ 'x-cache': 'HIT' });
    });

    it('should proceed to upstream when hook returns void', async () => {
      route('GET', '/users', 200, { id: 1 });
      await createProxyController({ baseURL: base, headers: () => ({}), beforeRequest: () => undefined })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should allow hook to mutate payload headers', async () => {
      routes.set('GET /users', (req, res) => {
        if (req.headers['x-injected'] !== 'yes') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: 'missing header' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({}));
      });
      await createProxyController({ baseURL: base, headers: () => ({}), beforeRequest: (payload) => { payload.headers['x-injected'] = 'yes'; } })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe('onResponse callback', () => {
    let mockReq: RequestWithFiles;
    let mockRes: Partial<Response>;
    let mockNext: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockReq = { method: 'GET', path: '/users', query: {}, params: {}, body: {}, is: vi.fn(), locals: {} } as any;
      mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() };
      mockNext = vi.fn();
    });

    it('should call onResponse with upstream stats on success', async () => {
      route('GET', '/users', 200, { id: 1 });
      const onResponse = vi.fn();
      await createProxyController({ baseURL: base, headers: () => ({}), onResponse })()(mockReq, mockRes as Response, mockNext);
      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse.mock.calls[0][0]).toMatchObject({ status: 200, source: 'upstream', method: 'GET' });
    });

    it('should call onResponse with short-circuit stats', async () => {
      const onResponse = vi.fn();
      await createProxyController({ baseURL: base, headers: () => ({}), beforeRequest: () => ({ status: 202, data: {} }), onResponse })()(mockReq, mockRes as Response, mockNext);
      expect(onResponse.mock.calls[0][0]).toMatchObject({ source: 'short-circuit', status: 202 });
    });

    it('should call onResponse on error path', async () => {
      route('GET', '/users', 404, { message: 'Not found' });
      const onResponse = vi.fn();
      await createProxyController({ baseURL: base, headers: () => ({}), onResponse })()(mockReq, mockRes as Response, mockNext);
      expect(onResponse.mock.calls[0][0].status).toBe(404);
    });

    it('should fire exactly once per request', async () => {
      route('GET', '/users', 200, { id: 1 });
      const onResponse = vi.fn();
      await createProxyController({ baseURL: base, headers: () => ({}), onResponse })()(mockReq, mockRes as Response, mockNext);
      expect(onResponse).toHaveBeenCalledTimes(1);
    });

    it('should swallow errors thrown by onResponse callback', async () => {
      route('GET', '/users', 200, { id: 1 });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(createProxyController({ baseURL: base, headers: () => ({}), onResponse: () => { throw new Error('callback fail'); } })()(mockReq, mockRes as Response, mockNext)).resolves.toBeUndefined();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      consoleSpy.mockRestore();
    });
  });

  describe('granular error codes', () => {
    it('should set UPSTREAM_AUTH code for 401 responses', async () => {
      route('GET', '/users', 401, { message: 'Unauthorized' });
      const mockReq = { method: 'GET', path: '/users', query: {}, params: {}, body: {}, is: vi.fn(), locals: {} } as any;
      const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() } as unknown as Response;
      await createProxyController({ baseURL: base, headers: () => ({}) })()(mockReq, mockRes, vi.fn());
      expect((mockRes.json as any).mock.calls[0][0].error.code).toBe('UPSTREAM_AUTH');
    });

    it('should set UPSTREAM_AUTH code for 403 responses', async () => {
      route('GET', '/users', 403, { message: 'Forbidden' });
      const mockReq = { method: 'GET', path: '/users', query: {}, params: {}, body: {}, is: vi.fn(), locals: {} } as any;
      const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() } as unknown as Response;
      await createProxyController({ baseURL: base, headers: () => ({}) })()(mockReq, mockRes, vi.fn());
      expect((mockRes.json as any).mock.calls[0][0].error.code).toBe('UPSTREAM_AUTH');
    });
  });
});
