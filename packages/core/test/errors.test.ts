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

  it('drops CONTENT-LENGTH (uppercase)', () => {
    expect(filterProxyResponseHeaders({ 'CONTENT-LENGTH': '100' })).not.toHaveProperty('CONTENT-LENGTH');
  });

  it('drops Content-LENGTH (mixed case variant)', () => {
    const result = filterProxyResponseHeaders({ 'Content-LENGTH': '100', 'x-foo': 'bar' });
    expect(result).not.toHaveProperty('Content-LENGTH');
    expect(result).toHaveProperty('x-foo', 'bar');
  });

  it('keeps other headers', () => {
    expect(filterProxyResponseHeaders({ 'x-custom': 'val' })['x-custom']).toBe('val');
  });

  it('returns empty object for empty input', () => {
    expect(filterProxyResponseHeaders({})).toEqual({});
  });

  it('keeps multiple non-content-length headers', () => {
    const input = { 'x-req-id': 'abc', 'content-type': 'application/json', 'x-trace': '123' };
    const result = filterProxyResponseHeaders(input);
    expect(result).toHaveProperty('x-req-id', 'abc');
    expect(result).toHaveProperty('content-type', 'application/json');
    expect(result).toHaveProperty('x-trace', '123');
  });

  it('strips entries with undefined values', () => {
    const input = { 'x-good': 'yes', 'x-bad': undefined as unknown as string };
    const result = filterProxyResponseHeaders(input);
    expect(result).toHaveProperty('x-good', 'yes');
    expect(result).not.toHaveProperty('x-bad');
  });
});

describe('classifyResponseError — additional edge cases', () => {
  it('does not set UPSTREAM_AUTH for 400', () => {
    expect(classifyResponseError(makeAxiosError({ responseStatus: 400, responseData: {} })).code).toBeUndefined();
  });

  it('does not set UPSTREAM_AUTH for 500', () => {
    expect(classifyResponseError(makeAxiosError({ responseStatus: 500, responseData: {} })).code).toBeUndefined();
  });

  it('handles null response data without throwing', () => {
    const err = makeAxiosError({ responseStatus: 404, responseData: null });
    const result = classifyResponseError(err);
    expect(result.status).toBe(404);
    expect(result.message).toBe('axios error');
  });

  it('preserves headers for non-auth status', () => {
    const headers = { 'retry-after': '30' };
    const result = classifyResponseError(makeAxiosError({ responseStatus: 429, responseData: {}, responseHeaders: headers }));
    expect(result.headers).toEqual(headers);
  });
});

describe('classifyNetworkError — additional edge cases', () => {
  it('defaults code to NETWORK_ERROR when axiosError.code is undefined', () => {
    const err = makeAxiosError({ hasResponse: false });
    // code not set
    expect(classifyNetworkError(err).code).toBe('NETWORK_ERROR');
  });

  it('always uses literal network error message', () => {
    const err = makeAxiosError({ code: 'ECONNABORTED', hasResponse: false, message: 'something else' });
    expect(classifyNetworkError(err).message).toBe('Network error: No response received');
  });
});

describe('isShortCircuitResponse — additional edge cases', () => {
  it('returns false for undefined', () => {
    expect(isShortCircuitResponse(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isShortCircuitResponse('ok')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isShortCircuitResponse(42)).toBe(false);
  });

  it('returns false for an array', () => {
    expect(isShortCircuitResponse([])).toBe(false);
  });

  it('returns false for a boolean', () => {
    expect(isShortCircuitResponse(true)).toBe(false);
  });

  it('returns true when status is 0', () => {
    expect(isShortCircuitResponse({ status: 0, data: null })).toBe(true);
  });

  it('returns true for status 404', () => {
    expect(isShortCircuitResponse({ status: 404, data: 'not found' })).toBe(true);
  });
});

describe('buildErrorResponseBody — additional edge cases', () => {
  it('does not include details when data is null', () => {
    const err: any = Object.assign(new Error('fail'), { code: 'X', data: null });
    expect('details' in buildErrorResponseBody(err).error).toBe(false);
  });

  it('does not include details when data is 0 (falsy)', () => {
    const err: any = Object.assign(new Error('fail'), { code: 'X', data: 0 });
    expect('details' in buildErrorResponseBody(err).error).toBe(false);
  });

  it('does not include details when data is empty string (falsy)', () => {
    const err: any = Object.assign(new Error('fail'), { code: 'X', data: '' });
    expect('details' in buildErrorResponseBody(err).error).toBe(false);
  });

  it('includes details when data is empty array (truthy)', () => {
    const err: any = Object.assign(new Error('fail'), { code: 'X', data: [] });
    expect(buildErrorResponseBody(err).error.details).toEqual([]);
  });

  it('preserves message when present', () => {
    const err: any = Object.assign(new Error('real message'), { code: 'X' });
    expect(buildErrorResponseBody(err).error.message).toBe('real message');
  });
});
