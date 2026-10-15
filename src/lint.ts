import { get, mapLimit } from './http.js';
import { USER_AGENT } from './version.js';

/** `error`: the file breaks the proposal's format. `warning`: it parses, but something is likely wrong. */
export type Severity = 'error' | 'warning';

/**
 * What a lint issue is about.
 *
 * Errors: `h1-first`, `h1-empty`, `multiple-h1`, `heading-level`, `section-title`, `link-syntax`,
 * `link-title`, `link-url`, `invalid-url`.
 * Warnings: `summary`, `not-a-link`, `link-notes`, `section-content`, `empty-section`,
 * `duplicate-section`, `relative-url`, `url-scheme`, `dead-link`, `content-type`.
 */
export type LintRule =
  | 'h1-first'
  | 'h1-empty'
  | 'multiple-h1'
  | 'heading-level'
  | 'section-title'
  | 'link-syntax'
  | 'link-title'
  | 'link-url'
  | 'invalid-url'
  | 'summary'
  | 'not-a-link'
  | 'link-notes'
  | 'section-content'
  | 'empty-section'
  | 'duplicate-section'
  | 'relative-url'
  | 'url-scheme'
  | 'dead-link'
  | 'content-type';

/** One problem, with its 1-based line and column. */
export interface LintIssue {
  severity: Severity;
  rule: LintRule;
  line: number;
  column: number;
  message: string;
}

/** A link found in a section. `url` is as written; `resolved` is absolute when it could be resolved. */
export interface LintLink {
  title: string;
  url: string;
  resolved: string | null;
  notes?: string;
  line: number;
}

/** What {@link lint} returns. */
export interface LintResult {
  /** No errors (warnings allowed). */
  ok: boolean;
  errors: number;
  warnings: number;
  issues: LintIssue[];
  /** The H1 text, when the file starts with one. */
  title: string | null;
  /** The blockquote summary, when there is one. */
  summary: string | null;
  sections: { title: string; line: number; links: LintLink[] }[];
}

/** Options for {@link lint}. */
export interface LintOptions {
  /** Resolve relative link URLs against this URL (the file's own URL when linting one online). */
  baseUrl?: string;
}

/** A parsed `[title](url "optional title")` at the start of `text`. */
export interface ParsedLink {
  title: string;
  url: string;
  /** Index just after the closing parenthesis. */
  end: number;
}

/** Parses a Markdown inline link at the start of `text`, or returns `null` when it is malformed. */
export function parseLink(text: string): ParsedLink | null {
  if (text[0] !== '[') return null;
  let i = 1;
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      if (depth === 0) break;
      depth--;
    }
  }
  if (i >= text.length || text[i + 1] !== '(') return null;
  const title = text.slice(1, i).replace(/\\([\\[\]])/g, '$1');
  let j = i + 2;
  while (text[j] === ' ' || text[j] === '\t') j++;
  let url = '';
  if (text[j] === '<') {
    const close = text.indexOf('>', j);
    if (close === -1) return null;
    url = text.slice(j + 1, close);
    j = close + 1;
  } else {
    let parens = 0;
    const start = j;
    for (; j < text.length; j++) {
      const c = text[j] as string;
      if (c === '\\') {
        j++;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === '(') parens++;
      else if (c === ')') {
        if (parens === 0) break;
        parens--;
      }
    }
    url = text.slice(start, j);
  }
  while (text[j] === ' ' || text[j] === '\t') j++;
  const q = text[j];
  if (q === '"' || q === "'" || q === '(') {
    const closer = q === '(' ? ')' : q;
    const close = text.indexOf(closer, j + 1);
    if (close === -1) return null;
    j = close + 1;
    while (text[j] === ' ' || text[j] === '\t') j++;
  }
  if (text[j] !== ')') return null;
  return { title, url, end: j + 1 };
}

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function resolveUrl(url: string, baseUrl: string | undefined): { resolved: string | null; scheme: string | null; error?: string } {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? null;
  if (scheme) {
    try {
      return { resolved: new URL(url).href, scheme };
    } catch {
      return { resolved: null, scheme, error: 'not a valid URL' };
    }
  }
  if (!baseUrl) return { resolved: null, scheme: null };
  try {
    return { resolved: new URL(url, baseUrl).href, scheme: new URL(baseUrl).protocol.replace(':', '') };
  } catch {
    return { resolved: null, scheme: null, error: 'cannot be resolved against the base URL' };
  }
}

/**
 * Checks an llms.txt file against the format in the proposal at llmstxt.org:
 * an H1 first (the only required part), then a blockquote summary, then any
 * prose without headings, then H2 sections whose lists hold
 * `[name](url)` links, each optionally followed by `:` and notes.
 */
