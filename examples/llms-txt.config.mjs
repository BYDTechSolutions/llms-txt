// llms-txt.config.mjs: a hand-written list, plus pages crawled from the sitemap.
//   npx llms-txt build            writes public/llms.txt and public/llms-full.txt
//   npx llms-txt lint public/llms.txt
import { defineConfig } from '@bydtech/llms-txt';

export default defineConfig({
  name: 'Example',
  summary: 'Example is a library for building small web apps. This file lists its docs for language models.',
  details: 'Start with the quick start. Every page below is also served as plain Markdown.',
  site: 'https://example.com',
  outDir: 'public',
  sections: [
    {
      title: 'Docs',
      links: [{ title: 'Quick start', url: '/docs/quick-start', notes: 'Install, configure and run in five minutes' }],
    },
  ],
  optional: [{ title: 'Changelog', url: '/changelog', notes: 'Release notes for every version' }],
  crawl: {
    // Sitemap: robots.txt Sitemap: lines, else https://example.com/sitemap.xml
    exclude: ['/admin/', '/search'],
    groups: [
      { title: 'Docs', match: '/docs/' },
      { title: 'Blog', match: '/blog/' },
      { title: 'Optional', match: ['/legal/', '/changelog'] },
    ],
    defaultSection: 'Pages',
    titleSuffix: ' | Example',
    concurrency: 4,
    timeoutMs: 15000,
    maxPages: 500,
  },
});
