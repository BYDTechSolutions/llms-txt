import { build, buildFull, normalizeSections, type FullPage } from './build.js';
import type { CrawlConfig, LlmsLink, LlmsSection, LlmsTxtConfig } from './config.js';
import { LlmsTxtError } from './errors.js';
import { extractPage, type ExtractedPage } from './extract.js';
import { get, mapLimit } from './http.js';
import { isAllowed, matchPath, parseRobots, type RobotsTxt } from './robots.js';
import { readSitemap } from './sitemap.js';
import { PRODUCT_TOKEN, userAgentFor } from './version.js';

/** Options for {@link crawl}: the crawl settings plus the parts of the file a crawl does not discover. */
export interface CrawlOptions extends CrawlConfig, Pick<LlmsTxtConfig, 'name' | 'summary' | 'details' | 'sections' | 'optional'> {
  /** The site's origin, e.g. `https://example.com`. Only pages on this origin are crawled. */
  site: string;
  /** A `fetch` to use instead of the global one. */
  fetch?: typeof fetch;
  /** Called after each page is read or skipped, for progress output. */
  onPage?: (event: { url: string; done: number; total: number; skipped?: string }) => void;
}

/** A page the crawl read. */
export interface CrawledPage {
  url: string;
  title: string;
  description: string;
  /** The content as Markdown, headings shifted two levels down (an `<h1>` is `###`). */
  markdown: string;
  /** The section it was put in, or `null` when no group matched and `defaultSection` is `false`. */
  section: string | null;
}

/** Why a URL was not included. */
export type SkipReason =
  | 'other-host'
  | 'excluded'
  | 'robots'
  | 'max-pages'
  | 'http-error'
  | 'fetch-error'
  | 'not-html'
  | 'noindex'
  | 'duplicate';

/** A URL the crawl did not include, and why. */
export interface SkippedPage {
  url: string;
  reason: SkipReason;
  detail: string;
}

/** What {@link crawl} returns. */
export interface CrawlResult {
  /** The H1 used: the `name` option, else the home page's `og:site_name` or title. */
  name: string;
  /** The summary used: the `summary` option, else the home page's description. */
  summary: string;
  /** Pages read, in sitemap order. */
  pages: CrawledPage[];
  skipped: SkippedPage[];
  /** The sections of the generated llms.txt, `Optional` last. */
  sections: LlmsSection[];
  /** The sitemaps read. */
  sitemaps: string[];
  /** How robots.txt was handled. */
  robots: { url: string; status: 'ok' | 'missing' | 'ignored' };
  /** Problems that did not stop the crawl, such as a nested sitemap that failed. */
  warnings: string[];
  /** The generated llms.txt. */
  llmsTxt: string;
  /** The generated llms-full.txt. */
  llmsFullTxt: string;
}

const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/;

