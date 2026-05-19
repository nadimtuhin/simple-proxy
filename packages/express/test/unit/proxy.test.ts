import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { Response } from 'express';
import { axiosProxyRequest, createProxyController, defaultErrorHandler } from '../../src/proxy.js';
import type { ProxyConfig, ProxyError, RequestWithFiles } from '../../src/types.js';

describe('Proxy', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  describe('axiosProxyRequest', () => {
    it('should make successful GET request', async () => {
      const mockData = { id: 1, name: 'John Doe' };
      nock('http://example.com').get('/api/users/1').reply(200, mockData);

      const res = await axiosProxyRequest({ url: 'http://example.com/api/users/1', method: 'GET', headers: {}, timeout: 5000 });
      expect(res.status).toBe(200);
      expect(res.data).toEqual(mockData);
    });

    it('should make successful POST request', async () => {
      const requestData = { name: 'John Doe' };
      const responseData = { id: 1, name: 'John Doe' };
      nock('http://example.com').post('/api/users', requestData).reply(201, responseData);

      const res = await axiosProxyRequest({ url: 'http://example.com/api/users', method: 'POST', headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(requestData), timeout: 5000 });
      expect(res.status).toBe(201);
    });

    it('should handle 404 error', async () => {
      nock('http://example.com').get('/api/users/999').reply(404, { message: 'User not found' });
      await expect(axiosProxyRequest({ url: 'http://example.com/api/users/999', method: 'GET', headers: {}, timeout: 5000 })).rejects.toMatchObject({ status: 404, message: 'User not found' });
    });

    it('should handle network error', async () => {
      nock('http://example.com').get('/api/users').replyWithError('Network error');
      await expect(axiosProxyRequest({ url: 'http://example.com/api/users', method: 'GET', headers: {}, timeout: 5000 })).rejects.toMatchObject({ status: 503, code: 'NETWORK_ERROR' });
    });

    it('should handle timeout', async () => {
      nock('http://example.com').get('/api/users').replyWithError({ message: 'timeout', code: 'ECONNABORTED' });
      await expect(axiosProxyRequest({ url: 'http://example.com/api/users', method: 'GET', headers: {}, timeout: 1000 })).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_TIMEOUT' });
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
      expect(() => createProxyController({ baseURL: 'http://example.com', headers: 'not-a-function' } as any)).toThrow('config.headers must be a function');
    });

    it('should validate errorHandler function', () => {
      expect(() => createProxyController({ baseURL: 'http://x.com', headers: () => ({}), errorHandler: 'x' } as any)).toThrow('config.errorHandler must be a function');
    });

    it('should validate errorHandlerHook function', () => {
      expect(() => createProxyController({ baseURL: 'http://x.com', headers: () => ({}), errorHandlerHook: 'x' } as any)).toThrow('config.errorHandlerHook must be a function');
    });

    it('should create proxy controller with valid config', () => {
      const controller = createProxyController({ baseURL: 'http://example.com', headers: () => ({}) });
      expect(typeof controller).toBe('function');
      expect(typeof controller()).toBe('function');
    });

    it('should handle successful GET request', async () => {
      nock('http://example.com').get('/users').reply(200, { id: 1 });
      const controller = createProxyController({ baseURL: 'http://example.com', headers: () => ({}) });
      await controller()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ id: 1 });
    });

    it('should handle custom proxy path', async () => {
      nock('http://example.com').get('/api/users').reply(200, { id: 1 });
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}) })('/api/users')(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle URL parameters', async () => {
      mockReq.params = { id: '123' };
      nock('http://example.com').get('/api/users/123').reply(200, { id: 123 });
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}) })('/api/users/:id')(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle query parameters', async () => {
      mockReq.query = { page: '1', limit: '10' };
      nock('http://example.com').get('/users').query({ page: '1', limit: '10' }).reply(200, { users: [] });
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}) })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle POST request with JSON body', async () => {
      const requestData = { name: 'John Doe' };
      nock('http://example.com').post('/users', requestData).reply(201, { id: 1, name: 'John Doe' });
      mockReq.method = 'POST';
      mockReq.body = requestData;
      (mockReq.is as any) = vi.fn().mockReturnValue(false);
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({ 'Content-Type': 'application/json' }) })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should handle custom response handler', async () => {
      nock('http://example.com').get('/users').reply(200, { id: 1 });
      const customHandler = vi.fn();
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}) })(undefined, customHandler)(mockReq, mockRes as Response, mockNext);
      expect(customHandler).toHaveBeenCalledWith(mockReq, mockRes, expect.objectContaining({ status: 200 }));
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should handle errors with custom error handler', async () => {
      nock('http://example.com').get('/users').reply(500, { message: 'Server error' });
      const customErrorHandler = vi.fn();
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), errorHandler: customErrorHandler })()(mockReq, mockRes as Response, mockNext);
      expect(customErrorHandler).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }), mockReq, mockRes);
    });

    it('should handle error handler hook', async () => {
      nock('http://example.com').get('/users').reply(500, { message: 'Server error' });
      const customErrorHandler = vi.fn();
      const errorHandlerHook = vi.fn().mockImplementation(error => { (error as any).context = 'hook'; return error; });
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), errorHandler: customErrorHandler, errorHandlerHook })()(mockReq, mockRes as Response, mockNext);
      expect(errorHandlerHook).toHaveBeenCalled();
      expect(customErrorHandler).toHaveBeenCalledWith(expect.objectContaining({ status: 500, context: 'hook' }), mockReq, mockRes);
    });

    it('should handle responseHeaders config', async () => {
      nock('http://example.com').get('/users').reply(200, { id: 1 }, { 'x-custom-header': 'value' });
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), responseHeaders: (r) => ({ 'x-forwarded': r.headers['x-custom-header'] }) })()(mockReq, mockRes as Response, mockNext);
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
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), beforeRequest: () => ({ status: 202, data: { cached: true } }) })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(202);
      expect(mockRes.json).toHaveBeenCalledWith({ cached: true });
    });

    it('should short-circuit with custom headers', async () => {
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), beforeRequest: () => ({ status: 200, data: {}, headers: { 'x-cache': 'HIT' } }) })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.set).toHaveBeenCalledWith({ 'x-cache': 'HIT' });
    });

    it('should proceed to upstream when hook returns void', async () => {
      nock('http://example.com').get('/users').reply(200, { id: 1 });
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), beforeRequest: () => undefined })()(mockReq, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should allow hook to mutate payload headers', async () => {
      nock('http://example.com').get('/users').matchHeader('x-injected', 'yes').reply(200, {});
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), beforeRequest: (payload) => { payload.headers['x-injected'] = 'yes'; } })()(mockReq, mockRes as Response, mockNext);
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
      nock('http://example.com').get('/users').reply(200, { id: 1 });
      const onResponse = vi.fn();
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), onResponse })()(mockReq, mockRes as Response, mockNext);
      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse.mock.calls[0][0]).toMatchObject({ status: 200, source: 'upstream', method: 'GET' });
    });

    it('should call onResponse with short-circuit stats', async () => {
      const onResponse = vi.fn();
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), beforeRequest: () => ({ status: 202, data: {} }), onResponse })()(mockReq, mockRes as Response, mockNext);
      expect(onResponse.mock.calls[0][0]).toMatchObject({ source: 'short-circuit', status: 202 });
    });

    it('should call onResponse on error path', async () => {
      nock('http://example.com').get('/users').reply(404, { message: 'Not found' });
      const onResponse = vi.fn();
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), onResponse })()(mockReq, mockRes as Response, mockNext);
      expect(onResponse.mock.calls[0][0].status).toBe(404);
    });

    it('should fire exactly once per request', async () => {
      nock('http://example.com').get('/users').reply(200, { id: 1 });
      const onResponse = vi.fn();
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}), onResponse })()(mockReq, mockRes as Response, mockNext);
      expect(onResponse).toHaveBeenCalledTimes(1);
    });

    it('should swallow errors thrown by onResponse callback', async () => {
      nock('http://example.com').get('/users').reply(200, { id: 1 });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(createProxyController({ baseURL: 'http://example.com', headers: () => ({}), onResponse: () => { throw new Error('callback fail'); } })()(mockReq, mockRes as Response, mockNext)).resolves.toBeUndefined();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      consoleSpy.mockRestore();
    });
  });

  describe('granular error codes', () => {
    it('should set UPSTREAM_AUTH code for 401 responses', async () => {
      nock('http://example.com').get('/users').reply(401, { message: 'Unauthorized' });
      const mockReq = { method: 'GET', path: '/users', query: {}, params: {}, body: {}, is: vi.fn(), locals: {} } as any;
      const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() } as unknown as Response;
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}) })()(mockReq, mockRes, vi.fn());
      expect((mockRes.json as any).mock.calls[0][0].error.code).toBe('UPSTREAM_AUTH');
    });

    it('should set UPSTREAM_AUTH code for 403 responses', async () => {
      nock('http://example.com').get('/users').reply(403, { message: 'Forbidden' });
      const mockReq = { method: 'GET', path: '/users', query: {}, params: {}, body: {}, is: vi.fn(), locals: {} } as any;
      const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() } as unknown as Response;
      await createProxyController({ baseURL: 'http://example.com', headers: () => ({}) })()(mockReq, mockRes, vi.fn());
      expect((mockRes.json as any).mock.calls[0][0].error.code).toBe('UPSTREAM_AUTH');
    });
  });
});
