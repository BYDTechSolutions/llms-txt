import { findAll, findFirst, parseHtml, removeAll, textContent, type HtmlElement } from './html.js';
import { htmlToMarkdown, type HtmlToMarkdownOptions } from './markdown.js';

/** What {@link extractPage} found in one HTML page. */
export interface ExtractedPage {
  /** `<title>`, else `og:title`, else the first `<h1>`. Empty when none is set. */
  title: string;
  /** `<meta name="description">`, else `og:description`. Empty when none is set. */
  description: string;
  /** `og:site_name`, when set. */
  siteName?: string;
  /** `<link rel="canonical">`, resolved against the page URL, when set. */
  canonical?: string;
  /** The page asks not to be indexed (`<meta name="robots">` with `noindex` or `none`). */
  noindex: boolean;
  /** Which element the content came from: `main`, `[role=main]`, `article` or `body`. */
  source: 'main' | 'role-main' | 'article' | 'body';
  /** The main content as Markdown. */
  markdown: string;
}

/** Options for {@link extractPage}. */
export interface ExtractOptions extends HtmlToMarkdownOptions {
  /** The page's URL: relative links and the canonical URL are resolved against it (or `<base href>`). */
  url?: string;
}

const clean = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/** Always removed from the content: chrome, controls and anything hidden. */
function isNoise(el: HtmlElement): boolean {
  if (['nav', 'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'dialog', 'button'].includes(el.tag)) {
    return true;
  }
  if ('hidden' in el.attrs || el.attrs['aria-hidden'] === 'true') return true;
  const role = el.attrs.role;
  return role === 'navigation' || role === 'search';
}

/** Also removed when the content falls back to `<body>`: site header, footer and sidebars. */
function isPageChrome(el: HtmlElement): boolean {
  if (['header', 'footer', 'aside'].includes(el.tag)) return true;
  const role = el.attrs.role;
  return role === 'banner' || role === 'contentinfo' || role === 'complementary';
}

function meta(root: HtmlElement, key: 'name' | 'property', value: string): string | undefined {
  const el = findFirst(root, (e) => e.tag === 'meta' && (e.attrs[key] ?? '').toLowerCase() === value);
  return el?.attrs.content;
}

function chooseContent(root: HtmlElement): { el: HtmlElement; source: ExtractedPage['source'] } {
  const visible = (e: HtmlElement) => !('hidden' in e.attrs);
  const main = findFirst(root, (e) => e.tag === 'main' && visible(e));
  if (main) return { el: main, source: 'main' };
  const roleMain = findFirst(root, (e) => e.attrs.role === 'main' && visible(e));
  if (roleMain) return { el: roleMain, source: 'role-main' };
  const articles = findAll(root, (e) => e.tag === 'article');
  // One article is the page's content; several (a blog index) are a list, better read from the body.
  if (articles.length === 1) return { el: articles[0] as HtmlElement, source: 'article' };
  const body = findFirst(root, (e) => e.tag === 'body') ?? root;
  return { el: body, source: 'body' };
}

/**
 * Reads a page's title, description and main content.
 *
 * The content is the first `<main>`, else the first `[role=main]`, else the
 * only `<article>`, else `<body>`. Navigation, scripts, styles, buttons and
 * hidden elements are removed; when it falls back to `<body>`, so are
 * `<header>`, `<footer>` and `<aside>`.
 */
export function extractPage(html: string, options: ExtractOptions = {}): ExtractedPage {
  const root = parseHtml(html);
  const baseHref = findFirst(root, (e) => e.tag === 'base' && e.attrs.href !== undefined)?.attrs.href;
  let baseUrl = options.baseUrl ?? options.url;
  if (baseHref) {
    try {
      baseUrl = new URL(baseHref, options.url).href;
    } catch {
      // keep the page URL
    }
  }

  const titleEl = findFirst(root, (e) => e.tag === 'title');
  const h1 = findFirst(root, (e) => e.tag === 'h1');
  const title = clean(titleEl && textContent(titleEl)) || clean(meta(root, 'property', 'og:title')) || clean(h1 && textContent(h1));
  const description = clean(meta(root, 'name', 'description')) || clean(meta(root, 'property', 'og:description'));
  const siteName = clean(meta(root, 'property', 'og:site_name')) || undefined;
  const robots = (meta(root, 'name', 'robots') ?? '').toLowerCase();
  const noindex = /\b(noindex|none)\b/.test(robots);

  let canonical: string | undefined;
  const canonicalHref = findFirst(
    root,
    (e) => e.tag === 'link' && (e.attrs.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'),
  )?.attrs.href;
  if (canonicalHref) {
    try {
      canonical = new URL(canonicalHref, options.url).href;
    } catch {
      canonical = undefined;
    }
  }

  const { el, source } = chooseContent(root);
  removeAll(el, source === 'body' ? (e) => isNoise(e) || isPageChrome(e) : isNoise);
  const markdown = htmlToMarkdown(el, { ...options, baseUrl });

  return { title, description, siteName, canonical, noindex, source, markdown };
}
