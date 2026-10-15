import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, main } from '../src/commands.js';
import { VERSION } from '../src/index.js';
import { captureIo, html, startServer, tempDir, text, urlset, type TestServer } from './helpers.js';

let server: TestServer;
let cwd: string;
let cleanup: () => Promise<void>;

const VALID = '# Example\n\n> Summary.\n\n## Docs\n\n- [A](https://example.com/a): Notes\n';

beforeEach(async () => {
  ({ dir: cwd, cleanup } = await tempDir());
  server = await startServer();
  const o = server.origin;
  server.routes.set('/robots.txt', text(`User-agent: *\nDisallow: /private\nSitemap: ${o}/sitemap.xml\n`));
  server.routes.set('/sitemap.xml', { body: urlset([`${o}/`, `${o}/docs/a`, `${o}/private/b`]) });
  server.routes.set('/', html('<main><p>Home</p></main>', '<title>Site</title><meta name="description" content="A site.">'));
  server.routes.set('/docs/a', html('<main><h1>A</h1><p>Doc A.</p></main>', '<title>Doc A</title><meta name="description" content="About A.">'));
  server.routes.set('/llms.txt', text(VALID));
  server.routes.set('/bad.txt', text('Intro\n\n## Docs\n\n- not a link\n'));
  server.routes.set('/html.txt', html('<h1>App</h1>'));
});
afterEach(async () => {
  await server.close();
  await cleanup();
});

const io = (extra: Parameters<typeof captureIo>[0] = {}) => captureIo({ cwd, ...extra });

describe('general', () => {
  it('prints help and exits 0', async () => {
    const out = io();
    expect(await main(['--help'], out)).toBe(EXIT.OK);
    expect(out.out()).toMatch(/Usage:/);
    expect(await main([], io())).toBe(EXIT.OK);
    expect(await main(['lint', '--help'], io())).toBe(EXIT.OK);
  });

  it('prints the version from package.json', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const out = io();
    expect(await main(['--version'], out)).toBe(EXIT.OK);
    expect(out.out().trim()).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
  });

  it('exits 2 for an unknown command or option', async () => {
    const a = io();
    expect(await main(['publish'], a)).toBe(EXIT.USAGE);
    expect(a.err()).toMatch(/Unknown command "publish"/);
    const b = io();
    expect(await main(['build', '--sites', 'x'], b)).toBe(EXIT.USAGE);
    expect(b.err()).toMatch(/Unknown option/);
    expect(await main(['build', '--site', server.origin, '--concurrency', '0'], io())).toBe(EXIT.USAGE);
  });
});

describe('build', () => {
  it('writes llms.txt from a JSON config', async () => {
    await writeFile(
      join(cwd, 'llms-txt.config.json'),
      JSON.stringify({ name: 'Example', summary: 'Summary.', site: 'https://example.com', outDir: 'public', sections: [{ title: 'Docs', links: [{ title: 'A', url: '/a', notes: 'Notes' }] }] }),
    );
    const out = io();
    expect(await main(['build'], out)).toBe(EXIT.OK);
    expect(await readFile(join(cwd, 'public', 'llms.txt'), 'utf8')).toBe(VALID);
    expect(out.out()).toBe('Wrote public/llms.txt (1 link in 1 section).\n');
  });

  it('loads an .mjs config with defineConfig and prints with --stdout', async () => {
    await mkdir(join(cwd, 'conf'));
    await writeFile(
      join(cwd, 'conf', 'site.mjs'),
      `const defineConfig = (c) => c; // the package's defineConfig is the identity function\nexport default defineConfig({ name: 'From mjs', summary: 'S' });\n`,
    );
    const out = io();
    expect(await main(['build', '--config', 'conf/site.mjs', '--stdout'], out)).toBe(EXIT.OK);
    expect(out.out()).toBe('# From mjs\n\n> S\n');
  });

  it('crawls with --site and writes llms.txt and llms-full.txt', async () => {
    const out = io();
    expect(await main(['build', '--site', server.origin, '--out-dir', 'out'], out)).toBe(EXIT.OK);
    const llms = await readFile(join(cwd, 'out', 'llms.txt'), 'utf8');
    expect(llms).toBe(`# Site\n\n> A site.\n\n## Pages\n\n- [Site](${server.origin}/): A site.\n- [Doc A](${server.origin}/docs/a): About A.\n`);
    const full = await readFile(join(cwd, 'out', 'llms-full.txt'), 'utf8');
    expect(full).toContain('### A\n\nDoc A.');
    expect(out.err()).toMatch(/Read 2 pages/);
    expect(out.err()).toMatch(/Skipped 1 URL: robots 1\./);
    expect(out.out()).toMatch(/Wrote out\/llms-full\.txt/);
  });

  it('honors --skip-full, --name and --ignore-robots', async () => {
    server.routes.set('/private/b', html('<main>B</main>', '<title>B</title>'));
    const out = io();
    expect(await main(['build', '--site', server.origin, '--skip-full', '--name', 'Named', '--ignore-robots'], out)).toBe(EXIT.OK);
    const llms = await readFile(join(cwd, 'llms.txt'), 'utf8');
    expect(llms.startsWith('# Named\n')).toBe(true);
    expect(llms).toContain('/private/b');
    await expect(readFile(join(cwd, 'llms-full.txt'), 'utf8')).rejects.toThrow();
  });

  it('exits 2 without a config or site, and for an invalid config', async () => {
    const a = io();
    expect(await main(['build'], a)).toBe(EXIT.USAGE);
    expect(a.err()).toMatch(/No llms-txt\.config/);
    await writeFile(join(cwd, 'llms-txt.config.json'), JSON.stringify({ name: 'X', sections: [{ title: 'S', links: [{ title: 'A' }] }] }));
    const b = io();
    expect(await main(['build'], b)).toBe(EXIT.USAGE);
    expect(b.err()).toMatch(/sections\[0\]\.links\[0\]\.url must be a non-empty string/);
    await writeFile(join(cwd, 'llms-txt.config.json'), '{ not json');
    expect(await main(['build'], io())).toBe(EXIT.USAGE);
  });

  it('exits 1 when the crawl finds nothing', async () => {
    server.routes.set('/sitemap.xml', { status: 500 });
    const out = io();
    expect(await main(['build', '--site', server.origin], out)).toBe(EXIT.FAILED);
    expect(out.err()).toMatch(/No sitemap could be read/);
  });
});

