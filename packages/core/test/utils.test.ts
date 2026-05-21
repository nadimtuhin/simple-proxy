import { describe, it, expect, vi } from 'vitest';
import FormData from 'form-data';
import {
  urlJoin,
  replaceUrlTemplate,
  buildQueryString,
  createFormDataPayload,
  generateCurlCommand,
  parseSize,
  resolveProxyPath,
} from '../src/utils.js';
import type { FileUpload } from '../src/types.js';

describe('parseSize', () => {
  it("parses '42' to 42", () => expect(parseSize('42')).toBe(42));
  it("parses '0' to 0", () => expect(parseSize('0')).toBe(0));
  it("returns undefined for 'abc'", () => expect(parseSize('abc')).toBeUndefined());
  it('returns undefined for empty string', () => expect(parseSize('')).toBeUndefined());
  it('returns undefined for undefined', () => expect(parseSize(undefined)).toBeUndefined());
});

describe('resolveProxyPath', () => {
  it('substitutes params when proxyPath is provided', () => {
    expect(resolveProxyPath('/users/:id', '/ignored', { id: '5' })).toBe('/users/5');
  });

  it('returns reqPath when proxyPath is undefined', () => {
    expect(resolveProxyPath(undefined, '/current', {})).toBe('/current');
  });

  it('substitutes multiple params', () => {
    expect(resolveProxyPath('/orgs/:org/repos/:repo', '/ignored', { org: 'acme', repo: 'widget' })).toBe('/orgs/acme/repos/widget');
  });
});

describe('urlJoin', () => {
  it('joins URL parts', () => {
    expect(urlJoin('http://example.com', 'api', 'users')).toBe('http://example.com/api/users');
  });

  it('handles trailing slashes', () => {
    expect(urlJoin('http://example.com/', '/api/', '/users/')).toBe('http://example.com/api/users');
  });

  it('handles query strings', () => {
    expect(urlJoin('http://example.com', 'api', '?page=1')).toBe('http://example.com/api?page=1');
  });

  it('handles empty parts', () => {
    expect(urlJoin('http://example.com', '', 'api')).toBe('http://example.com/api');
  });
});

describe('replaceUrlTemplate', () => {
  it('replaces single param', () => {
    expect(replaceUrlTemplate('/users/:id', { id: 123 })).toBe('/users/123');
  });

  it('replaces multiple params', () => {
    expect(replaceUrlTemplate('/users/:userId/posts/:postId', { userId: 1, postId: 2 })).toBe('/users/1/posts/2');
  });

  it('returns url unchanged when no params', () => {
    expect(replaceUrlTemplate('/static', {})).toBe('/static');
  });
});

describe('buildQueryString', () => {
  it('builds query string', () => {
    expect(buildQueryString({ page: '1', limit: '10' })).toBe('?page=1&limit=10');
  });

  it('handles array values', () => {
    expect(buildQueryString({ tags: ['red', 'blue'] })).toBe('?tags=red&tags=blue');
  });

  it('returns empty string for empty object', () => {
    expect(buildQueryString({})).toBe('');
  });

  it('skips undefined values', () => {
    expect(buildQueryString({ page: '1', limit: undefined })).toBe('?page=1');
  });
});

describe('createFormDataPayload', () => {
  it('creates FormData from body', () => {
    const fd = createFormDataPayload({ body: { name: 'John', email: 'j@j.com' } });
    expect(fd).toBeInstanceOf(FormData);
  });

  it('handles files', () => {
    const files: FileUpload[] = [{
      fieldname: 'avatar',
      originalname: 'avatar.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('img'),
      size: 3,
    }];
    const fd = createFormDataPayload({ body: { name: 'John' }, files });
    const serialised = fd.getBuffer().toString();
    expect(serialised).toContain('avatar.jpg');
  });

  it('handles array body values', () => {
    const fd = createFormDataPayload({ body: { tags: ['a', 'b'] } });
    expect(fd).toBeInstanceOf(FormData);
  });

  it('handles empty input', () => {
    expect(createFormDataPayload({})).toBeInstanceOf(FormData);
  });
});

