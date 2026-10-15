import { LlmsTxtError } from './errors.js';

/** Options shared by everything that makes a request. */
export interface FetchOptions {
  /** A `fetch` to use instead of the global one. */
  fetch?: typeof fetch;
  /** Timeout per request, in milliseconds. */
  timeoutMs?: number;
  /** The `User-Agent` header. */
  userAgent?: string;
}

/** A fetched response, read in full. */
export interface Fetched {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: Buffer;
}

/** GETs a URL and reads the body. Network errors and timeouts throw `LlmsTxtError` (`FETCH`). */
export async function get(url: string, options: FetchOptions & { accept?: string; method?: string } = {}): Promise<Fetched> {
  const doFetch = options.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(url, {
      method: options.method ?? 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': options.userAgent ?? '',
        Accept: options.accept ?? '*/*',
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    const body = options.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
    return {
      url: response.url || url,
      status: response.status,
      ok: response.ok,
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      body,
    };
  } catch (error) {
    const err = error as Error;
    const reason = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? `timed out after ${options.timeoutMs ?? 15_000} ms`
      : err.message;
    throw new LlmsTxtError('FETCH', `Could not fetch ${url}: ${reason}`);
  }
}

/** Runs `task` over `items` with at most `limit` running at once; results keep the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
