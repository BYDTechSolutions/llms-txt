import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkLinks, formatReport, lint, parseLink, withIssues } from '../src/index.js';
import { startServer, type TestServer } from './helpers.js';

const VALID = `# Example

> Example is a small library. This file lists its docs.

Notes for readers, in plain prose.

- A list here is fine too.

## Docs

- [Quick start](https://example.com/start.md): A brief overview
- [API](https://example.com/api.md)

## Optional

- [Changelog](https://example.com/changelog.md): Release notes
`;

const rules = (text: string, options?: Parameters<typeof lint>[1]) =>
  lint(text, options).issues.map((i) => `${i.line}:${i.severity}:${i.rule}`);

describe('parseLink', () => {
  it('parses titles with escaped and nested brackets, URLs with parens, angle URLs and link titles', () => {
    expect(parseLink('[a \\] [b]](https://x.test/a_(b)) rest')).toEqual({ title: 'a ] [b]', url: 'https://x.test/a_(b)', end: 32 });
    expect(parseLink('[a](<https://x.test/a b>)')?.url).toBe('https://x.test/a b');
    expect(parseLink('[a](https://x.test "Title")')?.url).toBe('https://x.test');
  });

  it('returns null for malformed links', () => {
    expect(parseLink('[a](https://x.test')).toBeNull();
    expect(parseLink('[a] (https://x.test)')).toBeNull();
    expect(parseLink('[a](https://x.test b)')).toBeNull();
    expect(parseLink('[a')).toBeNull();
  });
});

describe('lint', () => {
  it('accepts a file in the proposal format', () => {
    const result = lint(VALID);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.title).toBe('Example');
    expect(result.summary).toBe('Example is a small library. This file lists its docs.');
    expect(result.sections.map((s) => [s.title, s.links.length])).toEqual([
      ['Docs', 2],
      ['Optional', 1],
    ]);
    expect(result.sections[0]?.links[0]).toEqual({
      title: 'Quick start',
      url: 'https://example.com/start.md',
      resolved: 'https://example.com/start.md',
      notes: 'A brief overview',
      line: 11,
    });
  });

  it('accepts a byte-order mark and a file that is only an H1 with a summary', () => {
    expect(rules('﻿# Name\n\n> Summary\n')).toEqual([]);
  });

  it('requires the H1 first', () => {
    expect(rules('Intro\n\n# Name\n')).toEqual(['1:error:h1-first', '3:error:multiple-h1']);
    expect(rules('## Docs\n\n- [a](https://x.test)\n')).toEqual(['1:error:h1-first']);
    expect(rules('')).toEqual(['1:error:h1-first']);
    expect(rules('#\n\n> s\n')).toEqual(['1:error:h1-empty']);
  });

  it('allows exactly one H1', () => {
    expect(rules('# A\n\n> s\n\n# B\n')).toEqual(['5:error:multiple-h1']);
  });

  it('warns when the blockquote summary is missing', () => {
    expect(rules('# A\n\nProse.\n')).toEqual(['3:warning:summary']);
    expect(rules('# A\n\n## Docs\n\n- [a](https://x.test)\n')).toEqual(['3:warning:summary']);
    expect(rules('# A\n')).toEqual(['2:warning:summary']);
  });

  it('allows only H2 headings', () => {
    expect(rules('# A\n\n> s\n\n### Notes\n\n## Docs\n\n- [a](https://x.test)\n\n#### Deep\n')).toEqual([
      '5:error:heading-level',
      '11:error:heading-level',
    ]);
  });

  it('ignores headings inside fenced code in the prose', () => {
    expect(rules('# A\n\n> s\n\n```md\n# not a heading\n## nor this\n```\n')).toEqual([]);
  });

  it('checks file list items', () => {
    const text = `# A

> s

## Docs

- Plain text item
- [Broken](https://x.test
- [](https://x.test/empty)
- [No url]()
- [Extra](https://x.test/e) and more
- [Notes](https://x.test/n): fine
  continued notes
- [Mail](mailto:hi@x.test)
- [Bad](http://)
`;
    expect(rules(text)).toEqual([
      '7:warning:not-a-link',
      '8:error:link-syntax',
      '9:error:link-title',
      '10:error:link-url',
      '11:warning:link-notes',
      '14:warning:url-scheme',
      '15:error:invalid-url',
    ]);
    const issue = lint(text).issues[0];
    expect(issue).toMatchObject({ line: 7, column: 3 });
  });

  it('warns about prose, quotes and code inside sections, once per run of lines', () => {
    expect(rules('# A\n\n> s\n\n## Docs\n\nSome prose\nmore prose\n\n- [a](https://x.test)\n\n> quoted\n\n```\ncode\n```\n')).toEqual([
      '7:warning:section-content',
      '12:warning:section-content',
      '14:warning:section-content',
    ]);
  });

  it('warns about empty and duplicate sections', () => {
    expect(rules('# A\n\n> s\n\n## Docs\n\n## docs\n\n- [a](https://x.test)\n')).toEqual([
      '5:warning:empty-section',
      '7:warning:duplicate-section',
    ]);
  });

  it('resolves relative URLs against a base URL, and warns without one', () => {
    const text = '# A\n\n> s\n\n## Docs\n\n- [a](/docs/a.md)\n';
    expect(rules(text)).toEqual(['7:warning:relative-url']);
    const result = lint(text, { baseUrl: 'https://example.com/llms.txt' });
    expect(result.issues).toEqual([]);
    expect(result.sections[0]?.links[0]?.resolved).toBe('https://example.com/docs/a.md');
  });
});