export function lint(text: string, options: LintOptions = {}): LintResult {
  const issues: LintIssue[] = [];
  const add = (severity: Severity, rule: LintRule, line: number, message: string, column = 1) =>
    issues.push({ severity, rule, line, column, message });

  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  type State = 'start' | 'afterH1' | 'summary' | 'preamble' | 'sections';
  let state = 'start' as State;
  let title: string | null = null;
  const summaryLines: string[] = [];
  const sections: LintResult['sections'] = [];
  const seenSections = new Map<string, number>();
  let fence: string | null = null;
  let inItem = false;
  let lazy = false;
  let warnedProseAt = -1;

  const sectionProse = (lineNo: number, what: string) => {
    // One warning per run of non-list lines.
    if (warnedProseAt === lineNo - 1) {
      warnedProseAt = lineNo;
      return;
    }
    warnedProseAt = lineNo;
    add('warning', 'section-content', lineNo, `${what} inside a section. The proposal's sections hold file lists: "- [name](url): notes".`);
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const blank = !line.trim();

    if (fence) {
      if (FENCE.exec(line)?.[1]?.startsWith(fence)) fence = null;
      if (state === 'sections') warnedProseAt = lineNo;
      return;
    }
    if (blank) {
      if (state === 'summary') state = 'preamble';
      lazy = false;
      return;
    }

    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      fence = fenceMatch[1] as string;
      if (state === 'start') {
        add('error', 'h1-first', lineNo, 'The file must start with an H1 holding the name of the project or site ("# Name").');
        state = 'preamble';
      } else if (state === 'afterH1') {
        add('warning', 'summary', lineNo, 'No blockquote summary after the H1. The proposal puts a short summary here ("> ...").');
        state = 'preamble';
      } else if (state === 'sections') {
        sectionProse(lineNo, 'A code block');
      }
      inItem = false;
      return;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      inItem = false;
      const level = (heading[1] as string).length;
      const text = (heading[2] ?? '').trim();
      if (level === 1) {
        if (state === 'start') {
          title = text;
          if (!text) add('error', 'h1-empty', lineNo, 'The H1 is empty. It should hold the name of the project or site.');
          state = 'afterH1';
        } else {
          add('error', 'multiple-h1', lineNo, `A second H1 ("${text}"). The file has exactly one H1, at the top; sections are H2.`);
        }
        return;
      }
      if (level === 2) {
        if (state === 'start') {
          add('error', 'h1-first', lineNo, 'The file must start with an H1 holding the name of the project or site ("# Name").');
        } else if (state === 'afterH1') {
          add('warning', 'summary', lineNo, 'No blockquote summary after the H1. The proposal puts a short summary here ("> ...").');
        }
        state = 'sections';
        warnedProseAt = -1;
        if (!text) add('error', 'section-title', lineNo, 'An H2 with no title.');
        const key = text.toLowerCase();
        if (seenSections.has(key)) {
          add('warning', 'duplicate-section', lineNo, `The section "${text}" already appears on line ${seenSections.get(key)}.`);
        } else {
          seenSections.set(key, lineNo);
        }
        sections.push({ title: text, line: lineNo, links: [] });
        return;
      }
      if (state === 'start') {
        add('error', 'h1-first', lineNo, 'The file must start with an H1 holding the name of the project or site ("# Name").');
        state = 'preamble';
      }
      add(
        'error',
        'heading-level',
        lineNo,
        `An H${level} heading ("${text}"). The proposal allows no headings before the sections, and only H2 headings to delimit them.`,
      );
      return;
    }

    if (state === 'start') {
      add('error', 'h1-first', lineNo, 'The file must start with an H1 holding the name of the project or site ("# Name").');
      state = 'preamble';
      return;
    }
    if (state === 'afterH1') {
      if (/^ {0,3}>/.test(line)) {
        summaryLines.push(line.replace(/^ {0,3}> ?/, ''));
        state = 'summary';
      } else {
        add('warning', 'summary', lineNo, 'No blockquote summary after the H1. The proposal puts a short summary here ("> ...").');
        state = 'preamble';
      }
      return;
    }
    if (state === 'summary') {
      // A blockquote runs on until a blank line, with or without `>` (lazy continuation).
      summaryLines.push(line.replace(/^ {0,3}> ?/, ''));
      return;
    }
    if (state === 'preamble') return;

    // Inside a section.
    const section = sections[sections.length - 1] as LintResult['sections'][number];
    const item = LIST_ITEM.exec(line);
    const indent = item ? (item[1] as string).length : (/^ */.exec(line)?.[0].length ?? 0);
    if (item && indent < 2) {
      inItem = true;
      lazy = true;
      const content = (item[3] ?? '').trim();
      const column = indent + (item[2] as string).length + 2;
      if (!content.startsWith('[')) {
        add('warning', 'not-a-link', lineNo, 'This list item is not a link. File list items are "- [name](url)", optionally followed by ": notes".', column);
        return;
      }
      const link = parseLink(content);
      if (!link) {
        add('error', 'link-syntax', lineNo, 'A malformed link. Write it as "[name](url)", optionally followed by ": notes".', column);
        return;
      }
      if (!link.title.trim()) add('error', 'link-title', lineNo, 'The link has no name between the brackets.', column);
      const rest = content.slice(link.end);
      let notes: string | undefined;
      if (rest.trim()) {
        if (/^\s*:/.test(rest)) notes = rest.replace(/^\s*:/, '').trim() || undefined;
        else add('warning', 'link-notes', lineNo, `Text after the link must start with ":" ("[name](url): notes"); found "${rest.trim().slice(0, 40)}".`, column);
      }
      const url = link.url.trim();
      let resolved: string | null = null;
      if (!url) {
        add('error', 'link-url', lineNo, `The link "${link.title}" has no URL.`, column);
      } else {
        const r = resolveUrl(url, options.baseUrl);
        resolved = r.resolved;
        if (r.error) add('error', 'invalid-url', lineNo, `"${url}" is ${r.error}.`, column);
        else if (!r.resolved) {
          add('warning', 'relative-url', lineNo, `"${url}" is relative and there is no base URL to resolve it against. Use an absolute URL, or lint with --base-url.`, column);
        } else if (r.scheme !== 'http' && r.scheme !== 'https') {
          add('warning', 'url-scheme', lineNo, `"${url}" is not an http or https URL; agents fetching the list may not follow it.`, column);
        }
      }
      section.links.push({ title: link.title, url, resolved, notes, line: lineNo });
      return;
    }
    if (inItem && (indent >= 2 || (lazy && !/^ {0,3}>/.test(line)))) {
      // A nested item, or a continuation of the previous item's notes.
      return;
    }
    inItem = false;
    lazy = false;
    sectionProse(lineNo, /^ {0,3}>/.test(line) ? 'A blockquote' : 'Text that is not a list item');
  });

  if (state === 'start') add('error', 'h1-first', 1, 'The file is empty. It must at least have an H1 with the name of the project or site.');
  if (state === 'afterH1') add('warning', 'summary', lines.length, 'No blockquote summary after the H1. The proposal puts a short summary here ("> ...").');
  for (const section of sections) {
    if (!section.links.length) add('warning', 'empty-section', section.line, `The section "${section.title}" has no links.`);
  }

  issues.sort((a, b) => a.line - b.line || a.column - b.column);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const summary = summaryLines.join(' ').replace(/\s+/g, ' ').trim();
  return {
    ok: errors === 0,
    errors,
    warnings: issues.length - errors,
    issues,
    title,
    summary: summary || null,
    sections,
  };
}

