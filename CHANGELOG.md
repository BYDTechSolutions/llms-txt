# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-21

### Changed

- Published from GitHub Actions through npm trusted publishing, with a
  provenance attestation linking the package to this repository. No code changes.

## [0.1.0] - 2026-10-16

### Added

- `llms-txt build`: write `llms.txt` from `llms-txt.config.{mjs,js,json}` in the format of the llmstxt.org proposal (H1, blockquote summary, prose, H2 file lists, `## Optional` last), and lint the output before writing it.
- Crawling, from the config or `--site`: robots.txt (RFC 9309) rules and `Sitemap:` lines, sitemap index files and gzip, a concurrency limit and per-request timeouts, `noindex` pages skipped, pages grouped into sections by path patterns, and `llms-full.txt` with every page's content as Markdown.
- `llms-txt lint <file|url|->`: errors and warnings against the proposal's format, `--check-links` for dead links, `--strict`, output as text, JSON or GitHub workflow commands, and exit codes 0, 1 and 2.
- A dependency-free HTML parser and HTML-to-Markdown converter: headings, paragraphs, emphasis, links, images, lists, blockquotes, code, rules and basic tables.
- API: `build`, `buildFull`, `crawl`, `lint`, `checkLinks`, `formatReport`, `htmlToMarkdown`, `extractPage`, `toResponse`, `defineConfig`, `loadConfig`, `parseRobots`, `isAllowed`, `readSitemap` and more.
- A Next.js App Router example serving `/llms.txt` with `toResponse`.

[Unreleased]: https://github.com/BYDTechSolutions/llms-txt/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/BYDTechSolutions/llms-txt/releases/tag/v0.1.1
[0.1.0]: https://github.com/BYDTechSolutions/llms-txt/tree/e79f4b5618834bfb50e95e51c74ae3a74358a42e