describe('generateCurlCommand', () => {
  it('generates basic GET command', () => {
    expect(generateCurlCommand({ url: 'http://x.com', method: 'GET', headers: { Authorization: 'Bearer t' } }))
      .toBe("curl -X GET 'http://x.com' -H 'Authorization: Bearer t'");
  });

  it('includes JSON data', () => {
    const result = generateCurlCommand({
      url: 'http://x.com',
      method: 'POST',
      headers: {},
      data: '{"a":1}',
    });
    expect(result).toContain("-d '{\"a\":1}'");
  });

  it('includes FormData fields and files', () => {
    const result = generateCurlCommand(
      { url: 'http://x.com/upload', method: 'POST', headers: {}, data: new FormData() },
      { body: { name: 'Jo' }, files: [{ fieldname: 'f', originalname: 'img.jpg', encoding: '7bit', mimetype: 'image/jpeg', buffer: Buffer.from(''), size: 0 }] }
    );
    expect(result).toContain("-F 'name=Jo'");
    expect(result).toContain("-F 'f=@img.jpg'");
  });

  it('calls logger with the command', () => {
    const logger = vi.fn();
    const cmd = generateCurlCommand({ url: 'http://x.com', method: 'GET', headers: {} }, undefined, logger);
    expect(logger).toHaveBeenCalledWith(cmd);
  });

  it('marks binary data as placeholder', () => {
    expect(generateCurlCommand({ url: 'http://x.com', method: 'POST', headers: {}, data: Buffer.from('x') }))
      .toContain("-d '<binary-data>'");
  });

  it('generates command with no headers when headers object is empty', () => {
    const result = generateCurlCommand({ url: 'http://x.com', method: 'GET', headers: {} });
    expect(result).toBe("curl -X GET 'http://x.com'");
  });

  it('skips content-type header when data is FormData', () => {
    const result = generateCurlCommand(
      { url: 'http://x.com', method: 'POST', headers: { 'content-type': 'multipart/form-data', 'x-foo': 'bar' }, data: new FormData() },
      {}
    );
    expect(result).not.toContain('content-type');
    expect(result).toContain("-H 'x-foo: bar'");
  });

  it('handles array body values in FormData curl representation', () => {
    const result = generateCurlCommand(
      { url: 'http://x.com', method: 'POST', headers: {}, data: new FormData() },
      { body: { tags: ['a', 'b'] } }
    );
    expect(result).toContain("-F 'tags=a'");
    expect(result).toContain("-F 'tags=b'");
  });

  it('generates command with no data section when data is undefined', () => {
    const result = generateCurlCommand({ url: 'http://x.com', method: 'GET', headers: { 'x-k': 'v' } });
    expect(result).not.toContain('-d');
    expect(result).not.toContain('-F');
  });
});

describe('parseSize — additional edge cases', () => {
  it('returns integer part for decimal string', () => {
    expect(parseSize('1.5')).toBe(1);
  });

  it('handles negative numbers', () => {
    expect(parseSize('-5')).toBe(-5);
  });

  it('handles leading whitespace', () => {
    expect(parseSize('  42')).toBe(42);
  });

  it('handles very large integer string', () => {
    expect(parseSize('1000000')).toBe(1000000);
  });
});

describe('urlJoin — additional edge cases', () => {
  it('returns empty string for zero parts', () => {
    expect(urlJoin()).toBe('');
  });

  it('handles only a query string part', () => {
    expect(urlJoin('?x=1')).toBe('?x=1');
  });

  it('handles single base URL', () => {
    expect(urlJoin('http://example.com')).toBe('http://example.com');
  });

  it('strips trailing slash from single base', () => {
    expect(urlJoin('http://example.com/')).toBe('http://example.com');
  });

  it('handles base with path and query', () => {
    expect(urlJoin('http://example.com/api', '?q=1')).toBe('http://example.com/api?q=1');
  });
});

