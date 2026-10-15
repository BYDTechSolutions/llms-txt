import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmsTxtError, crawl, lint, parseSitemap, readSitemap } from '../src/index.js';
import { html, sitemapIndex, startServer, text, urlset, type TestServer } from './helpers.js';

let server: TestServer;
let o: string;

function page(title: string, description: string, body: string, extraHead = '') {
  return html(body, `<title>${title} | Example</title><meta name="description" content="${description}">${extraHead}`);
}

beforeEach(async () => {
  server = await startServer();
  o = server.origin;
  const r = server.routes;
  r.set('/robots.txt', text(`User-agent: *\nDisallow: /private/\n\nSitemap: ${o}/sitemap-index.xml\n`));
  r.set('/sitemap-index.xml', { headers: { 'content-type': 'application/xml' }, body: sitemapIndex([`${o}/sitemap-pages.xml`, `${o}/sitemap-docs.xml.gz`]) });
  r.set('/sitemap-pages.xml', {
    body: urlset([`${o}/`, `${o}/about`, `${o}/private/secret`, `https://elsewhere.test/page`, `${o}/hidden`, `${o}/file.pdf`, `${o}/missing`, `${o}/about#team`]),
  });
  r.set('/sitemap-docs.xml.gz', { body: gzipSync(urlset([`${o}/docs/start`, `${o}/docs/api`, `${o}/changelog`])) });
  r.set('/', page('Home', 'Example builds tools.', '<header><nav>Menu</nav></header><main><h1>Welcome</h1><p>We build tools.</p></main>', '<meta property="og:site_name" content="Example">'));
  r.set('/about', page('About', 'Who we are.', '<main><h1>About</h1><p>A small team.</p></main>'));
  r.set('/private/secret', page('Secret', '', '<main>no</main>'));
  r.set('/hidden', page('Hidden', '', '<main>no</main>', '<meta name="robots" content="noindex">'));
  r.set('/file.pdf', { headers: { 'content-type': 'application/pdf' }, body: '%PDF' });
  r.set('/docs/start', page('Quick start', 'Install and run.', '<main><h1>Quick start</h1><pre><code class="language-sh">npm i example</code></pre></main>'));
  r.set('/docs/api', page('API', 'Every function.', '<article><h2>build()</h2><p>Builds it.</p></article>'));
  r.set('/changelog', page('Changelog', 'Release notes.', '<main><ul><li>0.1.0</li></ul></main>'));
});
afterEach(() => server.close());

const groups = [
  { title: 'Docs', match: '/docs/' },
  { title: 'Optional', match: ['/changelog'] },
];

describe('parseSitemap and readSitemap', () => {
  it('parses urlsets and indexes, decoding entities and CDATA', () => {
    expect(parseSitemap('<urlset><url><loc>https://x.test/?a=1&amp;b=2</loc></url><url><loc><![CDATA[https://x.test/c]]></loc></url></urlset>')).toEqual({
      kind: 'urlset',
      locs: ['https://x.test/?a=1&b=2', 'https://x.test/c'],
    });
    expect(parseSitemap(sitemapIndex(['https://x.test/s.xml'])).kind).toBe('sitemapindex');
  });

  it('follows indexes and gzip, reporting nested failures', async () => {
    server.routes.set('/index2.xml', { body: sitemapIndex([`${o}/sitemap-pages.xml`, `${o}/nope.xml`]) });
    const result = await readSitemap(`${o}/index2.xml`);
    expect(result.urls).toHaveLength(8);
    expect(result.errors).toEqual([`The sitemap ${o}/nope.xml answered HTTP 404.`]);
    expect((await readSitemap(`${o}/sitemap-docs.xml.gz`)).urls).toHaveLength(3);
  });
});

