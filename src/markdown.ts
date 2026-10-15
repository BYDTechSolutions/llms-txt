import { parseHtml, textContent, type HtmlElement, type HtmlNode } from './html.js';

/** Options for {@link htmlToMarkdown}. */
export interface HtmlToMarkdownOptions {
  /** Resolve relative `href` and `src` values against this URL. Default: leave them as written. */
  baseUrl?: string;
  /** Add this many levels to every heading (`1` turns `<h1>` into `##`), capped at `######`. Default `0`. */
  headingOffset?: number;
  /** Keep images as `![alt](src)`. Images with no alt text are always dropped. Default `true`. */
  images?: boolean;
}

interface Ctx {
  baseUrl?: string;
  headingOffset: number;
  images: boolean;
}

/** Elements never rendered: they hold no readable text. */
const SKIP = new Set([
  'head', 'script', 'style', 'noscript', 'template', 'svg', 'math', 'canvas', 'iframe', 'object', 'embed', 'video',
  'audio', 'source', 'track', 'map', 'button', 'input', 'select', 'textarea', 'datalist', 'option',
  'meta', 'link', 'title', 'base', 'dialog',
]);

const BLOCK = new Set([
  '#root', 'html', 'body', 'address', 'article', 'aside', 'blockquote', 'details', 'summary', 'div', 'dl', 'dt', 'dd',
  'fieldset', 'legend', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'center', 'search',
  'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
]);

const BR = '\u0000';

type Part = { kind: 'para' | 'list' | 'block'; text: string };

function isBlock(node: HtmlNode): node is HtmlElement {
  return node.type === 'element' && BLOCK.has(node.tag);
}

function resolve(url: string, ctx: Ctx): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return null;
  if (!ctx.baseUrl) return trimmed;
  try {
    return new URL(trimmed, ctx.baseUrl).href;
  } catch {
    return trimmed;
  }
}

/** Makes a URL safe inside `(...)`: spaces and parentheses are percent-encoded. */
export function markdownUrl(url: string): string {
  return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E');
}

