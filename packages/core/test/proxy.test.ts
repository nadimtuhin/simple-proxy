import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { axiosProxyRequest } from '../src/proxy.js';

describe('axiosProxyRequest', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('returns 200 JSON response', async () => {
    const data = { id: 1, name: 'Alice' };
    nock('http://example.com').get('/users/1').reply(200, data);

    const res = await axiosProxyRequest({ url: 'http://example.com/users/1', method: 'GET', headers: {}, timeout: 5000 });
    expect(res.status).toBe(200);
    expect(res.data).toEqual(data);
  });

  it('throws on 4xx with UPSTREAM_AUTH for 401', async () => {
    nock('http://example.com').get('/secure').reply(401, { message: 'Unauthorized' });

    await expect(axiosProxyRequest({ url: 'http://example.com/secure', method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toMatchObject({ status: 401, code: 'UPSTREAM_AUTH' });
  });

  it('throws on 403 with UPSTREAM_AUTH', async () => {
    nock('http://example.com').get('/secure').reply(403, {});

    await expect(axiosProxyRequest({ url: 'http://example.com/secure', method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toMatchObject({ code: 'UPSTREAM_AUTH' });
  });

  it('throws on 500', async () => {
    nock('http://example.com').get('/fail').reply(500, { message: 'Server error' });

    await expect(axiosProxyRequest({ url: 'http://example.com/fail', method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toMatchObject({ status: 500 });
  });

  it('throws UPSTREAM_TIMEOUT on ECONNABORTED', async () => {
    nock('http://example.com').get('/slow').replyWithError({ message: 'timeout', code: 'ECONNABORTED' });

    await expect(axiosProxyRequest({ url: 'http://example.com/slow', method: 'GET', headers: {}, timeout: 1000 }))
      .rejects.toMatchObject({ status: 503, code: 'UPSTREAM_TIMEOUT' });
  });

  it('throws UPSTREAM_UNREACHABLE on ECONNREFUSED', async () => {
    nock('http://example.com').get('/gone').replyWithError({ message: 'refused', code: 'ECONNREFUSED' });

    await expect(axiosProxyRequest({ url: 'http://example.com/gone', method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toMatchObject({ code: 'UPSTREAM_UNREACHABLE' });
  });

  it('throws for missing url', async () => {
    await expect(axiosProxyRequest({ url: '', method: 'GET', headers: {}, timeout: 5000 }))
      .rejects.toThrow('url is required');
  });

  it('sends POST body', async () => {
    const body = { name: 'Bob' };
    nock('http://example.com').post('/users', body).reply(201, { id: 2 });

    const res = await axiosProxyRequest({ url: 'http://example.com/users', method: 'POST', headers: { 'Content-Type': 'application/json' }, data: body, timeout: 5000 });
    expect(res.status).toBe(201);
  });
});