describe('formatReport', () => {
  const result = lint('# A\n\n## Docs\n\n- [x](\n');

  it('text: one line per issue and a count', () => {
    expect(formatReport(result, 'llms.txt')).toBe(
      'llms.txt:3:1  warning  summary            No blockquote summary after the H1. The proposal puts a short summary here ("> ...").\n' +
        'llms.txt:3:1  warning  empty-section      The section "Docs" has no links.\n' +
        'llms.txt:5:3  error    link-syntax        A malformed link. Write it as "[name](url)", optionally followed by ": notes".\n' +
        'llms.txt: 1 error, 2 warnings (1 section, 0 links).\n',
    );
  });

  it('json: the whole result', () => {
    const json = JSON.parse(formatReport(result, 'llms.txt', 'json'));
    expect(json).toMatchObject({ file: 'llms.txt', ok: false, errors: 1, warnings: 2 });
  });

  it('github: workflow commands with escaped properties', () => {
    const out = formatReport(result, 'dir,a:b/llms.txt', 'github');
    expect(out.split('\n')[2]).toBe(
      '::error file=dir%2Ca%3Ab/llms.txt,line=5,col=3,title=llms-txt link-syntax::A malformed link. Write it as "[name](url)", optionally followed by ": notes".',
    );
  });

  it('says so when there are no problems', () => {
    expect(formatReport(lint(VALID), 'llms.txt')).toBe('llms.txt: no problems (2 sections, 3 links).\n');
  });
});

describe('checkLinks', () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startServer({
      '/ok': { status: 200 },
      '/head-refused': (req) => (req.method === 'HEAD' ? { status: 405 } : { status: 200 }),
      '/gone': { status: 410 },
      '/slow': { status: 200, delayMs: 500 },
    });
  });
  afterEach(() => server.close());

  it('warns about links that fail, trying GET when HEAD is refused, once per URL', async () => {
    const o = server.origin;
    const text = `# A\n\n> s\n\n## Docs\n\n- [ok](${o}/ok)\n- [head](${o}/head-refused)\n- [gone](${o}/gone)\n- [again](${o}/gone)\n- [missing](${o}/missing)\n- [slow](${o}/slow)\n- [rel](/relative)\n`;
    const result = lint(text);
    const dead = await checkLinks(result, { timeoutMs: 200 });
    expect(dead.map((d) => `${d.line}:${d.rule}`)).toEqual(['9:dead-link', '10:dead-link', '11:dead-link', '12:dead-link']);
    expect(dead[0]?.message).toBe(`${o}/gone answered HTTP 410.`);
    expect(dead[3]?.message).toMatch(/timed out after 200 ms/);
    expect(server.requests.filter((r) => r.path === '/gone')).toHaveLength(2); // one HEAD, one GET
    const merged = withIssues(result, dead);
    expect(merged.ok).toBe(true);
    expect(merged.warnings).toBe(5);
  });
});
