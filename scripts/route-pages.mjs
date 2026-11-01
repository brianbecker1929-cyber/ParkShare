import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {PARKSHARE_ROUTES, SITE_ORIGIN, routeDocumentPath} from '../src/lib/routes.js';

// Date of this metadata/canonical revision; rebuilding alone must not freshen it.
export const SITE_METADATA_UPDATED = '2026-11-01';
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function renderRouteDocument(template, route) {
  routeDocumentPath(route); // Reject invalid output paths before creating a document.
  const match = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(template);
  if (!match) throw new Error('Route HTML template has no head');
  const head = match[1]
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*>/gi, tag => /(?:name|property)\s*=\s*["'](?:description|robots|og:title|og:description|og:url|twitter:title|twitter:description)["']/i.test(tag) ? '' : tag)
    .replace(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi, '');
  const title = escapeHtml(route.title), description = escapeHtml(route.description), canonical = escapeHtml(SITE_ORIGIN + route.path);
  const metadata = `\n    <title>${title}</title>
    <meta name="description" content="${description}">
    <meta name="robots" content="${route.private ? 'noindex, nofollow' : 'index, follow'}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonical}">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">\n`;
  const replacement = match[0].replace(match[1], () => head + metadata);
  return template.slice(0, match.index) + replacement + template.slice(match.index + match[0].length);
}

export function renderSitemap() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + PARKSHARE_ROUTES.filter(route => !route.private).map(route => `  <url><loc>${escapeHtml(SITE_ORIGIN + route.path)}</loc><lastmod>${SITE_METADATA_UPDATED}</lastmod></url>`).join('\n')
    + '\n</urlset>\n';
}

export async function writeRoutePages(outputDirectory) {
  const template = await readFile(join(outputDirectory, 'index.html'), 'utf8');
  for (const route of PARKSHARE_ROUTES) {
    const file = join(outputDirectory, routeDocumentPath(route).slice(1));
    await mkdir(dirname(file), {recursive: true});
    await writeFile(file, renderRouteDocument(template, route));
  }
  await writeFile(join(outputDirectory, 'sitemap.xml'), renderSitemap());
}

export function routePagesPlugin() {
  return {name: 'parkshare-route-metadata', apply: 'build', enforce: 'post',
    async writeBundle(output) {
      if (!output.dir) throw new Error('Static route pages require an output directory');
      await writeRoutePages(output.dir);
    }};
}
