/**
 * Why an operation stopped.
 *
 * - `CONFIG`: the configuration is missing, cannot be loaded, or is invalid.
 * - `INVALID_URL`: a URL or path could not be turned into an `http(s)` URL.
 * - `SITEMAP`: no sitemap could be read, so there was nothing to crawl.
 * - `FETCH`: a file could not be fetched.
 * - `NO_PAGES`: the crawl found no page it was allowed to read.
 */
export type LlmsTxtErrorCode = 'CONFIG' | 'INVALID_URL' | 'SITEMAP' | 'FETCH' | 'NO_PAGES';

/** An error with a stable `code` and a message written for a person to read. */
export class LlmsTxtError extends Error {
  readonly code: LlmsTxtErrorCode;
  /** Extra lines, such as every problem found in a configuration. */
  readonly details: string[];

  constructor(code: LlmsTxtErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'LlmsTxtError';
    this.code = code;
    this.details = details;
  }
}
