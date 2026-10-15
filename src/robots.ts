/*
 * robots.txt, as RFC 9309 describes it: groups of `user-agent` lines followed
 * by `allow` / `disallow` rules, `*` wildcards and a `$` end anchor, the
 * longest matching rule winning and `allow` winning a tie.
 */

/** One rule from a robots.txt group. */
export interface RobotsRule {
  allow: boolean;
  /** The path pattern as written, e.g. `/private/` or `/*.pdf$`. */
  pattern: string;
}

/** A parsed robots.txt file. */
export interface RobotsTxt {
  groups: { agents: string[]; rules: RobotsRule[] }[];
  /** `Sitemap:` URLs, in file order. */
  sitemaps: string[];
}

/** Parses robots.txt text. Unknown lines and rules outside a group are ignored. */
export function parseRobots(text: string): RobotsTxt {
  const groups: RobotsTxt['groups'] = [];
  const sitemaps: string[] = [];
  let group: RobotsTxt['groups'][number] | null = null;
  let lastWasAgent = false;

  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    if (key === 'user-agent') {
      if (!group || !lastWasAgent) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    lastWasAgent = false;
    if ((key === 'allow' || key === 'disallow') && group) {
      // An empty `disallow` allows everything, which is the same as having no rule.
      if (value) group.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  return { groups, sitemaps };
}

/**
 * Whether a path pattern matches a path. Patterns are robots.txt patterns:
 * a prefix match from the start of the path, where `*` matches any run of
 * characters and a trailing `$` anchors the end. `/blog` matches `/blog`,
 * `/blog/post` and `/blogging`; `/blog/` only the folder; `/$` only the home page.
 */
export function matchPath(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}

/** The product token a user agent string matches robots.txt groups by: `MyBot/1.0 (...)` is `mybot`. */
export function productToken(userAgent: string): string {
  return (/^[A-Za-z_-]+/.exec(userAgent.trim())?.[0] ?? '').toLowerCase();
}

/**
 * Whether robots.txt allows `userAgent` to fetch `path` (path plus query).
 * The groups naming the agent's product token apply; when none does, the `*`
 * groups apply; when none of those exists, everything is allowed.
 */
export function isAllowed(robots: RobotsTxt, path: string, userAgent: string): boolean {
  if (path === '/robots.txt') return true;
  const token = productToken(userAgent);
  let rules = robots.groups.filter((g) => token && g.agents.includes(token)).flatMap((g) => g.rules);
  if (!rules.length && !robots.groups.some((g) => token && g.agents.includes(token))) {
    rules = robots.groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules);
  }
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!matchPath(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
