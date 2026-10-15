// app/llms.txt/route.ts (Next.js App Router)
//
// Serves /llms.txt built from the same content your pages render, so the
// file can never describe pages or promises the site no longer has.
import { build, toResponse } from '@bydtech/llms-txt';

export const dynamic = 'force-static'; // rendered at build time
export const revalidate = 3600; // and refreshed hourly with ISR

// Stand-in for your own content source: a CMS client, MDX files, a database.
async function getDocs(): Promise<{ slug: string; title: string; excerpt: string }[]> {
  return [
    { slug: 'quick-start', title: 'Quick start', excerpt: 'Install, configure and run.' },
    { slug: 'api', title: 'API reference', excerpt: 'Every function and option.' },
  ];
}

export async function GET() {
  const docs = await getDocs();
  const text = build({
    name: 'Example',
    summary: 'Example is a library for building small web apps.',
    site: 'https://example.com',
    sections: [
      {
        title: 'Docs',
        links: docs.map((d) => ({ title: d.title, url: `/docs/${d.slug}`, notes: d.excerpt })),
      },
    ],
    optional: [{ title: 'Changelog', url: '/changelog' }],
  });
  return toResponse(text); // Content-Type: text/plain; charset=utf-8
}
