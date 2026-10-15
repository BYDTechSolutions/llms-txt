import { gunzipSync } from 'node:zlib';
import { LlmsTxtError } from './errors.js';
import { decodeEntities } from './html.js';
import { get, type FetchOptions } from './http.js';

/** One parsed sitemap document. */
export interface ParsedSitemap {
  kind: 'urlset' | 'sitemapindex';
  locs: string[];
}

/**
 * Parses a sitemaps.org XML document with regular expressions: it reads the
 * `<loc>` of each `<url>` or `<sitemap>`. Text sitemaps and feeds are not read.
 */
export function parseSitemap(xml: string): ParsedSitemap {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? 'sitemapindex' : 'urlset';
  const locs: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)) {
    const loc = decodeEntities((m[1] as string).trim());
    if (loc) locs.push(loc);
  }
  return { kind, locs };
}

/** Options for {@link readSitemap}. */
export interface ReadSitemapOptions extends FetchOptions {
  /** How deep to follow sitemap index files. Default `3`. */
  maxDepth?: number;
  /** Stop after reading this many sitemap files. Default `1000`. */
  maxSitemaps?: number;
}

/**
 * Returns every page URL in a sitemap, following sitemap index files and
 * decompressing gzip. Throws `LlmsTxtError` (`SITEMAP`) when the first file
 * cannot be read; a nested file that fails is skipped and reported in `errors`.
 */
export async function readSitemap(url: string, options: ReadSitemapOptions = {}): Promise<{ urls: string[]; errors: string[] }> {
  const maxDepth = options.maxDepth ?? 3;
  const maxSitemaps = options.maxSitemaps ?? 1000;
  const seen = new Set<string>();
  const urls: string[] = [];
  const errors: string[] = [];

  const visit = async (sitemapUrl: string, depth: number): Promise<void> => {
    if (seen.has(sitemapUrl) || seen.size >= maxSitemaps) return;
    seen.add(sitemapUrl);
    let res;
    try {
      res = await get(sitemapUrl, { ...options, accept: 'application/xml, text/xml;q=0.9, */*;q=0.1' });
    } catch (error) {
      if (depth === 0) throw new LlmsTxtError('SITEMAP', (error as Error).message);
      errors.push((error as Error).message);
      return;
    }
    if (!res.ok) {
      const message = `The sitemap ${sitemapUrl} answered HTTP ${res.status}.`;
      if (depth === 0) throw new LlmsTxtError('SITEMAP', message);
      errors.push(message);
      return;
    }
    let raw = res.body;
    if (raw[0] === 0x1f && raw[1] === 0x8b) {
      try {
        raw = gunzipSync(raw);
      } catch {
        const message = `The sitemap ${sitemapUrl} looks gzipped but could not be decompressed.`;
        if (depth === 0) throw new LlmsTxtError('SITEMAP', message);
        errors.push(message);
        return;
      }
    }
    const parsed = parseSitemap(raw.toString('utf8'));
    if (parsed.kind === 'sitemapindex') {
      if (depth >= maxDepth) {
        errors.push(`Sitemap index ${sitemapUrl} is nested deeper than ${maxDepth} levels; not followed.`);
        return;
      }
      for (const loc of parsed.locs) await visit(loc, depth + 1);
    } else {
      urls.push(...parsed.locs);
    }
  };

  await visit(url, 0);
  return { urls, errors };
}
