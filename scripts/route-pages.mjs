import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {PARKSHARE_ROUTES, SITE_ORIGIN, routeDocumentPath} from '../src/lib/routes.js';
import {createPublicRenderer} from './public-content.mjs';
import {HOME_HERO_IMAGE, HOME_HERO_AVIF_SRC_SET} from '../src/lib/homeHeroImage.js';

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
    .replace(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi, '')
    .replace(/<link\b[^>]*\bdata-home-hero-preload(?:="[^"]*")?[^>]*>/gi, '');
  // Preload one supported format only: preloading both would download twice.
  const heroPreload = route.path === '/' ? `\n    <link data-home-hero-preload="" rel="preload" as="image" type="image/avif" href="/home-hero/welcome-768.avif" imagesrcset="${HOME_HERO_AVIF_SRC_SET}" imagesizes="${HOME_HERO_IMAGE.sizes}" fetchpriority="high">\n` : '';
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
  const replacement = match[0].replace(match[1], () => head + heroPreload + metadata);
  return template.slice(0, match.index) + replacement + template.slice(match.index + match[0].length);
}

export function renderSitemap() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + PARKSHARE_ROUTES.filter(route => !route.private).map(route => `  <url><loc>${escapeHtml(SITE_ORIGIN + route.path)}</loc><lastmod>${SITE_METADATA_UPDATED}</lastmod></url>`).join('\n')
    + '\n</urlset>\n';
}

export async function writeRoutePages(outputDirectory) {
  const template = (await readFile(join(outputDirectory, 'index.html'), 'utf8'))
    .replace(/<!--parkshare-public-document:start-->[\s\S]*?<!--parkshare-public-document:end-->/g, '')
    .replace(/<script\b[^>]*id="parkshare-structured-data"[^>]*>[\s\S]*?<\/script>/gi, '');
  const renderer = await createPublicRenderer();
  try {
    for (const route of PARKSHARE_ROUTES) {
      const file = join(outputDirectory, routeDocumentPath(route).slice(1));
      const content = renderer.render(route);
      let html = renderRouteDocument(template, route);
      if (content.html) {
        if (!html.includes('<div id="root"></div>')) throw new Error('Public content requires an empty client root');
        html = html.replace('<div id="root"></div>', () => content.html + '<div id="root"></div>');
      }
      if (content.jsonLd) html = html.replace('</head>', () => content.jsonLd + '\n</head>');
      await mkdir(dirname(file), {recursive: true});
      await writeFile(file, html);
    }
  } finally { await renderer.close(); }
  await writeFile(join(outputDirectory, 'sitemap.xml'), renderSitemap());
}

export function routePagesPlugin() {
  return {name: 'parkshare-route-metadata', apply: 'build', enforce: 'post',
    async writeBundle(output) {
      if (!output.dir) throw new Error('Static route pages require an output directory');
      await writeRoutePages(output.dir);
    }};
}