function parseOrigin(site: string): URL {
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    throw new LlmsTxtError('INVALID_URL', `The site is not a URL: "${site}". Use an origin such as https://example.com.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LlmsTxtError('INVALID_URL', `The site must be http or https: "${site}".`);
  }
  return new URL(url.origin);
}

function normalize(url: string, base: URL): string | null {
  try {
    const u = new URL(url.trim(), base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

async function loadRobots(origin: URL, options: CrawlOptions, userAgent: string): Promise<{ robots: RobotsTxt | null; status: CrawlResult['robots']['status'] }> {
  const url = new URL('/robots.txt', origin).href;
  const respect = options.respectRobots ?? true;
  let res;
  try {
    res = await get(url, { fetch: options.fetch, timeoutMs: options.timeoutMs, userAgent, accept: 'text/plain' });
  } catch (error) {
    if (!respect) return { robots: null, status: 'ignored' };
    throw new LlmsTxtError(
      'FETCH',
      `${(error as Error).message}. RFC 9309 says to treat an unreachable robots.txt as disallowing everything, so nothing was crawled. Set respectRobots: false (--ignore-robots) to crawl anyway.`,
    );
  }
  if (res.status >= 500) {
    if (!respect) return { robots: null, status: 'ignored' };
    throw new LlmsTxtError(
      'FETCH',
      `${url} answered HTTP ${res.status}. RFC 9309 says to treat an unreachable robots.txt as disallowing everything, so nothing was crawled. Set respectRobots: false (--ignore-robots) to crawl anyway.`,
    );
  }
  if (!res.ok) return { robots: null, status: 'missing' };
  const robots = parseRobots(res.body.toString('utf8'));
  return { robots, status: respect ? 'ok' : 'ignored' };
}

function stripSuffix(title: string, suffix: string | undefined): string {
  if (suffix && title.endsWith(suffix) && title.length > suffix.length) return title.slice(0, -suffix.length).trim();
  return title;
}

function sectionFor(path: string, options: CrawlOptions): string | null {
  for (const group of options.groups ?? []) {
    const patterns = Array.isArray(group.match) ? group.match : [group.match];
    if (patterns.some((p) => matchPath(p, path))) return group.title;
  }
  const fallback = options.defaultSection ?? 'Pages';
  return fallback === false ? null : fallback;
}

/**
 * Crawls a site from its sitemap and returns its pages as Markdown, grouped
 * into sections, with `llmsTxt` and `llmsFullTxt` ready to write.
 *
 * Reads `/robots.txt` first (for its rules and `Sitemap:` lines), then the
 * sitemap, then each allowed page on the site's origin, at most
 * `concurrency` at a time. Throws `LlmsTxtError`: `INVALID_URL` for a bad
 * site, `SITEMAP` when no sitemap could be read and no `urls` were given,
 * `FETCH` when robots.txt is unreachable, `NO_PAGES` when nothing could be
 * read, `CONFIG` when no name was given or found.
 */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const origin = parseOrigin(options.site);
  const token = options.userAgent ?? PRODUCT_TOKEN;
  const userAgent = userAgentFor(token);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const concurrency = options.concurrency ?? 4;
  const maxPages = options.maxPages ?? 500;
  const respectRobots = options.respectRobots ?? true;
  const respectNoindex = options.respectNoindex ?? true;
  const fetchOptions = { fetch: options.fetch, timeoutMs, userAgent };
  const warnings: string[] = [];
  const skipped: SkippedPage[] = [];

  const { robots, status: robotsStatus } = await loadRobots(origin, options, userAgent);

  // Sitemaps: the one given, else those robots.txt lists, else /sitemap.xml.
  const sitemaps = options.sitemap
    ? [new URL(options.sitemap, origin).href]
    : robots?.sitemaps.length
      ? robots.sitemaps
      : [new URL('/sitemap.xml', origin).href];
  const found: string[] = [];
  const sitemapErrors: string[] = [];
  for (const sitemap of sitemaps) {
    try {
      const result = await readSitemap(sitemap, fetchOptions);
      found.push(...result.urls);
      warnings.push(...result.errors);
    } catch (error) {
      sitemapErrors.push((error as Error).message);
    }
  }
  const extra = options.urls ?? [];
  if (sitemapErrors.length === sitemaps.length && !extra.length) {
    throw new LlmsTxtError('SITEMAP', `No sitemap could be read. ${sitemapErrors.join(' ')}`, sitemapErrors);
  }
  warnings.push(...sitemapErrors);

  // Candidates, in order, de-duplicated, filtered.
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const raw of [...found, ...extra]) {
    const url = normalize(raw, origin);
    if (!url) {
      warnings.push(`Not a URL, skipped: "${raw}".`);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    if (new URL(url).origin !== origin.origin) {
      skipped.push({ url, reason: 'other-host', detail: `not on ${origin.origin}` });
      continue;
    }
    const path = pathOf(url);
    if (options.include?.length && !options.include.some((p) => matchPath(p, path))) {
      skipped.push({ url, reason: 'excluded', detail: 'matches no include pattern' });
      continue;
    }
    const excludedBy = options.exclude?.find((p) => matchPath(p, path));
    if (excludedBy) {
      skipped.push({ url, reason: 'excluded', detail: `matches exclude pattern ${excludedBy}` });
      continue;
    }
    if (respectRobots && robots && !isAllowed(robots, path, token)) {
      skipped.push({ url, reason: 'robots', detail: `robots.txt disallows it for ${token}` });
      continue;
    }
    if (queue.length >= maxPages) {
      skipped.push({ url, reason: 'max-pages', detail: `over the limit of ${maxPages} pages` });
      continue;
    }
    queue.push(url);
  }

  type Read = { url: string; page: ExtractedPage } | { skip: SkippedPage };
  let done = 0;
  const readPage = async (url: string): Promise<Read> => {
    const result = await (async (): Promise<Read> => {
      let res;
      try {
        res = await get(url, { ...fetchOptions, accept: 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1' });
      } catch (error) {
        return { skip: { url, reason: 'fetch-error', detail: (error as Error).message } };
      }
      const finalUrl = normalize(res.url, origin) ?? url;
      if (new URL(finalUrl).origin !== origin.origin) {
        return { skip: { url, reason: 'other-host', detail: `redirected to ${finalUrl}` } };
      }
      if (!res.ok) return { skip: { url, reason: 'http-error', detail: `HTTP ${res.status}` } };
      if (!HTML_TYPES.test(res.contentType)) {
        return { skip: { url, reason: 'not-html', detail: res.contentType || 'no content type' } };
      }
      const page = extractPage(res.body.toString('utf8'), { url: finalUrl, headingOffset: 2 });
      if (respectNoindex && page.noindex) return { skip: { url, reason: 'noindex', detail: 'the page asks not to be indexed' } };
      return { url: finalUrl, page };
    })();
    done += 1;
    options.onPage?.({ url, done, total: queue.length, skipped: 'skip' in result ? result.skip.reason : undefined });
    return result;
  };
  const reads = await mapLimit(queue, concurrency, readPage);

  const pages: CrawledPage[] = [];
  const byUrl = new Set<string>();
  let home: ExtractedPage | undefined;
  for (const read of reads) {
    if ('skip' in read) {
      skipped.push(read.skip);
      continue;
    }
    if (byUrl.has(read.url)) {
      skipped.push({ url: read.url, reason: 'duplicate', detail: 'another URL redirected to the same page' });
      continue;
    }
    byUrl.add(read.url);
    if (new URL(read.url).pathname === '/') home = read.page;
    const title = stripSuffix(read.page.title, options.titleSuffix) || new URL(read.url).pathname;
    pages.push({
      url: read.url,
      title,
      description: read.page.description,
      markdown: read.page.markdown,
      section: sectionFor(pathOf(read.url), options),
    });
  }

  if (!pages.length) {
    throw new LlmsTxtError(
      'NO_PAGES',
      `No page could be read from ${origin.origin}: ${queue.length} fetched, ${skipped.length} skipped.`,
      skipped.slice(0, 20).map((s) => `${s.url}: ${s.reason} (${s.detail})`),
    );
  }

  // The name and summary, from the options or the home page.
  if ((!options.name || options.summary === undefined) && !home) {
    try {
      const res = await get(origin.href, { ...fetchOptions, accept: 'text/html' });
      if (res.ok && HTML_TYPES.test(res.contentType)) home = extractPage(res.body.toString('utf8'), { url: origin.href });
    } catch {
      // the name check below reports it
    }
  }
  const name = options.name?.trim() || home?.siteName || (home ? stripSuffix(home.title, options.titleSuffix) : '');
  if (!name) {
    throw new LlmsTxtError('CONFIG', 'No name for the H1: set name in the configuration (or --name); the home page has no title.');
  }
  const summary = options.summary ?? home?.description ?? '';

  // Sections: configured ones first, then crawled groups in the order their first page appears.
  const crawled = new Map<string, LlmsLink[]>();
  for (const group of options.groups ?? []) crawled.set(group.title, []);
  for (const page of pages) {
    if (page.section === null) continue;
    const links = crawled.get(page.section) ?? [];
    links.push({ title: page.title, url: page.url, notes: page.description || undefined });
    crawled.set(page.section, links);
  }
  const sections = normalizeSections(
    [...(options.sections ?? []), ...[...crawled].map(([title, links]) => ({ title, links }))],
    options.optional ?? [],
  );

  const llmsTxt = build({ name, summary, details: options.details, sections, site: origin.origin });

  // llms-full.txt follows the llms.txt order, Optional pages last, then pages left out of every section.
  const order = new Map<string, number>();
  sections.forEach((s, i) => s.links.forEach((l, j) => order.set(l.url, i * 100_000 + j)));
  const fullPages: FullPage[] = [...pages]
    .map((p, i) => ({ p, rank: order.get(p.url) ?? Number.MAX_SAFE_INTEGER - pages.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ p }) => ({ url: p.url, title: p.title, description: p.description, markdown: p.markdown }));
  const llmsFullTxt = buildFull({ name, summary, details: options.details }, fullPages);

  return {
    name,
    summary,
    pages,
    skipped,
    sections,
    sitemaps,
    robots: { url: new URL('/robots.txt', origin).href, status: robotsStatus },
    warnings,
    llmsTxt,
    llmsFullTxt,
  };
}

