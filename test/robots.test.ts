import { describe, expect, it } from 'vitest';
import { isAllowed, matchPath, parseRobots } from '../src/index.js';

describe('matchPath', () => {
  it('matches prefixes, wildcards and the end anchor', () => {
    expect(matchPath('/blog', '/blog')).toBe(true);
    expect(matchPath('/blog', '/blogging')).toBe(true);
    expect(matchPath('/blog/', '/blog')).toBe(false);
    expect(matchPath('/$', '/')).toBe(true);
    expect(matchPath('/$', '/about')).toBe(false);
    expect(matchPath('/*.pdf$', '/files/a.pdf')).toBe(true);
    expect(matchPath('/*.pdf$', '/files/a.pdf?x=1')).toBe(false);
    expect(matchPath('/a.b(c)', '/a.b(c)/d')).toBe(true);
    expect(matchPath('/a.b', '/axb')).toBe(false);
    expect(matchPath('', '/')).toBe(false);
  });
});

describe('parseRobots and isAllowed', () => {
  const robots = parseRobots(`﻿# comment
User-agent: *
Disallow: /private/
Allow: /private/open
Disallow: /*.json$

User-agent: llms-txt
User-agent: OtherBot
Disallow: /drafts
Allow: /drafts/public   # inline comment
Disallow:

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/news.xml
`);

  it('reads groups, rules and sitemaps', () => {
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml', 'https://example.com/news.xml']);
    expect(robots.groups).toHaveLength(2);
    expect(robots.groups[1]?.agents).toEqual(['llms-txt', 'otherbot']);
  });

  it('uses the * group for other agents, longest match winning', () => {
    expect(isAllowed(robots, '/private/x', 'SomeBot/1.0')).toBe(false);
    expect(isAllowed(robots, '/private/open/page', 'SomeBot/1.0')).toBe(true);
    expect(isAllowed(robots, '/data.json', 'SomeBot')).toBe(false);
    expect(isAllowed(robots, '/drafts/a', 'SomeBot')).toBe(true);
  });

  it('uses only the group naming the product token, case-insensitively', () => {
    expect(isAllowed(robots, '/private/x', 'llms-txt/0.1.0 (+https://x.test)')).toBe(true);
    expect(isAllowed(robots, '/drafts/a', 'LLMS-TXT')).toBe(false);
    expect(isAllowed(robots, '/drafts/public/a', 'llms-txt')).toBe(true);
  });

  it('lets allow win a tie and always allows /robots.txt', () => {
    const tie = parseRobots('User-agent: *\nDisallow: /page\nAllow: /page\nDisallow: /');
    expect(isAllowed(tie, '/page', 'x')).toBe(true);
    expect(isAllowed(tie, '/other', 'x')).toBe(false);
    expect(isAllowed(tie, '/robots.txt', 'x')).toBe(true);
  });

  it('allows everything when there are no rules', () => {
    expect(isAllowed(parseRobots(''), '/anything', 'x')).toBe(true);
    expect(isAllowed(parseRobots('Disallow: /\n'), '/anything', 'x')).toBe(true);
  });
});
