# @bydtech/llms-txt

Build and lint `llms.txt` files: from a config, or by crawling your sitemap into `llms.txt` and `llms-full.txt`.

[![npm version](https://img.shields.io/npm/v/@bydtech/llms-txt.svg)](https://www.npmjs.com/package/@bydtech/llms-txt)
[![CI](https://github.com/BYDTechSolutions/llms-txt/actions/workflows/ci.yml/badge.svg)](https://github.com/BYDTechSolutions/llms-txt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why it exists

[llms.txt](https://llmstxt.org/) is a Markdown file at your site's root that tells language models what the site is and which pages matter. Written by hand, it drifts: pages get removed or reworded, and the file keeps describing what is no longer there, to every assistant that reads it. This package generates the file from the content you already have (a config, your CMS data in a route, or the pages themselves through your sitemap) and lints any llms.txt against the proposal's format.

## Install

```sh
npm install --save-dev @bydtech/llms-txt
```

Node.js 20 or later. No runtime dependencies.

## Quick start

Crawl a site and write both files:

```sh
npx llms-txt build --site https://example.com --out-dir public
```

Or describe the file yourself in `llms-txt.config.mjs`:

```js
import { defineConfig } from '@bydtech/llms-txt';

export default defineConfig({
  name: 'Example',
  summary: 'Example is a library for building small web apps.',
  site: 'https://example.com',
  outDir: 'public',
  sections: [
    {
      title: 'Docs',
      links: [
        { title: 'Quick start', url: '/docs/quick-start', notes: 'Install, configure and run' },
        { title: 'API reference', url: '/docs/api' },
      ],
    },
  ],
  optional: [{ title: 'Changelog', url: '/changelog' }],
});
```

```sh
npx llms-txt build              # writes public/llms.txt
npx llms-txt lint public/llms.txt
```

which writes:

```md
# Example

> Example is a library for building small web apps.

## Docs

- [Quick start](https://example.com/docs/quick-start): Install, configure and run
- [API reference](https://example.com/docs/api)

## Optional

- [Changelog](https://example.com/changelog)
```

Check a live file:

```sh
npx llms-txt lint https://example.com/llms.txt --check-links
```

## The format

The proposal at [llmstxt.org](https://llmstxt.org/) sets these parts, in this order:

1. An H1 with the name of the project or site. This is the only required part.
2. A blockquote with a short summary holding the key information needed to understand the rest of the file.
3. Zero or more Markdown sections of any kind except headings (paragraphs, lists).
4. Zero or more sections delimited by H2 headings, each a "file list": Markdown list items holding a required `[name](url)` link, optionally followed by `:` and notes.

A section titled `Optional` has a special meaning: its links are secondary, and an agent can skip them when it needs a shorter context. `build` always puts it last.

`llms-full.txt` is not part of the proposal. It is a common companion file holding the full text of the site in one Markdown document; `build` writes it when it crawls.

## CLI reference

```
llms-txt build [options]
llms-txt lint <file | url | -> [options]
```

### `llms-txt build`

Reads `llms-txt.config.mjs`, `.js` or `.json` from the current directory (or `--config`), then:

- **Without a crawl**, renders the configured name, summary, details, sections and optional links into `llms.txt`. Relative link URLs resolve against `site`.
- **With a crawl** (a `crawl` key in the config, or `--site`), reads robots.txt and the sitemap, fetches every allowed page, groups the pages into sections, and writes `llms.txt` and `llms-full.txt`. Configured sections come first; crawled pages with the same section title join them.

With `--site` and no config file, everything comes from the site: the H1 from the home page's `og:site_name` or title, the summary from its meta description.

Before writing, `build` lints its own output and refuses to write a file with errors. It prints a count of pages read and every URL skipped, with the reason.

| Option | Default | |
|---|---|---|
| `--config <file>` | `llms-txt.config.mjs`, `.js` or `.json` in the current directory | Configuration file |
| `--out-dir <dir>` | `outDir` from the config (relative to the config file), else `.` | Where to write |
| `--stdout` | off | Print llms.txt, write nothing |
| `--site <url>` | `site` from the config | Crawl this site |
| `--sitemap <url>` | robots.txt `Sitemap:` lines, else `<site>/sitemap.xml` | Sitemap or sitemap index |
| `--name <text>` | `name`, else the home page's `og:site_name` or title | The H1 |
| `--summary <text>` | `summary`, else the home page's meta description | The blockquote |
| `--user-agent <token>` | `llms-txt` | Product token for robots.txt and the `User-Agent` header |
| `--concurrency <n>` | `4` | Pages fetched at once |
| `--timeout <ms>` | `15000` | Timeout per request |
| `--max-pages <n>` | `500` | Stop after this many pages |
| `--ignore-robots` | off | Crawl pages robots.txt disallows |
| `--skip-full` | off | Do not write llms-full.txt |

### `llms-txt lint`

Checks a file, a URL, or standard input (`-`) against the format above.

| Rule | Severity | When |
|---|---|---|
| `h1-first` | error | The file does not start with an H1 (or is empty). |
| `h1-empty` | error | The H1 has no text. |
| `multiple-h1` | error | A second H1. |
| `heading-level` | error | An H3 to H6 anywhere: the proposal allows no headings before the sections, and only H2 to delimit them. |
| `section-title` | error | An H2 with no text. |
| `link-syntax` | error | A list item starts with `[` but is not a well-formed `[name](url)`. |
| `link-title` | error | A link with an empty name. |
| `link-url` | error | A link with an empty URL. |
| `invalid-url` | error | A URL that does not parse. |
| `summary` | warning | No blockquote right after the H1. |
| `not-a-link` | warning | A list item in a section that is not a link. |
| `link-notes` | warning | Text after a link that does not start with `:`. |
| `section-content` | warning | Prose, a quote or a code block inside a section. |
| `empty-section` | warning | An H2 with no links. |
| `duplicate-section` | warning | Two H2s with the same title (ignoring case). |
| `relative-url` | warning | A relative URL with no base to resolve it against. |
| `url-scheme` | warning | A URL that is not http or https, such as `mailto:`. |
| `content-type` | warning | A URL served as `text/html` (often a catch-all route, not the file). |
| `dead-link` | warning | With `--check-links`: a link that fails or answers HTTP 400 or above. |

Headings inside fenced code blocks are ignored. Indented lines and lines continuing a list item count as part of it.

| Option | Default | |
|---|---|---|
| `--format <format>` | `text` | `text`, `json`, or `github` (workflow commands that annotate the file in a pull request) |
| `--base-url <url>` | the file's URL, when linting a URL | Resolve relative links against this URL |
| `--check-links` | off | Request every http(s) link: `HEAD`, then `GET` if `HEAD` fails. Each URL once, four at a time. |
| `--strict` | off | Exit 1 on warnings too |
| `--timeout <ms>` | `10000` | Timeout per request |

### Exit codes

| Code | `build` | `lint` |
|---|---|---|
| `0` | Files written | No errors (warnings allowed, unless `--strict`) |
| `1` | The crawl failed (no sitemap, robots.txt unreachable, no page readable) or the output had errors | Errors found, or warnings with `--strict` |
| `2` | Usage or configuration error | Usage error, or the file or URL could not be read |

## API reference

```ts
import { build, crawl, lint, htmlToMarkdown, toResponse } from '@bydtech/llms-txt';

const text = build({ name: 'Example', summary: '...', sections: [/* ... */] });

const result = await crawl({ site: 'https://example.com', groups: [{ title: 'Docs', match: '/docs/' }] });
await writeFile('public/llms.txt', result.llmsTxt);
await writeFile('public/llms-full.txt', result.llmsFullTxt);

const report = lint(text);           // { ok, errors, warnings, issues, title, summary, sections }

htmlToMarkdown('<h2>Hi</h2><p>A <a href="/x">link</a></p>', { baseUrl: 'https://example.com' });
// '## Hi\n\nA [link](https://example.com/x)'
```

| Function | What it does |
|---|---|
| `build(config)` | Renders llms.txt from a config. Throws `LlmsTxtError` (`CONFIG`) when the name is missing, `details` has a heading, or the config is invalid. |
| `buildFull(config, pages)` | Renders llms-full.txt from `{ url, title, description?, markdown }` pages. |
| `crawl(options)` | Crawls a site; returns `{ name, summary, pages, skipped, sections, sitemaps, robots, warnings, llmsTxt, llmsFullTxt }`. Options are the [crawl options](#configuration) plus `site`, `name?`, `summary?`, `details?`, `sections?`, `optional?`, `fetch?` and `onPage?` (a progress callback). |
| `lint(text, { baseUrl? })` | Lints llms.txt text. Synchronous; never throws. |
| `checkLinks(result, options?)` | Requests every link in a lint result and returns `dead-link` issues. Options: `fetch?`, `timeoutMs?` (10000), `concurrency?` (4), `userAgent?`. |
| `withIssues(result, issues)` | Adds issues to a lint result and recounts it. |
| `formatReport(result, file, format?)` | Formats a lint result as `text`, `json` or `github`. |
| `htmlToMarkdown(html, options?)` | Converts HTML to Markdown. Options: `baseUrl?`, `headingOffset?` (0), `images?` (true). |
| `extractPage(html, { url? })` | Returns a page's `title`, `description`, `siteName`, `canonical`, `noindex`, `source` and main content as `markdown`. |
| `toResponse(text, init?)` | A web `Response` with `Content-Type: text/plain; charset=utf-8`, for route handlers. `init`: `status?`, `headers?`. |
| `defineConfig(config)` | Returns the config unchanged, typed. |
| `loadConfig(file)`, `findConfig(dir)`, `validateConfig(value)` | Load, find and check a configuration file. |
| `parseRobots(text)`, `isAllowed(robots, path, userAgent)`, `matchPath(pattern, path)` | robots.txt parsing and matching. |
| `parseSitemap(xml)`, `readSitemap(url, options?)` | Sitemap parsing and reading. |
| `parseHtml(html)`, `decodeEntities(text)` | The HTML parser underneath. |

`LlmsTxtError` has a `code` (`CONFIG`, `INVALID_URL`, `SITEMAP`, `FETCH` or `NO_PAGES`) and `details` listing every problem found. All types are exported.

### Serving llms.txt from a framework route

`toResponse` lets a route build the file from the same data the pages render, at build or request time. A Next.js App Router route, `app/llms.txt/route.ts`:

```ts
import { build, toResponse } from '@bydtech/llms-txt';
import { getDocs } from '@/lib/docs'; // your own content source

export const dynamic = 'force-static';

export async function GET() {
  const docs = await getDocs();
  return toResponse(
    build({
      name: 'Example',
      summary: 'Example is a library for building small web apps.',
      site: 'https://example.com',
      sections: [{ title: 'Docs', links: docs.map((d) => ({ title: d.title, url: `/docs/${d.slug}`, notes: d.excerpt })) }],
    }),
  );
}
```

The same works in any framework whose routes return a web `Response` (Remix, Astro, SvelteKit, Hono). See [`examples/`](examples) for this route and sample configs.

## Configuration

`llms-txt.config.mjs` / `.js` (default export) or `llms-txt.config.json`:

| Key | Default | |
|---|---|---|
| `name` | none; required unless a crawl reads it from the home page | The H1 |
| `summary` | none (a crawl uses the home page's meta description) | The blockquote; each line becomes a `> ` line |
| `details` | none | Markdown prose after the summary; no headings allowed |
| `sections` | `[]` | `[{ title, links: [{ title, url, notes? }] }]`, in order. Sections with the same title merge; empty ones are left out. |
| `optional` | `[]` | Links for `## Optional` |
| `site` | none | The site's origin. Relative link URLs resolve against it; a crawl starts from it. |
| `outDir` | `.` | Where `build` writes, relative to the config file |
| `crawl` | none | Crawl the site (below) |

`crawl` options:

| Key | Default | |
|---|---|---|
| `sitemap` | robots.txt `Sitemap:` lines, else `<site>/sitemap.xml` | Sitemap or sitemap index URL |
| `urls` | `[]` | More URLs or paths to crawl |
| `include` | every path | Only crawl paths matching one of these patterns |
| `exclude` | `[]` | Never crawl paths matching one of these patterns |
| `groups` | `[]` | `[{ title, match }]`: the first group whose pattern matches a page's path is its section. A group titled `Optional` fills `## Optional`. |
| `defaultSection` | `"Pages"` | Section for pages no group matches; `false` leaves them out of llms.txt (they stay in llms-full.txt) |
| `titleSuffix` | none | Removed from the end of page titles, e.g. `" \| Example"` |
| `userAgent` | `"llms-txt"` | Product token for robots.txt and the `User-Agent` header |
| `respectRobots` | `true` | Obey robots.txt |
| `respectNoindex` | `true` | Skip pages with `<meta name="robots" content="noindex">` |
| `concurrency` | `4` | Pages fetched at once |
| `timeoutMs` | `15000` | Timeout per request, in milliseconds |
| `maxPages` | `500` | Stop after this many pages |
| `full` | `true` | Write llms-full.txt |

**Path patterns** (`include`, `exclude`, `groups[].match`) work like robots.txt rules: a prefix match on the path and query, where `*` matches any characters and a trailing `$` anchors the end. `/blog` matches `/blog`, `/blog/post` and `/blogging`; `/blog/` matches only inside the folder; `/$` matches only the home page.

## How it works, and its limits

- **Crawl order.** robots.txt first (its rules and `Sitemap:` lines), then the sitemap (sitemap index files followed three levels deep, gzip decompressed), then each page, at most `concurrency` at a time, each with its own timeout. Only pages on the site's origin are read: a sitemap entry or a redirect to another host is skipped, and so is a non-HTML response, an HTTP error, or a `noindex` page.
- **robots.txt** follows [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309): the group naming the crawler's product token applies (case-insensitive), else the `*` group; the longest matching rule wins and `allow` wins a tie. A missing robots.txt (HTTP 4xx) allows everything. An unreachable one (HTTP 5xx or a network error) disallows everything, as the RFC says, so the crawl stops; `--ignore-robots` overrides it. Percent-encoded paths are compared as written.
- **Sections.** Pages go into the first group whose pattern matches, else into `defaultSection`, in sitemap order. Sections appear in the order of `sections`, then `groups`, then the default section, with `Optional` last. Each link's notes are the page's meta description.
- **llms-full.txt** has the same H1 and summary, then every page as an H2 with its URL, description and content, in llms.txt order. Page headings move down two levels (`<h1>` becomes `###`) so they sit under the page's H2.
- **Content extraction.** The content is the first `<main>`, else `[role=main]`, else the only `<article>`, else `<body>`. Navigation, scripts, styles, buttons and form controls, SVG, iframes and hidden elements are removed; when falling back to `<body>`, so are `<header>`, `<footer>` and `<aside>`. The title is `<title>`, else `og:title`, else the first `<h1>`.
- **HTML to Markdown.** A small tokenizer, not a full HTML5 parser. It handles tags, attributes, comments, CDATA, raw-text elements and the common implied end tags (`p`, `li`, `dt`/`dd`, `tr`, `td`/`th`), and about 140 named entities plus all numeric ones. It converts headings, paragraphs, line breaks, emphasis, strikethrough, links, images with alt text, nested and ordered lists, blockquotes, inline code, fenced code with the language from a `language-*` class, rules, definition lists, and tables with one header row. Table cells are flattened to one line, and `colspan`/`rowspan` are ignored. Same-page `#anchor` links become plain text.
- **No JavaScript.** Pages are read as the server sends them. Content a page only renders in the browser is not seen; most frameworks render on the server or at build time, which is what this reads.
- **Encoding.** Responses are decoded as UTF-8.
- **Lint scope.** `lint` checks the structure the proposal defines and the links' syntax. It does not judge the content, and it does not lint llms-full.txt, which has no defined format.
- **No runtime dependencies.** It uses Node's global `fetch`, `node:util` `parseArgs`, `node:zlib` for gzipped sitemaps and `node:fs`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

---

Maintained by [BYD Tech](https://bydtech.in), a software studio that builds MVPs, AI agents, and web & mobile apps.