/** Escapes the characters that would otherwise read as Markdown syntax inside running text. */
function escapeText(text: string): string {
  return text
    .replace(/([\\`*[\]])/g, '\\$1')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (m) => m.replace('_', '\\_'))
    .replace(/<(?=[A-Za-z/!?])/g, '\\<');
}

/** Escapes what would start a heading, quote, list or rule at the beginning of a line. */
function escapeLineStarts(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)(#{1,6}(?:\s|$)|>|[-+](?=\s)|=+\s*$)/, '$1\\$2')
        .replace(/^(\s*\d+)([.)])(?=\s)/, '$1\\$2'),
    )
    .join('\n');
}

function collapse(text: string): string {
  return text
    .replace(/[ \t\r\n\f ]+/g, ' ')
    .replace(new RegExp(` ?${BR} ?`, 'g'), BR);
}

function finishInline(text: string): string {
  return collapse(text).trim().replace(new RegExp(`^${BR}+|${BR}+$`, 'g'), '').replace(new RegExp(BR, 'g'), '\n');
}

/** Wraps `inner` in `mark`, keeping surrounding whitespace outside the markers. */
function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner) as RegExpExecArray;
  const body = m[2] as string;
  if (!body) return inner;
  return `${m[1]}${mark}${body}${mark}${m[3]}`;
}

function codeSpan(text: string): string {
  const body = text.replace(/[\r\n]+/g, ' ');
  if (!body.trim()) return '';
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

function renderInline(nodes: HtmlNode[], ctx: Ctx): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += escapeText(node.value);
      continue;
    }
    const { tag } = node;
    if (SKIP.has(tag)) continue;
    switch (tag) {
      case 'br':
        out += BR;
        break;
      case 'strong':
      case 'b':
        out += wrap(renderInline(node.children, ctx), '**');
        break;
      case 'em':
      case 'i':
      case 'cite':
      case 'dfn':
        out += wrap(renderInline(node.children, ctx), '_');
        break;
      case 'del':
      case 's':
      case 'strike':
        out += wrap(renderInline(node.children, ctx), '~~');
        break;
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt':
        out += codeSpan(collapse(textContent(node)));
        break;
      case 'a': {
        const inner = renderInline(node.children, ctx);
        const href = node.attrs.href;
        const text = finishInline(inner).replace(/\n/g, ' ');
        if (!text) break;
        if (href === undefined || href.trim().startsWith('#')) {
          out += inner;
          break;
        }
        const url = resolve(href, ctx);
        if (!url) {
          out += inner;
          break;
        }
        const lead = /^\s/.test(inner) ? ' ' : '';
        const trail = /\s$/.test(inner) ? ' ' : '';
        out += `${lead}[${text}](${markdownUrl(url)})${trail}`;
        break;
      }
      case 'img': {
        if (!ctx.images) break;
        const alt = collapse(node.attrs.alt ?? '').trim();
        const src = node.attrs.src ? resolve(node.attrs.src, ctx) : null;
        if (alt && src) out += `![${escapeText(alt)}](${markdownUrl(src)})`;
        break;
      }
      default:
        out += renderInline(node.children, ctx);
    }
  }
  return out;
}

function indent(text: string, by: string): string {
  return text
    .split('\n')
    .map((line) => (line ? by + line : line))
    .join('\n');
}

function renderList(el: HtmlElement, ctx: Ctx): string {
  const ordered = el.tag === 'ol';
  let n = ordered ? Number.parseInt(el.attrs.start ?? '1', 10) : 1;
  if (!Number.isFinite(n)) n = 1;
  const items: string[] = [];
  const add = (nodes: HtmlNode[]) => {
    const content = joinParts(renderParts(nodes, ctx), true);
    if (!content) return;
    const marker = ordered ? `${n++}. ` : '- ';
    const pad = ' '.repeat(marker.length);
    const [first, ...rest] = content.split('\n');
    items.push([marker + first, ...rest.map((l) => (l ? pad + l : l))].join('\n'));
  };
  let loose: HtmlNode[] = [];
  for (const child of el.children) {
    if (child.type === 'element' && child.tag === 'li') {
      if (loose.length) add(loose);
      loose = [];
      add(child.children);
    } else if (child.type === 'element' && (child.tag === 'ul' || child.tag === 'ol')) {
      // A list nested directly in a list (invalid, but common): attach it to the previous item.
      const nested = renderList(child, ctx);
      if (nested && items.length) items[items.length - 1] += `\n${indent(nested, ordered ? '   ' : '  ')}`;
      else if (nested) items.push(nested);
    } else if (child.type === 'text' && !child.value.trim()) {
      continue;
    } else {
      loose.push(child);
    }
  }
  if (loose.length) add(loose);
  return items.join('\n');
}

function cellText(cell: HtmlElement, ctx: Ctx): string {
  return finishInline(renderInline(cell.children, ctx)).replace(/\n/g, ' ').replace(/\|/g, '\\|');
}

function renderTable(table: HtmlElement, ctx: Ctx): string {
  const rows: { cells: string[]; header: boolean }[] = [];
  const collect = (el: HtmlElement) => {
    for (const child of el.children) {
      if (child.type !== 'element') continue;
      if (child.tag === 'tr') {
        const cells = child.children.filter((c): c is HtmlElement => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
        if (!cells.length) continue;
        rows.push({
          cells: cells.map((c) => cellText(c, ctx)),
          header: el.tag === 'thead' || cells.every((c) => c.tag === 'th'),
        });
      } else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
        collect(child);
      }
    }
  };
  collect(table);
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.cells.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const headerIndex = rows[0]?.header ? 0 : -1;
  const header = headerIndex === 0 ? (rows[0] as { cells: string[] }).cells : Array.from({ length: width }, () => '');
  const body = rows.slice(headerIndex === 0 ? 1 : 0);
  const out = [line(header), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...body.map((r) => line(r.cells))];
  const caption = table.children.find((c): c is HtmlElement => c.type === 'element' && c.tag === 'caption');
  if (caption) {
    const text = finishInline(renderInline(caption.children, ctx));
    if (text) out.unshift(text, '');
  }
  return out.join('\n');
}

function renderPre(el: HtmlElement): string {
  let text = textContent(el).replace(/\r\n?/g, '\n');
  if (text.startsWith('\n')) text = text.slice(1);
  text = text.replace(/\s+$/, '');
  if (!text.trim()) return '';
  const code = el.children.find((c): c is HtmlElement => c.type === 'element' && c.tag === 'code');
  const classes = `${code?.attrs.class ?? ''} ${el.attrs.class ?? ''}`;
  const lang = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(classes)?.[1] ?? el.attrs['data-language'] ?? '';
  const longest = Math.max(2, ...[...text.matchAll(/^`{3,}/gm)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}

function renderBlock(el: HtmlElement, ctx: Ctx): Part | null {
  const { tag } = el;
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    const level = Math.min(6, Number(heading[1]) + ctx.headingOffset);
    const text = finishInline(renderInline(el.children, ctx)).replace(/\n/g, ' ');
    return text ? { kind: 'block', text: `${'#'.repeat(level)} ${text}` } : null;
  }
  switch (tag) {
    case 'ul':
    case 'ol':
    case 'menu': {
      const text = renderList(el, ctx);
      return text ? { kind: 'list', text } : null;
    }
    case 'pre': {
      const text = renderPre(el);
      return text ? { kind: 'block', text } : null;
    }
    case 'blockquote': {
      const inner = joinParts(renderParts(el.children, ctx), false);
      if (!inner) return null;
      return { kind: 'block', text: inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') };
    }
    case 'hr':
      return { kind: 'block', text: '---' };
    case 'table': {
      const text = renderTable(el, ctx);
      return text ? { kind: 'block', text } : null;
    }
    case 'dt': {
      const text = finishInline(renderInline(el.children, ctx));
      return text ? { kind: 'para', text: `**${escapeLineStarts(text)}**` } : null;
    }
    case 'p': {
      const text = finishInline(renderInline(el.children, ctx));
      return text ? { kind: 'para', text: escapeLineStarts(text) } : null;
    }
    default: {
      const text = joinParts(renderParts(el.children, ctx), false);
      return text ? { kind: 'block', text } : null;
    }
  }
}

function renderParts(nodes: HtmlNode[], ctx: Ctx): Part[] {
  const parts: Part[] = [];
  let inline: HtmlNode[] = [];
  const flush = () => {
    if (!inline.length) return;
    const text = finishInline(renderInline(inline, ctx));
    if (text) parts.push({ kind: 'para', text: escapeLineStarts(text) });
    inline = [];
  };
  for (const node of nodes) {
    if (node.type === 'element' && SKIP.has(node.tag)) continue;
    if (isBlock(node)) {
      flush();
      const part = renderBlock(node, ctx);
      if (part) parts.push(part);
    } else {
      inline.push(node);
    }
  }
  flush();
  return parts;
}

/** Joins rendered parts with blank lines; in a tight list item, a nested list follows its text directly. */
function joinParts(parts: Part[], tight: boolean): string {
  let out = '';
  parts.forEach((part, i) => {
    if (i === 0) out = part.text;
    else out += (tight && part.kind === 'list' ? '\n' : '\n\n') + part.text;
  });
  return out;
}

/**
 * Converts HTML to Markdown: headings, paragraphs, emphasis, links, images,
 * lists (nested and ordered), blockquotes, code spans and fenced code blocks
 * (with the language from a `language-*` class), horizontal rules and basic
 * tables (one header row, no cell spans). Scripts, styles, forms controls,
 * SVG and media are dropped. Unknown elements keep their text.
 *
 * Accepts a whole document or a fragment, or a tree from {@link parseHtml}.
 */
export function htmlToMarkdown(html: string | HtmlElement, options: HtmlToMarkdownOptions = {}): string {
  const ctx: Ctx = {
    baseUrl: options.baseUrl,
    headingOffset: Math.max(0, Math.trunc(options.headingOffset ?? 0)),
    images: options.images ?? true,
  };
  const root = typeof html === 'string' ? parseHtml(html) : html;
  const nodes = root.tag === '#root' || BLOCK.has(root.tag) ? root.children : [root];
  return joinParts(renderParts(nodes, ctx), false)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
