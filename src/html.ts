/*
 * A small, forgiving HTML parser: enough to pull readable content out of the
 * pages a site serves, with no dependencies. It is not a spec-compliant HTML5
 * parser. It understands tags, attributes, comments, raw-text elements and
 * the common implied end tags (p, li, dt/dd, tr, td/th, option), and ignores
 * an end tag that matches nothing open. It does not run scripts, so content a
 * page renders in the browser only is not seen.
 */

/** A text node. `value` has entities decoded. */
export interface HtmlText {
  type: 'text';
  value: string;
}

/** An element node. Tag names and attribute names are lowercase. */
export interface HtmlElement {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlElement | null;
}

export type HtmlNode = HtmlText | HtmlElement;

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is text up to the matching end tag, never markup. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'iframe', 'noembed', 'noframes']);

/** Raw-text elements whose content still has entities decoded. */
const ESCAPABLE_RAW_TEXT = new Set(['textarea', 'title']);

/** Starting one of these closes an open `<p>`. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p',
  'pre', 'section', 'table', 'ul',
]);

/** Inline elements a `<p>` may contain; anything else stops the search for an open `<p>`. */
const PHRASING = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small',
  'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'del', 'ins', 'label', 'font',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  shy: '­', zwj: '‍', zwnj: '‌', copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', minus: '−', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', lsaquo: '‹',
  rsaquo: '›', bull: '•', middot: '·', times: '×', divide: '÷', deg: '°',
  plusmn: '±', para: '¶', sect: '§', cent: '¢', pound: '£', euro: '€', yen: '¥',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐',
  check: '✓', star: '☆', hearts: '♥', le: '≤', ge: '≥', ne: '≠', asymp: '≈',
  infin: '∞', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³',
  iexcl: '¡', iquest: '¿', prime: '′', Prime: '″', dagger: '†', Dagger: '‡',
  permil: '‰', micro: 'µ', not: '¬', ordf: 'ª', ordm: 'º', acute: '´', uml: '¨',
  cedil: '¸', macr: '¯', brvbar: '¦', curren: '¤', szlig: 'ß', agrave: 'à',
  aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì',
  iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò', oacute: 'ó',
  ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú',
  ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ', Agrave: 'À', Aacute: 'Á',
  Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í',
  Icirc: 'Î', Iuml: 'Ï', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô',
  Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û',
  Uuml: 'Ü', Yacute: 'Ý',
};

/** Entities browsers also accept without the trailing semicolon. */
const LEGACY = new Set(['amp', 'lt', 'gt', 'quot', 'nbsp', 'copy', 'reg']);

/**
 * Decodes HTML character references: numeric ones (`&#38;`, `&#x26;`) and a
 * table of about 150 common named ones. Unknown names are left as they are.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*)(;?)/g, (match, ref: string, semi: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      return String.fromCodePoint(code);
    }
    const value = NAMED_ENTITIES[ref];
    if (value === undefined || (!semi && !LEGACY.has(ref))) return match;
    return value;
  });
}

function element(tag: string, attrs: Record<string, string>, parent: HtmlElement | null): HtmlElement {
  return { type: 'element', tag, attrs, children: [], parent };
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTR)) {
    const name = (m[1] as string).toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Index of the `>` that ends a tag starting at `from`, skipping quoted attribute values. */
function tagEnd(html: string, from: number): number {
  let quote: string | null = null;
  let lastNonSpace = '';
  for (let i = from; i < html.length; i++) {
    const c = html[i] as string;
    if (quote) {
      if (c === quote) {
        quote = null;
        lastNonSpace = c;
      }
      continue;
    }
    // Only a quote right after `=` opens an attribute value.
    if ((c === '"' || c === "'") && lastNonSpace === '=') quote = c;
    else if (c === '>') return i;
    if (!/\s/.test(c)) lastNonSpace = c;
  }
  return -1;
}

