/**
 * E2E tests — real server subprocesses + real HTTP requests.
 *
 * Each adapter (express, fastify, koa) is spawned as a real child process.
 * Tests send genuine fetch() requests over TCP and assert end-to-end behavior.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures');

/**
 * Running a .ts fixture directly requires Node's native type-stripping,
 * available from Node 22.6 (flagged) and on by default from 23.6.
 * On older runtimes (e.g. Node 20) the e2e suite is skipped — the adapters
 * are still fully covered by the parity + unit suites.
 */
const [major, minor] = process.versions.node.split('.').map(Number);
const SUPPORTS_STRIP_TYPES =
  (major as number) > 22 || ((major as number) === 22 && (minor as number) >= 6);

interface ServerHandle {
  url: string;
  child: ChildProcess;
}

/**
 * Spawn a fixture server script and wait until it prints "READY:<port>".
 * Rejects after 8 seconds if the server never becomes ready.
 */
function spawnServer(script: string, env: Record<string, string> = {}): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const nodeArgs =
      (major as number) >= 24
        ? [join(FIXTURES_DIR, script)]
        : ['--experimental-strip-types', join(FIXTURES_DIR, script)];
    const child = spawn(
      process.execPath,
      nodeArgs,
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: join(__dirname, '..'),
        env: { ...process.env, ...env },
      }
    );

    let stdoutBuf = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Server ${script} did not print READY within 8s`));
    }, 8000);

    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const match = stdoutBuf.match(/READY:(\d+)/);
      if (match) {
        clearTimeout(timer);
        const port = parseInt(match[1]!, 10);
        resolve({ url: `http://127.0.0.1:${port}`, child });
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      // Forward stderr to help debug fixture crashes
      process.stderr.write(`[${script}] ${chunk}`);
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code !== null && code !== 0 && !stdoutBuf.includes('READY')) {
        reject(new Error(`Server ${script} exited with code ${code} (signal: ${signal}) before READY`));
      }
    });
  });
}

/** Terminate a child process gracefully, force-kill after 1 second. */
async function killServer(handle: ServerHandle): Promise<void> {
  return new Promise(resolve => {
    if (handle.child.exitCode !== null) {
      resolve();
      return;
    }
    const forceKill = setTimeout(() => handle.child.kill('SIGKILL'), 1000);
    handle.child.on('exit', () => {
      clearTimeout(forceKill);
      resolve();
    });
    handle.child.kill('SIGTERM');
  });
}

// ---------------------------------------------------------------------------
// Test suites — one per adapter
// ---------------------------------------------------------------------------

type AdapterName = 'express' | 'fastify' | 'koa';

const ADAPTER_SCRIPTS: Record<AdapterName, string> = {
  express: 'express-server.ts',
  fastify: 'fastify-server.ts',
  koa: 'koa-server.ts',
};

for (const [adapterName, script] of Object.entries(ADAPTER_SCRIPTS) as [AdapterName, string][]) {
  describe.skipIf(!SUPPORTS_STRIP_TYPES)(`E2E — ${adapterName}`, () => {
    let server: ServerHandle;

    beforeAll(async () => {
      server = await spawnServer(script);
    }, 10000);

    afterAll(async () => {
      if (server) await killServer(server);
    });

    it('GET /health → 200 { status: "ok" }', async () => {
      const res = await fetch(`${server.url}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.status).toBe('ok');
    });

    it('POST /echo → 201 with echoed body', async () => {
      const res = await fetch(`${server.url}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: 'e2e' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data).toMatchObject({ hello: 'e2e' });
    });

    it('GET /error/400 → 400 with error body', async () => {
      const res = await fetch(`${server.url}/error/400`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      // Proxy forwards upstream 4xx response; body has error.code from core normalisation
      expect(body.error?.code ?? body.error).toBeTruthy();
    });

    it('GET /error/500 → 500 with error body', async () => {
      const res = await fetch(`${server.url}/error/500`);
      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error?.code ?? body.error).toBeTruthy();
    });

    it('GET /slow?delay=200 with no timeout → receives 200 after delay', async () => {
      // This test verifies the proxy does forward slow responses when no timeout
      const res = await fetch(`${server.url}/slow?delay=200`);
      expect(res.status).toBe(200);
    }, 10000);
  });

  describe.skipIf(!SUPPORTS_STRIP_TYPES)(`E2E — ${adapterName} — timeout`, () => {
    let server: ServerHandle;

    beforeAll(async () => {
      // Spawn with a 300ms timeout; upstream /slow?delay=2000 will exceed it
      server = await spawnServer(script, { PROXY_TIMEOUT: '300' });
    }, 10000);

    afterAll(async () => {
      if (server) await killServer(server);
    });

    it('GET /slow?delay=2000 with PROXY_TIMEOUT=300 → 503 UPSTREAM_TIMEOUT', async () => {
      const res = await fetch(`${server.url}/slow?delay=2000`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as any;
      expect(body.error?.code).toBe('UPSTREAM_TIMEOUT');
    }, 10000);
  });
}
