import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliIo } from '../src/commands.js';

export interface Recorded {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Wait this long before answering. */
  delayMs?: number;
}

export type Handler = (req: Recorded) => Reply | undefined;

export interface TestServer {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  requests: Recorded[];
  routes: Map<string, Reply | Handler>;
  /** The most requests that were in flight at once. */
  maxInFlight: () => number;
  close: () => Promise<void>;
}

export const html = (body: string, head = '') =>
  ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: `<!doctype html><html><head>${head}</head><body>${body}</body></html>` }) satisfies Reply;

export const text = (body: string, type = 'text/plain; charset=utf-8') => ({ headers: { 'content-type': type }, body }) satisfies Reply;

/** A local server standing in for a whole site. */
export async function startServer(routes: Record<string, Reply | Handler> = {}): Promise<TestServer> {
  const map = new Map<string, Reply | Handler>(Object.entries(routes));
  const requests: Recorded[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const server: Server = createServer((req, res) => {
    const recorded: Recorded = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers };
    requests.push(recorded);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const route = map.get(recorded.path) ?? map.get(recorded.path.split('?')[0] as string);
    const reply = typeof route === 'function' ? route(recorded) : route;
    const send = () => {
      inFlight -= 1;
      if (!reply) {
        res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
        return;
      }
      res.writeHead(reply.status ?? 200, reply.headers ?? {});
      res.end(recorded.method === 'HEAD' ? undefined : (reply.body ?? ''));
    };
    if (reply?.delayMs) setTimeout(send, reply.delayMs);
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    routes: map,
    maxInFlight: () => maxInFlight,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

export function urlset(urls: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
}

export function sitemapIndex(urls: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <sitemap><loc>${u}</loc></sitemap>`).join('\n')}
</sitemapindex>`;
}

export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'llms-txt-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export interface CapturedIo extends CliIo {
  out: () => string;
  err: () => string;
}

export function captureIo(overrides: Partial<CliIo> & { stdinText?: string } = {}): CapturedIo {
  let out = '';
  let err = '';
  const { stdinText, ...rest } = overrides;
  return {
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    readStdin: async () => stdinText ?? '',
    cwd: process.cwd(),
    ...rest,
    out: () => out,
    err: () => err,
  };
}
