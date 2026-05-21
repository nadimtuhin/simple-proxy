import { URLSearchParams } from 'url';
import FormData from 'form-data';
import { UrlVariables, FileUpload, CurlCommandOptions } from './types.js';

export function parseSize(contentLength: string | undefined): number | undefined {
  if (!contentLength) return undefined;
  const n = parseInt(contentLength, 10);
  return isNaN(n) ? undefined : n;
}

export function resolveProxyPath(
  proxyPath: string | undefined,
  reqPath: string,
  params: Record<string, string>
): string {
  return proxyPath ? replaceUrlTemplate(proxyPath, params) : reqPath;
}

export function urlJoin(...parts: string[]): string {
  const filteredParts = parts.filter((part) => part && part.length > 0);
  if (filteredParts.length === 0) return '';

  const lastPart = filteredParts[filteredParts.length - 1] as string;
  const hasQuerySuffix = lastPart.startsWith('?');
  const pathParts = hasQuerySuffix ? filteredParts.slice(0, -1) : filteredParts;

  if (pathParts.length === 0) return lastPart;

  const pathJoined = pathParts
    .map((part, index) => {
      if (index === 0) return part.replace(/\/+$/, '');
      return part.replace(/^\/+/, '').replace(/\/+$/, '');
    })
    .join('/');

  return hasQuerySuffix ? pathJoined + lastPart : pathJoined;
}

export function replaceUrlTemplate(url: string, urlVariables: UrlVariables): string {
  return Object.keys(urlVariables).reduce((result, placeholder) => {
    return result.replace(new RegExp(`:${placeholder}(?![a-zA-Z0-9_])`, 'g'), String(urlVariables[placeholder]));
  }, url);
}

export function buildQueryString(query: Record<string, string | string[] | undefined>): string {
  if (!query || Object.keys(query).length === 0) return '';

  const params = new URLSearchParams();
  Object.keys(query).forEach((key) => {
    const value = query[key];
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

export interface FormDataInput {
  body?: Record<string, unknown>;
  files?: FileUpload[];
}

export function createFormDataPayload(input: FormDataInput): FormData {
  const fd = new FormData();

  if (input.body) {
    Object.keys(input.body).forEach((key) => {
      const value = (input.body as Record<string, unknown>)[key];
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((v) => fd.append(key, String(v)));
        } else {
          fd.append(key, String(value));
        }
      }
    });
  }

  (input.files ?? []).forEach((file) => {
    fd.append(file.fieldname, file.buffer, {
      contentType: file.mimetype,
      filename: file.originalname,
    });
  });

  return fd;
}

export function generateCurlCommand(
  payload: CurlCommandOptions,
  requestData?: FormDataInput,
  logger?: (msg: string) => void
): string {
  const { url, method, headers, data } = payload;

  let cmd = `curl -X ${method} '${url}'`;

  if (headers && Object.keys(headers).length > 0) {
    Object.keys(headers).forEach((key) => {
      if (!(data instanceof FormData && key.toLowerCase() === 'content-type')) {
        cmd += ` -H '${key}: ${headers[key]}'`;
      }
    });
  }

  if (data) {
    if (typeof data === 'string') {
      cmd += ` -d '${data}'`;
    } else if (data instanceof FormData) {
      const formFields: string[] = [];

      if (requestData?.body) {
        Object.keys(requestData.body).forEach((key) => {
          const value = (requestData.body as Record<string, unknown>)[key];
          if (Array.isArray(value)) {
            value.forEach((v) => formFields.push(`-F '${key}=${v}'`));
          } else {
            formFields.push(`-F '${key}=${value}'`);
          }
        });
      }

      (requestData?.files ?? []).forEach((file) => {
        formFields.push(`-F '${file.fieldname}=@${file.originalname}'`);
      });

      cmd += ` ${formFields.join(' ')}`;
    } else {
      cmd += ` -d '<binary-data>'`;
    }
  }

  if (logger) logger(cmd);
  return cmd;
}
