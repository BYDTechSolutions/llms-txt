import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LlmsTxtError } from './errors.js';

/** One entry of an llms.txt file list: `- [title](url): notes`. */
export interface LlmsLink {
  title: string;
  /** An absolute URL, or a path resolved against `site`. */
  url: string;
  /** Optional notes after the link, on one line. */
  notes?: string;
}

/** An H2 section and its file list. */
export interface LlmsSection {
  title: string;
  links: LlmsLink[];
}

/** A rule that puts crawled pages into a section by their path. */
export interface CrawlGroup {
  /** The H2 title. A group titled `Optional` fills the `## Optional` section. */
  title: string;
  /** Path patterns (robots.txt style: prefix match, `*` wildcard, `$` end anchor). */
  match: string | string[];
}

/** How to crawl a site. Every option has a default; `{}` crawls `site` with them. */
export interface CrawlConfig {
  /** Sitemap or sitemap index URL. Default: the robots.txt `Sitemap:` lines, else `<site>/sitemap.xml`. */
  sitemap?: string;
  /** More URLs or paths to crawl, in addition to the sitemap. */
  urls?: string[];
  /** Only crawl paths matching one of these patterns. Default: every path. */
  include?: string[];
  /** Never crawl paths matching one of these patterns. */
  exclude?: string[];
  /** Section rules, tried in order; the first match wins. */
  groups?: CrawlGroup[];
  /** The section for pages no group matches, or `false` to leave them out. Default `"Pages"`. */
  defaultSection?: string | false;
  /** Removed from the end of every page title, e.g. `" | Example"`. */
  titleSuffix?: string;
  /** Product token for robots.txt and the `User-Agent` header. Default `"llms-txt"`. */
  userAgent?: string;
  /** Obey robots.txt. Default `true`. */
  respectRobots?: boolean;
  /** Skip pages with `<meta name="robots" content="noindex">`. Default `true`. */
  respectNoindex?: boolean;
  /** Pages fetched at the same time. Default `4`. */
  concurrency?: number;
  /** Timeout per request, in milliseconds. Default `15000`. */
  timeoutMs?: number;
  /** Stop after this many pages. Default `500`. */
  maxPages?: number;
  /** Write `llms-full.txt` too. Default `true`. */
  full?: boolean;
}

/** The configuration file's shape. */
export interface LlmsTxtConfig {
  /** The H1: the name of the project or site. Required, unless a crawl reads it from the home page. */
  name?: string;
  /** The blockquote: a short summary with the key information needed to understand the rest. */
  summary?: string;
  /** Markdown prose after the summary. Headings are not allowed here by the proposal. */
  details?: string;
  /** H2 sections of links, in order. */
  sections?: LlmsSection[];
  /** Links for the `## Optional` section: secondary information an agent can skip. */
  optional?: LlmsLink[];
  /** The site's origin, e.g. `https://example.com`. Relative link URLs resolve against it; a crawl starts from it. */
  site?: string;
  /** Where `llms-txt build` writes its files. Default `"."`. */
  outDir?: string;
  /** Crawl the site's sitemap and add its pages. */
  crawl?: CrawlConfig;
}

/** Returns the configuration unchanged: it is there for type checking and editor hints. */
export function defineConfig(config: LlmsTxtConfig): LlmsTxtConfig {
  return config;
}

