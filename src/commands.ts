import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { build } from './build.js';
import { findConfig, loadConfig, type LlmsTxtConfig } from './config.js';
import { crawl, type SkippedPage } from './crawl.js';
import { LlmsTxtError } from './errors.js';
import { get } from './http.js';
import { checkLinks, lint, withIssues, type LintIssue } from './lint.js';
import { formatReport, type ReportFormat } from './report.js';
import { PRODUCT_TOKEN, USER_AGENT, VERSION, userAgentFor } from './version.js';

/** Exit codes: 0 success, 1 the build or lint failed, 2 bad usage or input. */
export const EXIT = { OK: 0, FAILED: 1, USAGE: 2 } as const;

/** Everything the CLI touches outside itself, so tests can replace it. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  cwd: string;
  fetch?: typeof fetch;
}

export const HELP = `llms-txt ${VERSION}: build and lint llms.txt files

Usage:
  llms-txt build [options]
  llms-txt lint <file | url | -> [options]

Commands:
  build    Write llms.txt from llms-txt.config.{mjs,js,json}. With a crawl
           (a "crawl" key in the config, or --site), read the sitemap and
           write llms-full.txt too.
  lint     Check an llms.txt file or URL against the llmstxt.org format.

Options for build:
  --config <file>        Configuration file (default: llms-txt.config.mjs, .js
                         or .json in the current directory)
  --out-dir <dir>        Where to write (default: outDir in the config, else .)
  --stdout               Print llms.txt instead of writing files
  --site <url>           Crawl this site (overrides site in the config)
  --sitemap <url>        Sitemap to read (default: robots.txt Sitemap: lines,
                         else <site>/sitemap.xml)
  --name <text>          The H1 (default: name in the config, else the home
                         page's og:site_name or title)
  --summary <text>       The blockquote (default: summary in the config, else
                         the home page's meta description)
  --user-agent <token>   Product token for robots.txt and User-Agent
                         (default: ${PRODUCT_TOKEN})
  --concurrency <n>      Pages fetched at once (default: 4)
  --timeout <ms>         Timeout per request (default: 15000)
  --max-pages <n>        Stop after this many pages (default: 500)
  --ignore-robots        Crawl pages robots.txt disallows
  --skip-full            Do not write llms-full.txt

Options for lint:
  --format <format>      text, json or github (default: text)
  --base-url <url>       Resolve relative links against this URL (default: the
                         file's URL when linting a URL)
  --check-links          Request every link; warn about those that fail
  --strict               Exit 1 on warnings too
  --timeout <ms>         Timeout per request (default: 10000)

  -h, --help             Show this help
  -v, --version          Show the version

Exit codes: 0 ok, 1 build failed or lint found errors, 2 usage or input error.
`;

class UsageError extends Error {}

const BUILD_OPTIONS = {
  config: { type: 'string' },
  'out-dir': { type: 'string' },
  stdout: { type: 'boolean' },
  site: { type: 'string' },
  sitemap: { type: 'string' },
  name: { type: 'string' },
  summary: { type: 'string' },
  'user-agent': { type: 'string' },
  concurrency: { type: 'string' },
  timeout: { type: 'string' },
  'max-pages': { type: 'string' },
  'ignore-robots': { type: 'boolean' },
  'skip-full': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies ParseArgsConfig['options'];

const LINT_OPTIONS = {
  format: { type: 'string' },
  'base-url': { type: 'string' },
  'check-links': { type: 'boolean' },
  strict: { type: 'boolean' },
  timeout: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies ParseArgsConfig['options'];

function parse<O extends NonNullable<ParseArgsConfig['options']>>(args: string[], options: O) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function positiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag} must be a whole number of at least 1 (got "${value}").`);
  return n;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function reportSkipped(skipped: SkippedPage[], io: CliIo): void {
  if (!skipped.length) return;
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  io.stderr(`Skipped ${plural(skipped.length, 'URL')}: ${[...counts].map(([r, n]) => `${r} ${n}`).join(', ')}.\n`);
  for (const s of skipped.slice(0, 20)) io.stderr(`  ${s.url}: ${s.reason} (${s.detail})\n`);
  if (skipped.length > 20) io.stderr(`  and ${skipped.length - 20} more.\n`);
}

async function runBuild(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse(args, BUILD_OPTIONS);
  if (values.help) return help(io);
  if (positionals.length) throw new UsageError(`build takes no arguments (got "${positionals[0]}").`);

  const concurrency = positiveInt(values.concurrency, '--concurrency');
  const timeoutMs = positiveInt(values.timeout, '--timeout');
  const maxPages = positiveInt(values['max-pages'], '--max-pages');

  let config: LlmsTxtConfig = {};
  let configDir = io.cwd;
  const configFile = values.config ? resolve(io.cwd, values.config) : await findConfig(io.cwd);
  if (configFile) {
    config = { ...(await loadConfig(configFile)) };
    configDir = resolve(configFile, '..');
  } else if (!values.site) {
    throw new UsageError('No llms-txt.config.mjs, .js or .json in this directory. Pass --config <file>, or --site <url> to crawl a site.');
  }

  if (values.name !== undefined) config.name = values.name;
  if (values.summary !== undefined) config.summary = values.summary;
  if (values.site !== undefined) config.site = values.site;
  const outDir = resolve(values['out-dir'] ? io.cwd : configDir, values['out-dir'] ?? config.outDir ?? '.');

  const crawling = values.site !== undefined || config.crawl !== undefined;
  let llmsTxt: string;
  let llmsFullTxt: string | null = null;

  if (crawling) {
    if (!config.site) throw new UsageError('A crawl needs the site: set site in the configuration, or pass --site.');
    const c = config.crawl ?? {};
    const result = await crawl({
      ...c,
      site: config.site,
      name: config.name,
      summary: config.summary,
      details: config.details,
      sections: config.sections,
      optional: config.optional,
      sitemap: values.sitemap ?? c.sitemap,
      userAgent: values['user-agent'] ?? c.userAgent,
      concurrency: concurrency ?? c.concurrency,
      timeoutMs: timeoutMs ?? c.timeoutMs,
      maxPages: maxPages ?? c.maxPages,
      respectRobots: values['ignore-robots'] ? false : c.respectRobots,
      fetch: io.fetch,
    });
    for (const warning of result.warnings) io.stderr(`Warning: ${warning}\n`);
    io.stderr(`Read ${plural(result.pages.length, 'page')} from ${result.sitemaps.join(', ')}.\n`);
    reportSkipped(result.skipped, io);
    llmsTxt = result.llmsTxt;
    if (!values['skip-full'] && c.full !== false) llmsFullTxt = result.llmsFullTxt;
  } else {
    llmsTxt = build(config);
  }

  // The generated file must pass its own lint.
  const check = lint(llmsTxt, { baseUrl: config.site });
  const errors = check.issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    io.stderr(formatReport({ ...check, issues: errors }, 'llms.txt'));
    io.stderr('The generated llms.txt has errors; nothing was written.\n');
    return EXIT.FAILED;
  }
  for (const w of check.issues) io.stderr(`Warning: llms.txt:${w.line}: ${w.message}\n`);

  if (values.stdout) {
    io.stdout(llmsTxt);
    return EXIT.OK;
  }
  await mkdir(outDir, { recursive: true });
  const links = check.sections.reduce((n, s) => n + s.links.length, 0);
  const show = (file: string) => relative(io.cwd, file) || file;
  const llmsFile = resolve(outDir, 'llms.txt');
  await writeFile(llmsFile, llmsTxt);
  io.stdout(`Wrote ${show(llmsFile)} (${plural(links, 'link')} in ${plural(check.sections.length, 'section')}).\n`);
  if (llmsFullTxt !== null) {
    const fullFile = resolve(outDir, 'llms-full.txt');
    await writeFile(fullFile, llmsFullTxt);
    io.stdout(`Wrote ${show(fullFile)} (${(Buffer.byteLength(llmsFullTxt) / 1024).toFixed(1)} KB).\n`);
  }
  return EXIT.OK;
}

const FORMATS: ReportFormat[] = ['text', 'json', 'github'];

async function runLint(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse(args, LINT_OPTIONS);
  if (values.help) return help(io);
  const format = (values.format ?? 'text') as ReportFormat;
  if (!FORMATS.includes(format)) throw new UsageError(`--format must be text, json or github (got "${values.format}").`);
  if (positionals.length !== 1) throw new UsageError('lint takes one file, URL, or - for standard input.');
  const timeoutMs = positiveInt(values.timeout, '--timeout') ?? 10_000;
  let baseUrl = values['base-url'];
  if (baseUrl !== undefined) {
    try {
      baseUrl = new URL(baseUrl).href;
    } catch {
      throw new UsageError(`--base-url is not a URL: "${baseUrl}".`);
    }
  }

  const target = positionals[0] as string;
  let text: string;
  const extra: LintIssue[] = [];
  if (/^https?:\/\//i.test(target)) {
    let res;
    try {
      res = await get(target, { fetch: io.fetch, timeoutMs, userAgent: USER_AGENT, accept: 'text/plain, text/markdown;q=0.9, */*;q=0.1' });
    } catch (error) {
      io.stderr(`llms-txt: ${(error as Error).message}\n`);
      return EXIT.USAGE;
    }
    if (!res.ok) {
      io.stderr(`llms-txt: ${target} answered HTTP ${res.status}.\n`);
      return EXIT.USAGE;
    }
    text = res.body.toString('utf8');
    baseUrl ??= res.url;
    if (/^text\/html\b/.test(res.contentType)) {
      extra.push({
        severity: 'warning',
        rule: 'content-type',
        line: 1,
        column: 1,
        message: `Served as ${res.contentType}. Serve llms.txt as text/plain or text/markdown; an HTML page here is often a catch-all route, not the file.`,
      });
    }
  } else if (target === '-') {
    text = await io.readStdin();
  } else {
    try {
      text = await readFile(resolve(io.cwd, target), 'utf8');
    } catch (error) {
      io.stderr(`llms-txt: cannot read ${target}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}\n`);
      return EXIT.USAGE;
    }
  }

  let result = lint(text, { baseUrl });
  if (values['check-links']) {
    extra.push(...(await checkLinks(result, { fetch: io.fetch, timeoutMs, userAgent: userAgentFor(undefined) })));
  }
  if (extra.length) result = withIssues(result, extra);

  const label = target === '-' ? 'stdin' : target;
  io.stdout(formatReport(result, label, format));
  if (!result.ok) return EXIT.FAILED;
  if (values.strict && result.warnings) return EXIT.FAILED;
  return EXIT.OK;
}

function help(io: CliIo): number {
  io.stdout(HELP);
  return EXIT.OK;
}

const USAGE_CODES = new Set(['CONFIG', 'INVALID_URL']);

/** Runs the CLI with `argv` (without `node` and the script) and returns the exit code. */
export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'build':
        return await runBuild(rest, io);
      case 'lint':
        return await runLint(rest, io);
      case undefined:
      case '-h':
      case '--help':
      case 'help':
        return help(io);
      case '-v':
      case '--version':
        io.stdout(`${VERSION}\n`);
        return EXIT.OK;
      default:
        throw new UsageError(`Unknown command "${command}". Use build or lint.`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`llms-txt: ${error.message}\nRun "llms-txt --help" for usage.\n`);
      return EXIT.USAGE;
    }
    if (error instanceof LlmsTxtError) {
      io.stderr(`llms-txt: ${error.message}\n`);
      for (const line of error.details) io.stderr(`  ${line}\n`);
      return USAGE_CODES.has(error.code) ? EXIT.USAGE : EXIT.FAILED;
    }
    io.stderr(`llms-txt: ${(error as Error).message ?? String(error)}\n`);
    return EXIT.FAILED;
  }
}