describe('crawl', () => {
  it('reads the sitemap from robots.txt, obeys it, groups pages and builds both files', async () => {
    const result = await crawl({ site: o, groups, titleSuffix: ' | Example' });

    expect(result.sitemaps).toEqual([`${o}/sitemap-index.xml`]);
    expect(result.robots.status).toBe('ok');
    expect(result.name).toBe('Example');
    expect(result.summary).toBe('Example builds tools.');
    expect(result.pages.map((p) => [new URL(p.url).pathname, p.section])).toEqual([
      ['/', 'Pages'],
      ['/about', 'Pages'],
      ['/docs/start', 'Docs'],
      ['/docs/api', 'Docs'],
      ['/changelog', 'Optional'],
    ]);
    expect(Object.fromEntries(result.skipped.map((s) => [s.url.replace(o, ''), s.reason]))).toEqual({
      '/private/secret': 'robots',
      'https://elsewhere.test/page': 'other-host',
      '/hidden': 'noindex',
      '/file.pdf': 'not-html',
      '/missing': 'http-error',
    });
    expect(server.requests.some((r) => r.path === '/private/secret')).toBe(false);

    expect(result.llmsTxt).toBe(`# Example

> Example builds tools.

## Docs

- [Quick start](${o}/docs/start): Install and run.
- [API](${o}/docs/api): Every function.

## Pages

- [Home](${o}/): Example builds tools.
- [About](${o}/about): Who we are.

## Optional

- [Changelog](${o}/changelog): Release notes.
`);
    expect(lint(result.llmsTxt).issues).toEqual([]);

    // llms-full.txt follows the same order, with each page's content below an H2.
    const full = result.llmsFullTxt;
    expect(full.startsWith('# Example\n\n> Example builds tools.\n\n## Quick start\n\n')).toBe(true);
    expect(full).toContain(`## Quick start\n\nSource: ${o}/docs/start\n\n> Install and run.\n\n### Quick start\n\n\`\`\`sh\nnpm i example\n\`\`\``);
    expect(full).toContain('#### build()\n\nBuilds it.');
    expect(full).toContain('### Welcome\n\nWe build tools.');
    expect(full).not.toContain('Menu');
    expect(full.indexOf('## Changelog')).toBeGreaterThan(full.indexOf('## About'));
  });

  it('sends its user agent and follows the robots group for a custom token', async () => {
    server.routes.set('/robots.txt', text(`User-agent: MyBot\nDisallow: /about\n\nUser-agent: *\nDisallow: /\n\nSitemap: ${o}/sitemap-pages.xml\n`));
    const result = await crawl({ site: o, userAgent: 'MyBot' });
    expect(result.pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/private/secret']);
    expect(server.requests.find((r) => r.path === '/')?.headers['user-agent']).toMatch(/^MyBot \(compatible; llms-txt\/\d/);
  });

  it('honors name, summary, details and configured sections, include, exclude and defaultSection', async () => {
    const result = await crawl({
      site: o,
      name: 'Custom',
      summary: 'Custom summary.',
      details: 'Some prose.',
      sitemap: '/sitemap-docs.xml.gz',
      groups,
      exclude: ['/docs/api'],
      include: ['/docs/', '/changelog', '/about'],
      urls: ['/about', 'http://[nope'],
      defaultSection: false,
      sections: [{ title: 'Docs', links: [{ title: 'Home', url: '/' }] }],
      optional: [{ title: 'Extra', url: 'https://x.test/extra' }],
    });
    expect(result.llmsTxt).toBe(`# Custom

> Custom summary.

Some prose.

## Docs

- [Home](${o}/)
- [Quick start | Example](${o}/docs/start): Install and run.

## Optional

- [Changelog | Example](${o}/changelog): Release notes.
- [Extra](https://x.test/extra)
`);
    expect(result.skipped.map((s) => s.reason)).toEqual(['excluded']);
    expect(result.warnings).toEqual(['Not a URL, skipped: "http://[nope".']);
    // About matched no group and defaultSection is false: in llms-full.txt only.
    expect(result.pages.find((p) => p.url.endsWith('/about'))?.section).toBeNull();
    expect(result.llmsFullTxt).toContain('## About | Example');
  });

  it('limits concurrency and pages', async () => {
    for (const path of ['/about', '/docs/start', '/docs/api', '/changelog']) {
      const reply = server.routes.get(path) as object;
      server.routes.set(path, { ...reply, delayMs: 40 });
    }
    const result = await crawl({ site: o, concurrency: 2, maxPages: 3, name: 'X', summary: '' });
    expect(server.maxInFlight()).toBeLessThanOrEqual(2);
    expect(result.pages).toHaveLength(2); // the home page and /about; /hidden is the third, and noindex
    expect(result.skipped.filter((s) => s.reason === 'max-pages')).toHaveLength(5);
  });

  it('times out slow pages and keeps going', async () => {
    server.routes.set('/about', { ...page('About', '', '<main>x</main>'), delayMs: 400 });
    const result = await crawl({ site: o, timeoutMs: 100 });
    const about = result.skipped.find((s) => s.url === `${o}/about`);
    expect(about?.reason).toBe('fetch-error');
    expect(about?.detail).toMatch(/timed out after 100 ms/);
  });

  it('skips pages that redirect to another origin', async () => {
    const other = await startServer({ '/x': page('Other', '', '<main>x</main>') });
    try {
      server.routes.set('/about', { status: 302, headers: { location: `${other.origin}/x` } });
      const result = await crawl({ site: o });
      expect(result.skipped.find((s) => s.url === `${o}/about`)).toEqual({
        url: `${o}/about`,
        reason: 'other-host',
        detail: `redirected to ${other.origin}/x`,
      });
    } finally {
      await other.close();
    }
  });

  it('stops when robots.txt is unreachable, unless told to ignore it', async () => {
    server.routes.set('/robots.txt', { status: 503 });
    await expect(crawl({ site: o })).rejects.toMatchObject({ code: 'FETCH', message: expect.stringMatching(/RFC 9309/) });
    const result = await crawl({ site: o, respectRobots: false, sitemap: '/sitemap-pages.xml' });
    expect(result.robots.status).toBe('ignored');
    expect(result.pages.some((p) => p.url.endsWith('/private/secret'))).toBe(true);
  });

  it('falls back to /sitemap.xml when robots.txt is missing, and fails without any sitemap', async () => {
    server.routes.delete('/robots.txt');
    await expect(crawl({ site: o })).rejects.toMatchObject({ code: 'SITEMAP' });
    server.routes.set('/sitemap.xml', { body: urlset([`${o}/about`]) });
    const result = await crawl({ site: o });
    expect(result.robots.status).toBe('missing');
    expect(result.name).toBe('Example'); // read from the home page, fetched for it
    expect(result.pages.map((p) => p.title)).toEqual(['About | Example']);
  });

  it('rejects a bad site, a crawl with no readable page, and no name', async () => {
    await expect(crawl({ site: 'ftp://x.test' })).rejects.toBeInstanceOf(LlmsTxtError);
    server.routes.set('/robots.txt', text(`Sitemap: ${o}/s.xml\n`));
    server.routes.set('/s.xml', { body: urlset([`${o}/missing`]) });
    await expect(crawl({ site: o })).rejects.toMatchObject({ code: 'NO_PAGES' });
    server.routes.set('/s.xml', { body: urlset([`${o}/plain`]) });
    server.routes.set('/plain', html('<p>No title</p>'));
    server.routes.set('/', html('<p>No title</p>'));
    await expect(crawl({ site: o })).rejects.toMatchObject({ code: 'CONFIG' });
  });
});
