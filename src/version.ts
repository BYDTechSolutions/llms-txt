/** The package version. Kept equal to package.json by a test. */
export const VERSION = '0.1.1';

/** The product token this package uses in `User-Agent` headers and, by default, to read robots.txt. */
export const PRODUCT_TOKEN = 'llms-txt';

/** The `User-Agent` header sent with every request, unless a crawl sets its own token. */
export const USER_AGENT = `${PRODUCT_TOKEN}/${VERSION} (+https://github.com/BYDTechSolutions/llms-txt)`;

/** Builds the `User-Agent` header for a product token. */
export function userAgentFor(token: string | undefined): string {
  if (!token || token === PRODUCT_TOKEN) return USER_AGENT;
  return `${token} (compatible; ${PRODUCT_TOKEN}/${VERSION}; +https://github.com/BYDTechSolutions/llms-txt)`;
}
