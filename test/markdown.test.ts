import { describe, expect, it } from 'vitest';
import { decodeEntities, extractPage, htmlToMarkdown, parseHtml } from '../src/index.js';

const md = (html: string, options?: Parameters<typeof htmlToMarkdown>[1]) => htmlToMarkdown(html, options);

describe('htmlToMarkdown', () => {
  it('converts headings and paragraphs', () => {
    expect(md('<h1>Title</h1><p>One.</p><h3>Sub</h3><p>Two.</p>')).toBe('# Title\n\nOne.\n\n### Sub\n\nTwo.');
  });

  it('shifts headings with headingOffset, capped at six', () => {
    expect(md('<h1>A</h1><h5>B</h5>', { headingOffset: 2 })).toBe('### A\n\n###### B');
  });

  it('collapses whitespace and keeps line breaks from <br>', () => {
    expect(md('<p>  Some\n   spaced   <br>  text  </p>')).toBe('Some spaced\ntext');
  });

  it('renders emphasis, strike and inline code, keeping spaces outside the markers', () => {
    expect(md('<p>a<strong> bold </strong>b <em>it</em> <del>gone</del> <code>x</code></p>')).toBe('a **bold** b _it_ ~~gone~~ `x`');
  });

  it('fences inline code that contains backticks', () => {
    expect(md('<p><code>a`b</code> and <code>`x`</code></p>')).toBe('``a`b`` and `` `x` ``');
  });

  it('renders links, resolves them against baseUrl and drops unsafe or same-page ones', () => {
    const html = '<p><a href="/docs?a=1">Docs</a> <a href="javascript:alert(1)">bad</a> <a href="#top">top</a> <a href="https://x.test/a b">sp</a> <a href="/icon"></a></p>';
    expect(md(html, { baseUrl: 'https://example.com/guide/' })).toBe(
      '[Docs](https://example.com/docs?a=1) bad top [sp](https://x.test/a%20b)',
    );
    expect(md('<a href="page">rel</a>')).toBe('[rel](page)');
  });

  it('keeps images with alt text only', () => {
    expect(md('<p><img src="/a.png" alt="A chart"><img src="/b.png" alt=""><img src="/c.png"></p>', { baseUrl: 'https://e.com' })).toBe(
      '![A chart](https://e.com/a.png)',
    );
    expect(md('<img src="/a.png" alt="x">', { images: false })).toBe('');
  });

  it('renders unordered, ordered and nested lists', () => {
    const html = '<ul><li>One</li><li>Two<ul><li>Two A</li><li>Two B</li></ul></li></ul><ol start="4"><li><p>Four</p></li><li>Five</li></ol>';
    expect(md(html)).toBe('- One\n- Two\n  - Two A\n  - Two B\n\n4. Four\n5. Five');
  });

  it('closes unclosed <li> and <p> the way browsers do', () => {
    expect(md('<ul><li>a<li>b</ul><p>one<p>two')).toBe('- a\n- b\n\none\n\ntwo');
  });

  it('indents multi-paragraph list items under their marker', () => {
    expect(md('<ol><li><p>First</p><p>More</p></li></ol>')).toBe('1. First\n\n   More');
  });

  it('renders fenced code blocks with the language and entities decoded', () => {
    const html = '<pre><code class="language-ts">const a = 1;\nif (a &lt; 2) {\n  go();\n}\n</code></pre>';
    expect(md(html)).toBe('```ts\nconst a = 1;\nif (a < 2) {\n  go();\n}\n```');
  });

  it('uses a longer fence when the code contains one', () => {
    expect(md('<pre>```\nx\n```</pre>')).toBe('````\n```\nx\n```\n````');
  });

  it('renders blockquotes, including several paragraphs', () => {
    expect(md('<blockquote><p>One</p><p>Two</p></blockquote>')).toBe('> One\n>\n> Two');
  });

  it('renders a basic table with a header row and escaped pipes', () => {
    const html = '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>a|b</td><td><b>1</b></td></tr><tr><td>c</td></tr></tbody></table>';
    expect(md(html)).toBe('| Name | Value |\n| --- | --- |\n| a\\|b | **1** |\n| c |  |');
  });

  it('gives a table without header cells an empty header row', () => {
    expect(md('<table><tr><td>1</td><td>2</td></tr></table>')).toBe('|  |  |\n| --- | --- |\n| 1 | 2 |');
  });

  it('renders a horizontal rule and definition lists', () => {
    expect(md('<p>a</p><hr><dl><dt>Term</dt><dd>Meaning</dd></dl>')).toBe('a\n\n---\n\n**Term**\n\nMeaning');
  });

  it('drops scripts, styles, SVG, form controls and comments', () => {
    const html = '<p>Keep</p><script>var x = "<p>no</p>";</script><style>p{}</style><svg><text>no</text></svg><!-- no --><button>Click</button><input value="no">';
    expect(md(html)).toBe('Keep');
  });

  it('escapes text that would read as Markdown', () => {
    expect(md('<p>1. not a list, *stars*, [brackets], snake_case and _under_</p>')).toBe(
      '1\\. not a list, \\*stars\\*, \\[brackets\\], snake_case and \\_under\\_',
    );
    expect(md('<p># not a heading</p><p>- not an item</p>')).toBe('\\# not a heading\n\n\\- not an item');
  });

  it('decodes named and numeric entities', () => {
    expect(md('<p>A &amp; B &mdash; &#8220;q&#x201D; &copy &unknown; &nbsp;x</p>')).toBe('A & B — “q” © &unknown; x');
  });

  it('keeps the text of unknown and inline elements', () => {
    expect(md('<div><custom-el>Hello <span>there</span></custom-el></div>')).toBe('Hello there');
  });

  it('handles attributes with quotes and > inside values', () => {
    expect(md('<p><a title="a > b" href=\'/x\'>Link</a></p>', { baseUrl: 'https://e.com' })).toBe('[Link](https://e.com/x)');
  });
});

