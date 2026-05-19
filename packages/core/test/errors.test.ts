import { describe, it, expect } from 'vitest';
import { AxiosError } from 'axios';
import {
  classifyResponseError,
  classifyNetworkError,
  isShortCircuitResponse,
  buildErrorResponseBody,
  filterProxyResponseHeaders,
} from '../src/errors.js';

function makeAxiosError(
  opts: {
    message?: string;
    code?: string;
    responseStatus?: number;
    responseData?: unknown;
    responseHeaders?: Record<string, string>;
    hasResponse?: boolean;
  } = {}
): AxiosError {
  const {
    message = 'axios error',
    code,
    responseStatus,
    responseData,
    responseHeaders = {},
    hasResponse = true,
  } = opts;

  const err = new AxiosError(message);
  if (code !== undefined) err.code = code;
  if (hasResponse && responseStatus !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).response = { status: responseStatus, data: responseData, headers: responseHeaders };
  }
  return err;
}

describe('classifyResponseError', () => {
  it('sets code UPSTREAM_AUTH for 401', () => {
    expect(classifyResponseError(makeAxiosError({ responseStatus: 401, responseData: {} })).code).toBe('UPSTREAM_AUTH');
  });

  it('sets code UPSTREAM_AUTH for 403', () => {
    expect(classifyResponseError(makeAxiosError({ responseStatus: 403, responseData: {} })).code).toBe('UPSTREAM_AUTH');
  });

  it('does not set code for 404', () => {
    expect(classifyResponseError(makeAxiosError({ responseStatus: 404, responseData: {} })).code).toBeUndefined();
  });

  it('preserves response status', () => {
    expect(classifyResponseError(makeAxiosError({ responseStatus: 422, responseData: {} })).status).toBe(422);
  });

  it('preserves response data', () => {
    const data = { detail: 'unprocessable' };
    expect(classifyResponseError(makeAxiosError({ responseStatus: 422, responseData: data })).data).toEqual(data);
  });

  it('preserves response headers', () => {
    const headers = { 'x-request-id': 'abc123' };
    expect(classifyResponseError(makeAxiosError({ responseStatus: 200, responseData: {}, responseHeaders: headers })).headers).toEqual(headers);
  });

  it('uses response.data.message when present', () => {
    const err = makeAxiosError({ responseStatus: 400, responseData: { message: 'Bad input' }, message: 'fallback' });
    expect(classifyResponseError(err).message).toBe('Bad input');
  });

  it('falls back to axiosError.message', () => {
    const err = makeAxiosError({ responseStatus: 500, responseData: { code: 'ERR' }, message: 'axios msg' });
    expect(classifyResponseError(err).message).toBe('axios msg');
  });
});

describe('classifyNetworkError', () => {
  const timeoutCodes = ['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'];
  const unreachableCodes = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'];

  timeoutCodes.forEach((code) => {
    it(`sets UPSTREAM_TIMEOUT for ${code}`, () => {
      expect(classifyNetworkError(makeAxiosError({ code, hasResponse: false })).code).toBe('UPSTREAM_TIMEOUT');
    });
  });

  unreachableCodes.forEach((code) => {
    it(`sets UPSTREAM_UNREACHABLE for ${code}`, () => {
      expect(classifyNetworkError(makeAxiosError({ code, hasResponse: false })).code).toBe('UPSTREAM_UNREACHABLE');
    });
  });

  it('sets NETWORK_ERROR for unknown code', () => {
    expect(classifyNetworkError(makeAxiosError({ code: 'SOMETHING_ELSE', hasResponse: false })).code).toBe('NETWORK_ERROR');
  });

  it('always sets status 503', () => {
    expect(classifyNetworkError(makeAxiosError({ hasResponse: false })).status).toBe(503);
  });
});

describe('isShortCircuitResponse', () => {
  it('returns true for object with numeric status', () => {
    expect(isShortCircuitResponse({ status: 200, data: {} })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isShortCircuitResponse(null)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isShortCircuitResponse({})).toBe(false);
  });

  it('returns false when status is a string', () => {
    expect(isShortCircuitResponse({ status: 'ok' })).toBe(false);
  });
});

describe('buildErrorResponseBody', () => {
  it('includes details when error.data is present', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = Object.assign(new Error('fail'), { code: 'BAD', data: { field: 'email' } });
    expect(buildErrorResponseBody(err).error.details).toEqual({ field: 'email' });
  });

  it('omits details key when error.data is absent', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = Object.assign(new Error('fail'), { code: 'BAD' });
    expect('details' in buildErrorResponseBody(err).error).toBe(false);
  });

  it('defaults message to Internal server error', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = Object.assign(new Error(''), { code: 'X' });
    expect(buildErrorResponseBody(err).error.message).toBe('Internal server error');
  });

  it('defaults code to UNKNOWN_ERROR', () => {
    expect(buildErrorResponseBody(new Error('x')).error.code).toBe('UNKNOWN_ERROR');
  });
});

describe('filterProxyResponseHeaders', () => {
  it('drops content-length (lowercase)', () => {
    expect(filterProxyResponseHeaders({ 'content-length': '100', 'x-custom': 'y' })).not.toHaveProperty('content-length');
  });

  it('drops Content-Length (mixed case)', () => {
    expect(filterProxyResponseHeaders({ 'Content-Length': '100' })).not.toHaveProperty('Content-Length');
  });

  it('keeps other headers', () => {
    expect(filterProxyResponseHeaders({ 'x-custom': 'val' })['x-custom']).toBe('val');
  });

  it('returns empty object for empty input', () => {
    expect(filterProxyResponseHeaders({})).toEqual({});
  });
});
