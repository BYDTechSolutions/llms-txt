import { describe, expect, it } from 'vitest';
import { LlmsTxtError, build, buildFull, defineConfig, lint, toResponse, validateConfig } from '../src/index.js';

const config = defineConfig({
  name: 'Example Docs',
  summary: 'Example is a library for building things.\nIt runs anywhere.',
  details: 'Read the quick start first.\n\n- Short pages\n- Plain words',
  site: 'https://example.com',
  sections: [
    {
      title: 'Docs',
      links: [
        { title: 'Quick start', url: '/docs/start.md', notes: 'A brief overview' },
        { title: 'API [reference]', url: 'https://example.com/docs/api (v2).md' },
      ],
    },
    { title: 'Examples', links: [{ title: 'Todo app', url: 'https://github.com/example/todo', notes: 'A walk-through\n  of the code' }] },
    { title: 'Empty', links: [] },
    { title: 'Docs', links: [{ title: 'Guides', url: '/guides' }] },
  ],
  optional: [{ title: 'Full reference', url: '/llms-full.txt' }],
});

describe('build', () => {
  it('renders the proposal format: H1, blockquote, prose, H2 file lists, Optional last', () => {
    expect(build(config)).toBe(`# Example Docs

> Example is a library for building things.
> It runs anywhere.

Read the quick start first.

- Short pages
- Plain words

## Docs

- [Quick start](https://example.com/docs/start.md): A brief overview
- [API \\[reference\\]](https://example.com/docs/api%20%28v2%29.md)
- [Guides](https://example.com/guides)

## Examples

- [Todo app](https://github.com/example/todo): A walk-through of the code

## Optional

- [Full reference](https://example.com/llms-full.txt)
`);
  });

  it('produces a file that lints clean', () => {
    const result = lint(build(config));
    expect(result.issues).toEqual([]);
    expect(result.title).toBe('Example Docs');
    expect(result.sections.map((s) => s.title)).toEqual(['Docs', 'Examples', 'Optional']);
  });

  it('needs only a name', () => {
    expect(build({ name: 'Just a name' })).toBe('# Just a name\n');
  });

  it('merges a section titled Optional into the Optional section, kept last', () => {
    const text = build({
      name: 'X',
      sections: [
        { title: 'optional', links: [{ title: 'A', url: 'https://x.test/a' }] },
        { title: 'Main', links: [{ title: 'B', url: 'https://x.test/b' }] },
      ],
      optional: [{ title: 'C', url: 'https://x.test/c' }],
    });
    expect(text).toBe('# X\n\n## Main\n\n- [B](https://x.test/b)\n\n## Optional\n\n- [A](https://x.test/a)\n- [C](https://x.test/c)\n');
  });

  it('keeps relative URLs as written when no site is set', () => {
    expect(build({ name: 'X', sections: [{ title: 'S', links: [{ title: 'A', url: '/a' }] }] })).toContain('- [A](/a)');
  });

  it('rejects a missing name, headings in details, and invalid links', () => {
    const attempt = (c: Parameters<typeof build>[0]) => {
      try {
        build(c);
      } catch (error) {
        expect(error).toBeInstanceOf(LlmsTxtError);
        return (error as LlmsTxtError).details;
      }
      throw new Error('expected build to throw');
    };
    expect(attempt({ summary: 'x' })).toEqual(['name is required: it becomes the H1.']);
    expect(attempt({ name: 'X', details: 'Intro\n\n## Not allowed\n\n```\n# fine in code\n```' })[0]).toMatch(/line 3/);
    expect(attempt({ name: 'X', sections: [{ title: 'S', links: [{ title: '', url: '' }] }] })).toEqual([
      'sections[0].links[0].title must be a non-empty string.',
      'sections[0].links[0].url must be a non-empty string.',
    ]);
  });
});

describe('validateConfig', () => {
  it('lists every problem', () => {
    expect(
      validateConfig({ name: 1, site: 'nope', sections: {}, crawl: { concurrency: 0, groups: [{ title: 'A' }], include: 'x', full: 'yes' } }),
    ).toEqual([
      'name must be a string.',
      'sections must be an array.',
      'site is not a URL: "nope".',
      'crawl.concurrency must be a whole number of at least 1.',
      'crawl.include must be an array of strings.',
      'crawl.full must be true or false.',
      'crawl.groups[0].match must be a path pattern or an array of them.',
    ]);
    expect(validateConfig([])).toEqual(['The configuration must be an object.']);
  });
});

describe('buildFull', () => {
  it('puts every page under an H2 with its source and description', () => {
    const text = buildFull({ name: 'X', summary: 'Sum' }, [
      { url: 'https://x.test/a', title: 'A', description: 'About A', markdown: '### Heading\n\nBody' },
      { url: 'https://x.test/b', title: '', markdown: '' },
    ]);
    expect(text).toBe('# X\n\n> Sum\n\n## A\n\nSource: https://x.test/a\n\n> About A\n\n### Heading\n\nBody\n\n## https://x.test/b\n\nSource: https://x.test/b\n');
  });
});

describe('toResponse', () => {
  it('serves text/plain in UTF-8', async () => {
    const res = toResponse('# X\n');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('# X\n');
  });

  it('accepts a status and extra headers', () => {
    const res = toResponse('x', { status: 203, headers: { 'Cache-Control': 'max-age=60', 'Content-Type': 'text/markdown; charset=utf-8' } });
    expect(res.status).toBe(203);
    expect(res.headers.get('cache-control')).toBe('max-age=60');
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  });
});