/** Options for {@link checkLinks}. */
export interface CheckLinksOptions {
  fetch?: typeof fetch;
  /** Timeout per request, in milliseconds. Default `10000`. */
  timeoutMs?: number;
  /** Requests at the same time. Default `4`. */
  concurrency?: number;
  userAgent?: string;
}

/**
 * Requests every resolved http(s) link in a lint result (`HEAD`, then `GET`
 * when `HEAD` is refused) and returns a `dead-link` warning for each one that
 * fails or answers HTTP 400 or above. Each distinct URL is requested once.
 */
export async function checkLinks(result: LintResult, options: CheckLinksOptions = {}): Promise<LintIssue[]> {
  const links = result.sections.flatMap((s) => s.links).filter((l) => l.resolved && /^https?:/i.test(l.resolved));
  const unique = [...new Set(links.map((l) => l.resolved as string))];
  const base = { fetch: options.fetch, timeoutMs: options.timeoutMs ?? 10_000, userAgent: options.userAgent ?? USER_AGENT };
  const outcomes = await mapLimit(unique, options.concurrency ?? 4, async (url) => {
    try {
      const head = await get(url, { ...base, method: 'HEAD' });
      if (head.ok) return null;
      const res = await get(url, base);
      return res.ok ? null : `answered HTTP ${res.status}`;
    } catch (error) {
      return (error as Error).message.replace(/^Could not fetch \S+: /, 'failed: ');
    }
  });
  const dead = new Map(unique.map((url, i) => [url, outcomes[i]]));
  return links
    .filter((l) => dead.get(l.resolved as string))
    .map((l) => ({
      severity: 'warning' as const,
      rule: 'dead-link' as const,
      line: l.line,
      column: 1,
      message: `${l.resolved} ${dead.get(l.resolved as string)}.`,
    }));
}

/** Adds issues to a result and recounts it. */
export function withIssues(result: LintResult, extra: LintIssue[]): LintResult {
  const issues = [...result.issues, ...extra].sort((a, b) => a.line - b.line || a.column - b.column);
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ...result, issues, errors, warnings: issues.length - errors, ok: errors === 0 };
}