/** File names `llms-txt build` looks for, in this order. */
export const CONFIG_FILES = ['llms-txt.config.mjs', 'llms-txt.config.js', 'llms-txt.config.json'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function checkLink(link: unknown, where: string, problems: string[]): void {
  if (!isObject(link)) {
    problems.push(`${where} must be an object with title and url.`);
    return;
  }
  if (!isString(link.title) || !link.title.trim()) problems.push(`${where}.title must be a non-empty string.`);
  if (!isString(link.url) || !link.url.trim()) problems.push(`${where}.url must be a non-empty string.`);
  if (link.notes !== undefined && !isString(link.notes)) problems.push(`${where}.notes must be a string.`);
}

const NUMBER_OPTIONS = ['concurrency', 'timeoutMs', 'maxPages'] as const;
const STRING_LIST_OPTIONS = ['urls', 'include', 'exclude'] as const;

/** Lists every problem with a configuration, in words. An empty list means it is valid. */
export function validateConfig(config: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(config)) return ['The configuration must be an object.'];
  for (const key of ['name', 'summary', 'details', 'site', 'outDir'] as const) {
    if (config[key] !== undefined && !isString(config[key])) problems.push(`${key} must be a string.`);
  }
  if (config.sections !== undefined) {
    if (!Array.isArray(config.sections)) problems.push('sections must be an array.');
    else
      config.sections.forEach((s, i) => {
        if (!isObject(s)) return problems.push(`sections[${i}] must be an object with title and links.`);
        if (!isString(s.title) || !s.title.trim()) problems.push(`sections[${i}].title must be a non-empty string.`);
        if (!Array.isArray(s.links)) problems.push(`sections[${i}].links must be an array.`);
        else s.links.forEach((l, j) => checkLink(l, `sections[${i}].links[${j}]`, problems));
      });
  }
  if (config.optional !== undefined) {
    if (!Array.isArray(config.optional)) problems.push('optional must be an array of links.');
    else config.optional.forEach((l, j) => checkLink(l, `optional[${j}]`, problems));
  }
  if (isString(config.site)) {
    try {
      const u = new URL(config.site);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') problems.push('site must be an http or https URL.');
    } catch {
      problems.push(`site is not a URL: "${config.site}".`);
    }
  }
  if (config.crawl !== undefined) {
    const c = config.crawl;
    if (!isObject(c)) problems.push('crawl must be an object.');
    else {
      for (const key of NUMBER_OPTIONS) {
        const v = c[key];
        if (v !== undefined && (typeof v !== 'number' || !Number.isInteger(v) || v < 1)) {
          problems.push(`crawl.${key} must be a whole number of at least 1.`);
        }
      }
      for (const key of STRING_LIST_OPTIONS) {
        const v = c[key];
        if (v !== undefined && (!Array.isArray(v) || !v.every(isString))) problems.push(`crawl.${key} must be an array of strings.`);
      }
      for (const key of ['sitemap', 'titleSuffix', 'userAgent'] as const) {
        if (c[key] !== undefined && !isString(c[key])) problems.push(`crawl.${key} must be a string.`);
      }
      for (const key of ['respectRobots', 'respectNoindex', 'full'] as const) {
        if (c[key] !== undefined && typeof c[key] !== 'boolean') problems.push(`crawl.${key} must be true or false.`);
      }
      if (c.defaultSection !== undefined && c.defaultSection !== false && !isString(c.defaultSection)) {
        problems.push('crawl.defaultSection must be a string or false.');
      }
      if (c.groups !== undefined) {
        if (!Array.isArray(c.groups)) problems.push('crawl.groups must be an array.');
        else
          c.groups.forEach((g, i) => {
            if (!isObject(g) || !isString(g.title) || !g.title.trim()) {
              problems.push(`crawl.groups[${i}] needs a non-empty title.`);
              return;
            }
            const m = g.match;
            if (!(isString(m) || (Array.isArray(m) && m.length && m.every(isString)))) {
              problems.push(`crawl.groups[${i}].match must be a path pattern or an array of them.`);
            }
          });
      }
    }
  }
  return problems;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Finds the configuration file in `cwd`, or returns `null`. */
export async function findConfig(cwd: string): Promise<string | null> {
  for (const name of CONFIG_FILES) {
    const file = resolve(cwd, name);
    if (await exists(file)) return file;
  }
  return null;
}

/**
 * Loads and validates a configuration file: `.mjs` / `.js` modules (the
 * default export) or `.json`. Throws `LlmsTxtError` with code `CONFIG`.
 */
export async function loadConfig(file: string): Promise<LlmsTxtConfig> {
  let config: unknown;
  try {
    if (file.endsWith('.json')) {
      config = JSON.parse(await readFile(file, 'utf8'));
    } else {
      const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
      config = mod.default ?? mod;
    }
  } catch (error) {
    throw new LlmsTxtError('CONFIG', `Could not load ${file}: ${(error as Error).message}`);
  }
  const problems = validateConfig(config);
  if (problems.length) throw new LlmsTxtError('CONFIG', `${file} is not a valid configuration.`, problems);
  return config as LlmsTxtConfig;
}
