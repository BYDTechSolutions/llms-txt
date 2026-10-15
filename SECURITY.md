# Security policy

## Reporting a vulnerability

Please email **sales.bydtech@gmail.com** with the details, instead of opening a
public issue. We will acknowledge the report and keep you posted on the fix.

## Scope

`llms-txt build` with a crawl fetches the pages listed in a sitemap and parses
their HTML; `llms-txt lint --check-links` requests every link in a file. Both
make only GET and HEAD requests, never run the pages' scripts, and write only
`llms.txt` and `llms-full.txt` to the output directory. A crawl stays on the
site's origin; `lint --check-links` follows whatever URLs the file lists, so
run it only on files you trust. A configuration file in `.mjs` or `.js` is
code and runs with your permissions, like any other build script.