describe('buildQueryString — additional edge cases', () => {
  it('encodes space characters in values', () => {
    const result = buildQueryString({ q: 'hello world' });
    // URLSearchParams uses + for spaces in application/x-www-form-urlencoded
    expect(result).toMatch(/^\?(q=hello\+world|q=hello%20world)$/);
  });

  it('preserves empty string value', () => {
    const result = buildQueryString({ page: '', limit: '10' });
    expect(result).toContain('page=');
    expect(result).toContain('limit=10');
  });

  it('handles single key-value pair', () => {
    expect(buildQueryString({ count: '5' })).toBe('?count=5');
  });

  it('returns empty string for all-undefined values', () => {
    const result = buildQueryString({ a: undefined, b: undefined });
    expect(result).toBe('');
  });
});

describe('replaceUrlTemplate — additional edge cases', () => {
  it('replaces same param appearing multiple times', () => {
    expect(replaceUrlTemplate('/a/:id/b/:id', { id: '9' })).toBe('/a/9/b/9');
  });

  it('leaves unmatched placeholders in url', () => {
    expect(replaceUrlTemplate('/users/:id', { foo: 'bar' })).toBe('/users/:id');
  });

  it('coerces numeric variable values to string', () => {
    expect(replaceUrlTemplate('/users/:id', { id: 42 })).toBe('/users/42');
  });

  it('returns url unchanged when variables is empty', () => {
    expect(replaceUrlTemplate('/static/page', {})).toBe('/static/page');
  });

  // Bug surfacing test: `:id` regex matches inside `:idCard` — known partial-match issue
  // The regex /:id/g matches :id as a substring of :idCard when `id` key is processed first.
  // When keys are processed in insertion order (id before idCard), result is '/users/9Card' not '/users/CARD-42'.
  // This test documents current (buggy) actual behavior to make the issue visible.
  it('exposes regex collision: :id is replaced inside :idCard when id key is ordered first', () => {
    // Object key order: id first, idCard second — id replacement clobbers part of :idCard
    const result = replaceUrlTemplate('/users/:idCard', { id: '9', idCard: 'CARD-42' });
    // KNOWN BUG: should be '/users/CARD-42' but is '/users/9Card' due to greedy substring regex
    expect(result).toBe('/users/9Card');
  });
});

describe('resolveProxyPath — additional edge cases', () => {
  it('falls back to reqPath when proxyPath is empty string (falsy)', () => {
    expect(resolveProxyPath('', '/actual-path', {})).toBe('/actual-path');
  });

  it('uses proxyPath verbatim when no placeholders match', () => {
    expect(resolveProxyPath('/fixed/path', '/other', {})).toBe('/fixed/path');
  });
});

describe('createFormDataPayload — additional edge cases', () => {
  it('skips null body values', () => {
    const fd = createFormDataPayload({ body: { nullfield: null as unknown as string, age: '30' } });
    const buf = fd.getBuffer().toString();
    expect(buf).not.toContain('nullfield');
    expect(buf).toContain('"age"');
  });

  it('skips undefined body values', () => {
    const fd = createFormDataPayload({ body: { undeffield: undefined as unknown as string, age: '30' } });
    const buf = fd.getBuffer().toString();
    expect(buf).not.toContain('undeffield');
    expect(buf).toContain('"age"');
  });

  it('handles only files with no body', () => {
    const files: FileUpload[] = [{
      fieldname: 'doc',
      originalname: 'file.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from('pdf-content'),
      size: 11,
    }];
    const fd = createFormDataPayload({ files });
    const buf = fd.getBuffer().toString();
    expect(buf).toContain('file.pdf');
  });
});
