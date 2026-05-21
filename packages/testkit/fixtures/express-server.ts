/**
 * E2E fixture: Express proxy server.
 * Starts a real HTTP server, writes "READY:<port>" to stdout when ready.
 * Designed to be spawned as a child process.
 */
import { createServer } from 'node:http';
import express from 'express';
import multer from 'multer';
import { createProxyController } from '@simple-proxy/express';
import { createMockUpstream } from '../src/mock-upstream.ts';

const upstream = await createMockUpstream();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const upload = multer({ storage: multer.memoryStorage() });
app.use(upload.any());

const timeout = process.env['PROXY_TIMEOUT'] ? parseInt(process.env['PROXY_TIMEOUT'], 10) : undefined;

const proxy = createProxyController({
  baseURL: upstream.url,
  headers: () => ({}),
  ...(timeout !== undefined ? { timeout } : {}),
});

app.all('*', proxy() as any);

const server = createServer(app);
server.listen(0, () => {
  const addr = server.address() as { port: number };
  process.stdout.write(`READY:${addr.port}\n`);
});

process.on('SIGTERM', async () => {
  server.close(() => {});
  await upstream.close();
  process.exit(0);
});
