import type { LintIssue, LintResult } from './lint.js';

/** Output formats for lint results. */
export type ReportFormat = 'text' | 'json' | 'github';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line per issue (`file:line:column  severity  rule  message`), then a count. */
export function formatText(result: LintResult, file: string): string {
  const lines = result.issues.map(
    (i) => `${file}:${i.line}:${i.column}  ${i.severity.padEnd(7)}  ${i.rule.padEnd(17)}  ${i.message}`,
  );
  const links = result.sections.reduce((n, s) => n + s.links.length, 0);
  const shape = `${plural(result.sections.length, 'section')}, ${plural(links, 'link')}`;
  lines.push(
    result.issues.length
      ? `${file}: ${plural(result.errors, 'error')}, ${plural(result.warnings, 'warning')} (${shape}).`
      : `${file}: no problems (${shape}).`,
  );
  return `${lines.join('\n')}\n`;
}

/** The result as JSON, with the file name. */
export function formatJson(result: LintResult, file: string): string {
  return `${JSON.stringify({ file, ok: result.ok, errors: result.errors, warnings: result.warnings, issues: result.issues, title: result.title, summary: result.summary, sections: result.sections }, null, 2)}\n`;
}

const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** GitHub Actions workflow commands, which show each issue as an annotation on the file. */
export function formatGithub(result: LintResult, file: string): string {
  const line = (i: LintIssue) =>
    `::${i.severity} file=${escapeProperty(file)},line=${i.line},col=${i.column},title=${escapeProperty(`llms-txt ${i.rule}`)}::${escapeData(i.message)}`;
  return result.issues.map((i) => `${line(i)}\n`).join('');
}

/** Formats a lint result. */
export function formatReport(result: LintResult, file: string, format: ReportFormat = 'text'): string {
  if (format === 'json') return formatJson(result, file);
  if (format === 'github') return formatGithub(result, file);
  return formatText(result, file);
}