describe('lint', () => {
  it('exits 0 for a valid file', async () => {
    await writeFile(join(cwd, 'llms.txt'), VALID);
    const out = io();
    expect(await main(['lint', 'llms.txt'], out)).toBe(EXIT.OK);
    expect(out.out()).toBe('llms.txt: no problems (1 section, 1 link).\n');
  });

  it('exits 1 for errors, and for warnings with --strict', async () => {
    await writeFile(join(cwd, 'bad.txt'), '# A\n\n## Docs\n\n- [x](\n');
    expect(await main(['lint', 'bad.txt'], io())).toBe(EXIT.FAILED);
    await writeFile(join(cwd, 'warn.txt'), '# A\n\n## Docs\n\n- [x](https://x.test)\n');
    expect(await main(['lint', 'warn.txt'], io())).toBe(EXIT.OK);
    expect(await main(['lint', 'warn.txt', '--strict'], io())).toBe(EXIT.FAILED);
  });

  it('reads standard input', async () => {
    const out = io({ stdinText: VALID });
    expect(await main(['lint', '-'], out)).toBe(EXIT.OK);
    expect(out.out()).toMatch(/^stdin: no problems/);
  });

  it('exits 2 for a missing file, a bad format or no argument', async () => {
    const a = io();
    expect(await main(['lint', 'nope.txt'], a)).toBe(EXIT.USAGE);
    expect(a.err()).toMatch(/cannot read nope\.txt: ENOENT/);
    expect(await main(['lint', 'x', '--format', 'xml'], io())).toBe(EXIT.USAGE);
    expect(await main(['lint'], io())).toBe(EXIT.USAGE);
    expect(await main(['lint', 'x', '--base-url', 'nope'], io())).toBe(EXIT.USAGE);
  });

  it('lints a URL, resolving relative links against it', async () => {
    server.routes.set('/rel.txt', text('# A\n\n> s\n\n## Docs\n\n- [a](/a)\n'));
    const out = io();
    expect(await main(['lint', `${server.origin}/rel.txt`, '--format', 'json'], out)).toBe(EXIT.OK);
    const json = JSON.parse(out.out());
    expect(json.issues).toEqual([]);
    expect(json.sections[0].links[0].resolved).toBe(`${server.origin}/a`);
  });

  it('exits 1 for a bad URL file, 2 when the URL fails, and warns about HTML', async () => {
    const a = io();
    expect(await main(['lint', `${server.origin}/bad.txt`, '--format', 'github'], a)).toBe(EXIT.FAILED);
    expect(a.out()).toMatch(/^::error file=http%3A\/\/127\.0\.0\.1%3A\d+\/bad\.txt,line=1,col=1,title=llms-txt h1-first::/);
    expect(await main(['lint', `${server.origin}/missing.txt`], io())).toBe(EXIT.USAGE);
    const c = io();
    expect(await main(['lint', `${server.origin}/html.txt`], c)).toBe(EXIT.FAILED);
    expect(c.out()).toMatch(/content-type/);
  });

  it('warns about dead links with --check-links', async () => {
    await writeFile(join(cwd, 'links.txt'), `# A\n\n> s\n\n## Docs\n\n- [ok](${server.origin}/docs/a)\n- [dead](${server.origin}/dead)\n`);
    const out = io();
    expect(await main(['lint', 'links.txt', '--check-links'], out)).toBe(EXIT.OK);
    expect(out.out()).toMatch(/links\.txt:8:1 {2}warning {2}dead-link .*\/dead answered HTTP 404\./);
    expect(await main(['lint', 'links.txt', '--check-links', '--strict'], io())).toBe(EXIT.FAILED);
  });
});
