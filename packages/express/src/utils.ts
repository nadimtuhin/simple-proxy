import { Response, NextFunction } from 'express';
import FormData from 'form-data';
import {
  urlJoin,
  replaceUrlTemplate,
  buildQueryString,
  parseSize,
  resolveProxyPath,
  createFormDataPayload as coreCreateFormDataPayload,
  generateCurlCommand as coreGenerateCurlCommand,
} from '@nadimtuhin/simple-proxy-core';
import type { CurlCommandOptions, FileUpload } from '@nadimtuhin/simple-proxy-core';
import type { RequestWithLocals, RequestWithFiles } from './types.js';

export { urlJoin, replaceUrlTemplate, buildQueryString, parseSize, resolveProxyPath };

function getRequestFiles(req: RequestWithFiles | undefined): FileUpload[] {
  if (!req) return [];
  if (req.files) {
    return Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
  }
  return req.file ? [req.file] : [];
}

/** Express-compatible wrapper — accepts RequestWithFiles for multer integration */
export function createFormDataPayload(req: RequestWithFiles): FormData {
  return coreCreateFormDataPayload({
    body: req.body,
    files: getRequestFiles(req),
  });
}

/** Express-compatible wrapper — second arg accepts RequestWithFiles */
export function generateCurlCommand(payload: CurlCommandOptions, req?: RequestWithFiles): string {
  return coreGenerateCurlCommand(
    payload,
    req ? { body: req.body, files: getRequestFiles(req) } : undefined
  );
}

export function asyncWrapper(
  fn: (req: RequestWithLocals, res: Response, next?: NextFunction) => Promise<void>
): (req: RequestWithFiles, res: Response, next: NextFunction) => Promise<void> {
  return async (req: RequestWithFiles, res: Response, next: NextFunction) => {
    try {
      await fn(req as RequestWithLocals, res, next);
    } catch (error) {
      next(error);
    }
  };
}
