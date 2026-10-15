/** Options for {@link toResponse}. */
export interface ToResponseInit {
  /** HTTP status. Default `200`. */
  status?: number;
  /** Extra headers. A `Content-Type` here replaces the default. */
  headers?: Record<string, string>;
}

/**
 * Wraps llms.txt text in a web `Response` served as `text/plain; charset=utf-8`,
 * for a route handler in any framework built on the Fetch API (Next.js App
 * Router, Remix, Astro, SvelteKit, Hono, Workers).
 */
export function toResponse(text: string, init: ToResponseInit = {}): Response {
  const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8' });
  for (const [key, value] of Object.entries(init.headers ?? {})) headers.set(key, value);
  return new Response(text, { status: init.status ?? 200, headers });
}
