import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export interface MockUpstream {
  url: string;
  close(): Promise<void>;
  resetCounters(): void;
}

export function createMockUpstream(): Promise<MockUpstream> {
  let rateLimitCount = 0;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // GET /health
    if (method === 'GET' && path === '/health') {
      return json(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    }

    // POST /echo — echo back body as { data: <parsed body> }
    if (method === 'POST' && path === '/echo') {
      const raw = await readBody(req);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      return json(res, 201, { data: body });
    }

    // GET /error/400
    if (method === 'GET' && path === '/error/400') {
      return json(res, 400, { error: 'Bad Request', message: 'This is a simulated 400 error' });
    }

    // GET /error/500
    if (method === 'GET' && path === '/error/500') {
      return json(res, 500, {
        error: 'Internal Server Error',
        message: 'This is a simulated 500 error',
      });
    }

    // GET /slow?delay=N — responds after N ms, cancellable on client disconnect
    if (method === 'GET' && path === '/slow') {
      const delayMs = parseInt(url.searchParams.get('delay') ?? '3000', 10);
      const ac = new AbortController();
      req.on('close', () => ac.abort());
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        ac.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
      });
      if (res.writableEnded) return;
      return json(res, 200, { ok: true });
    }

    // GET /headers — echoes received headers
    if (method === 'GET' && path === '/headers') {
      const receivedHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') receivedHeaders[k] = v;
      }
      return json(res, 200, { data: { receivedHeaders } });
    }

    // GET /rate-limit — first 3 requests → 200, then → 429
    if (method === 'GET' && path === '/rate-limit') {
      rateLimitCount++;
      if (rateLimitCount <= 3) {
        return json(res, 200, { ok: true, count: rateLimitCount });
      }
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '60',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
      });
      return res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
    }

    // DELETE /resource or /resource/:id → 204 no content
    if (method === 'DELETE' && path.startsWith('/resource')) {
      res.writeHead(204);
      return res.end();
    }

    // 404 fallback
    return json(res, 404, { error: 'Not Found', message: `Route not found: ${path}` });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://localhost:${port}`,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
        resetCounters: () => {
          rateLimitCount = 0;
        },
      });
    });
    server.once('error', reject);
  });
}
