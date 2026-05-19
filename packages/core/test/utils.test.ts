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
});