describe('decodeEntities and parseHtml', () => {
  it('replaces invalid code points with U+FFFD', () => {
    expect(decodeEntities('&#0;&#xD800;')).toBe('��');
  });

  it('ignores end tags that match nothing open', () => {
    const root = parseHtml('<div></span>text</div>');
    expect(root.children).toHaveLength(1);
  });
});

describe('extractPage', () => {
  const page = (body: string, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  it('reads title, description, site name, canonical and noindex', () => {
    const p = extractPage(
      page(
        '<main><p>x</p></main>',
        '<title>About | Ex</title><meta name="description" content="Who we are."><meta property="og:site_name" content="Ex"><link rel="canonical" href="/about"><meta name="robots" content="noindex, follow">',
      ),
      { url: 'https://ex.com/about?ref=1' },
    );
    expect(p).toMatchObject({ title: 'About | Ex', description: 'Who we are.', siteName: 'Ex', canonical: 'https://ex.com/about', noindex: true });
  });

  it('falls back to og tags and the first h1', () => {
    const p = extractPage(page('<h1>Heading</h1>', '<meta property="og:description" content="OG desc">'));
    expect(p.title).toBe('Heading');
    expect(p.description).toBe('OG desc');
    expect(p.noindex).toBe(false);
  });

  it('prefers <main>, keeping its header but dropping nav', () => {
    const p = extractPage(page('<header>Site</header><main><header><h1>Post</h1></header><nav>Crumbs</nav><p>Body</p></main><footer>Foot</footer>'));
    expect(p.source).toBe('main');
    expect(p.markdown).toBe('# Post\n\nBody');
  });

  it('uses the only <article> when there is no <main>', () => {
    const p = extractPage(page('<div class="nav">Menu</div><article><h2>A</h2><p>Text</p></article>'));
    expect(p.source).toBe('article');
    expect(p.markdown).toBe('## A\n\nText');
  });

  it('falls back to <body> without header, footer, aside, nav and hidden elements', () => {
    const p = extractPage(
      page('<header>Logo</header><nav>Menu</nav><div><p>Content</p><p hidden>Secret</p><p aria-hidden="true">Deco</p></div><aside>Ad</aside><footer>Foot</footer>'),
    );
    expect(p.source).toBe('body');
    expect(p.markdown).toBe('Content');
  });

  it('reads several articles from the body', () => {
    const p = extractPage(page('<article><p>One</p></article><article><p>Two</p></article>'));
    expect(p.source).toBe('body');
    expect(p.markdown).toBe('One\n\nTwo');
  });

  it('resolves links against <base href>', () => {
    const p = extractPage(page('<main><a href="x">X</a></main>', '<base href="/docs/">'), { url: 'https://e.com/a/b' });
    expect(p.markdown).toBe('[X](https://e.com/docs/x)');
  });
});