/** Parses an HTML document or fragment into a tree under a synthetic `#root` element. */
export function parseHtml(html: string): HtmlElement {
  const root = element('#root', {}, null);
  const stack: HtmlElement[] = [root];
  const current = () => stack[stack.length - 1] as HtmlElement;

  const addText = (value: string) => {
    if (!value) return;
    const parent = current();
    const last = parent.children[parent.children.length - 1];
    if (last && last.type === 'text') last.value += value;
    else parent.children.push({ type: 'text', value });
  };

  /** Pops the stack up to and including the nearest `tag`, unless a `boundary` element comes first. */
  const closeOpen = (tags: Set<string>, boundaries: Set<string>) => {
    for (let i = stack.length - 1; i > 0; i--) {
      const tag = (stack[i] as HtmlElement).tag;
      if (tags.has(tag)) {
        stack.length = i;
        return;
      }
      if (boundaries.has(tag)) return;
    }
  };

  const openP = () => {
    for (let i = stack.length - 1; i > 0; i--) {
      const tag = (stack[i] as HtmlElement).tag;
      if (tag === 'p') {
        stack.length = i;
        return;
      }
      if (!PHRASING.has(tag)) return;
    }
  };

  const LI = new Set(['li']);
  const LIST = new Set(['ul', 'ol', 'menu', 'table']);
  const DTDD = new Set(['dt', 'dd']);
  const DL = new Set(['dl', 'table']);
  const CELL = new Set(['td', 'th']);
  const ROW = new Set(['tr']);
  const ROW_SCOPE = new Set(['table', 'thead', 'tbody', 'tfoot']);
  const TABLE = new Set(['table']);
  const SECTIONS = new Set(['thead', 'tbody', 'tfoot']);
  const OPTION = new Set(['option']);
  const SELECT = new Set(['select', 'datalist', 'optgroup']);

  const startTag = (tag: string, attrs: Record<string, string>, selfClosing: boolean) => {
    if (CLOSES_P.has(tag)) openP();
    if (tag === 'li') closeOpen(LI, LIST);
    else if (tag === 'dt' || tag === 'dd') closeOpen(DTDD, DL);
    else if (tag === 'tr') closeOpen(ROW, ROW_SCOPE);
    else if (tag === 'td' || tag === 'th') closeOpen(CELL, new Set(['tr', ...ROW_SCOPE]));
    else if (SECTIONS.has(tag)) closeOpen(SECTIONS, TABLE);
    else if (tag === 'option') closeOpen(OPTION, SELECT);

    const node = element(tag, attrs, current());
    current().children.push(node);
    if (!VOID.has(tag) && !selfClosing) stack.push(node);
  };

  const endTag = (tag: string) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if ((stack[i] as HtmlElement).tag === tag) {
        stack.length = i;
        return;
      }
    }
  };

  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      addText(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(html.slice(i, lt)));
    i = lt;

    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', i)) {
      const end = html.indexOf(']]>', i + 9);
      addText(html.slice(i + 9, end === -1 ? n : end));
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const end = html.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const closing = html[i + 1] === '/';
    const nameMatch = /^[A-Za-z][A-Za-z0-9:-]*/.exec(html.slice(i + (closing ? 2 : 1), i + (closing ? 2 : 1) + 64));
    if (!nameMatch) {
      addText('<');
      i += 1;
      continue;
    }
    const end = tagEnd(html, i + 1);
    if (end === -1) {
      addText(decodeEntities(html.slice(i)));
      break;
    }
    const tag = nameMatch[0].toLowerCase();
    if (closing) {
      endTag(tag);
      i = end + 1;
      continue;
    }

    const inner = html.slice(i + 1 + nameMatch[0].length, end);
    const selfClosing = inner.trimEnd().endsWith('/');
    const attrs = parseAttrs(selfClosing ? inner.trimEnd().slice(0, -1) : inner);
    startTag(tag, attrs, selfClosing);
    i = end + 1;

    if (RAW_TEXT.has(tag) && !selfClosing) {
      const closeRe = new RegExp(`</${tag}[\\s/>]`, 'i');
      const rest = html.slice(i);
      const m = closeRe.exec(rest);
      const raw = m ? rest.slice(0, m.index) : rest;
      addText(ESCAPABLE_RAW_TEXT.has(tag) ? decodeEntities(raw) : raw);
      if (m) {
        const close = html.indexOf('>', i + m.index);
        i = close === -1 ? n : close + 1;
      } else {
        i = n;
      }
      endTag(tag);
    }
  }
  return root;
}

/** Every element under `node` (depth first, document order) for which `test` is true. */
export function findAll(node: HtmlElement, test: (el: HtmlElement) => boolean): HtmlElement[] {
  const out: HtmlElement[] = [];
  const walk = (el: HtmlElement) => {
    for (const child of el.children) {
      if (child.type !== 'element') continue;
      if (test(child)) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

/** The first element under `node` for which `test` is true. */
export function findFirst(node: HtmlElement, test: (el: HtmlElement) => boolean): HtmlElement | undefined {
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    if (test(child)) return child;
    const found = findFirst(child, test);
    if (found) return found;
  }
  return undefined;
}

/** The text content of a node, with entities decoded and whitespace as written. */
export function textContent(node: HtmlNode): string {
  if (node.type === 'text') return node.value;
  return node.children.map(textContent).join('');
}

/** Removes, in place, every element under `node` for which `test` is true. */
export function removeAll(node: HtmlElement, test: (el: HtmlElement) => boolean): void {
  node.children = node.children.filter((child) => child.type !== 'element' || !test(child));
  for (const child of node.children) if (child.type === 'element') removeAll(child, test);
}
