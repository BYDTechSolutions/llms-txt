# Contributing

Thanks for helping. Issues and pull requests are welcome at
[github.com/BYDTechSolutions/llms-txt](https://github.com/BYDTechSolutions/llms-txt).

## Setup

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Node.js 20 or later.

## Rules

- Tests never reach the network: they run against a local `node:http` server, and
  `test/setup.ts` makes any request to another host fail. Do not point a test at a
  real site.
- The llms.txt format follows the proposal at [llmstxt.org](https://llmstxt.org/).
  If you change what `build` writes or what `lint` reports, link the part of the
  proposal that supports the change.
- An HTML-to-Markdown change comes with a test showing the input and the exact output.
- No runtime dependencies without a strong reason, stated in the README.
- Add a line to `CHANGELOG.md` under "Unreleased".
- American English in code, messages and docs.
