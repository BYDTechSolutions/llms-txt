import type { LlmsLink, LlmsSection, LlmsTxtConfig } from './config.js';
import { validateConfig } from './config.js';
import { LlmsTxtError } from './errors.js';
import { markdownUrl } from './markdown.js';

/** The section title the proposal gives a special meaning: links an agent can skip for a shorter context. */
export const OPTIONAL_SECTION = 'Optional';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Escapes a link title so `[` and `]` inside it do not end the link text. */
function linkTitle(title: string): string {
  return oneLine(title).replace(/([\\[\]])/g, '\\$1');
}

function linkUrl(url: string, site: string | undefined): string {
  const trimmed = url.trim();
  if (site && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    try {
      return markdownUrl(new URL(trimmed, site).href);
    } catch {
      // fall through and keep it as written
    }
  }
  return markdownUrl(trimmed);
}

/** Renders one file-list entry: `- [title](url): notes`. */
export function formatLink(link: LlmsLink, site?: string): string {
  const notes = link.notes ? oneLine(link.notes) : '';
  return `- [${linkTitle(link.title)}](${linkUrl(link.url, site)})${notes ? `: ${notes}` : ''}`;
}

/** Lines of `text` (outside fenced code) that are ATX headings. */
export function headingLines(text: string): number[] {
  const found: number[] = [];
  let fence: string | null = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      const mark = (f[1] as string)[0] as string;
      if (!fence) fence = mark;
      else if (fence === mark) fence = null;
      return;
    }
    if (!fence && /^\s{0,3}#{1,6}(\s|$)/.test(line)) found.push(i + 1);
  });
  return found;
}

/** Merges sections with the same title, keeps their order, drops empty ones, and moves `Optional` last. */
export function normalizeSections(sections: LlmsSection[], optional: LlmsLink[] = []): LlmsSection[] {
  const byTitle = new Map<string, LlmsSection>();
  const extra: LlmsLink[] = [];
  for (const section of sections) {
    const title = oneLine(section.title);
    if (title.toLowerCase() === OPTIONAL_SECTION.toLowerCase()) {
      extra.push(...section.links);
      continue;
    }
    const existing = byTitle.get(title);
    if (existing) existing.links.push(...section.links);
    else byTitle.set(title, { title, links: [...section.links] });
  }
  const out = [...byTitle.values()].filter((s) => s.links.length);
  const opt = [...extra, ...optional];
  if (opt.length) out.push({ title: OPTIONAL_SECTION, links: opt });
  return out;
}

/**
 * Renders an llms.txt file in the order the proposal sets: the H1 name, the
 * blockquote summary, optional prose, then one H2 section per list of links,
 * with `## Optional` last. Relative link URLs resolve against `config.site`.
 *
 * Throws `LlmsTxtError` (`CONFIG`) when the name is missing, the details
 * contain a heading, or the configuration is otherwise invalid.
 */
export function build(config: LlmsTxtConfig): string {
  const problems = validateConfig(config);
  if (!config.name || !config.name.trim()) problems.unshift('name is required: it becomes the H1.');
  const headings = config.details ? headingLines(config.details) : [];
  if (headings.length) {
    problems.push(`details must not contain headings (line ${headings.join(', ')}): the proposal allows only H2 sections after the summary.`);
  }
  if (problems.length) throw new LlmsTxtError('CONFIG', 'The configuration cannot be built into an llms.txt file.', problems);

  const out: string[] = [`# ${oneLine(config.name as string)}`, ''];
  const summary = config.summary?.trim();
  if (summary) {
    out.push(...summary.split(/\r?\n/).map((l) => (l.trim() ? `> ${l.trim()}` : '>')), '');
  }
  const details = config.details?.trim();
  if (details) out.push(details, '');
  for (const section of normalizeSections(config.sections ?? [], config.optional ?? [])) {
    out.push(`## ${section.title}`, '', ...section.links.map((l) => formatLink(l, config.site)), '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** One page of `llms-full.txt`. */
export interface FullPage {
  url: string;
  title: string;
  description?: string;
  markdown: string;
}

/**
 * Renders `llms-full.txt`: the same H1 and summary, then every page as an H2
 * with its URL, description and content. The proposal does not define this
 * file; this follows the common practice of one Markdown document holding
 * the whole site. Page headings should already be shifted below H2.
 */
export function buildFull(config: Pick<LlmsTxtConfig, 'name' | 'summary' | 'details'>, pages: FullPage[]): string {
  if (!config.name || !config.name.trim()) throw new LlmsTxtError('CONFIG', 'name is required: it becomes the H1.');
  const out: string[] = [`# ${oneLine(config.name)}`, ''];
  const summary = config.summary?.trim();
  if (summary) out.push(...summary.split(/\r?\n/).map((l) => (l.trim() ? `> ${l.trim()}` : '>')), '');
  const details = config.details?.trim();
  if (details) out.push(details, '');
  for (const page of pages) {
    out.push(`## ${oneLine(page.title) || page.url}`, '', `Source: ${page.url}`, '');
    const description = page.description ? oneLine(page.description) : '';
    if (description) out.push(`> ${description}`, '');
    if (page.markdown.trim()) out.push(page.markdown.trim(), '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
