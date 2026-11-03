import React from 'react';
import {renderToStaticMarkup, renderToString} from 'react-dom/server';
import {build} from 'esbuild';
import {readFile, writeFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {SITE_ORIGIN, PARKSHARE_ROUTES} from '../src/lib/routes.js';
import {SUPPORT_EMAIL} from '../src/lib/supportContact.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const jsonScript = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

export function structuredData(route, questions = []) {
  if (route.private) return null;
  const organization = {'@type': 'Organization', '@id': SITE_ORIGIN + '/#organization', name: 'ParkShare', legalName: 'ESKA Technologies Inc.', url: SITE_ORIGIN + '/', logo: SITE_ORIGIN + '/website-logo.png', email: SUPPORT_EMAIL};
  const graph = [organization,
    {'@type': 'WebSite', '@id': SITE_ORIGIN + '/#website', name: 'ParkShare', url: SITE_ORIGIN + '/', publisher: {'@id': organization['@id']}},
    {'@type': 'Service', '@id': SITE_ORIGIN + '/#service', name: 'ParkShare private parking marketplace', serviceType: 'Private parking marketplace', url: SITE_ORIGIN + '/parking', areaServed: {'@type': 'Country', name: 'Canada'}, provider: {'@id': organization['@id']}}];
  if (route.path === '/help') graph.push({'@type': 'FAQPage', '@id': SITE_ORIGIN + '/help#faq', mainEntity: questions.map(({q, a}) => ({'@type': 'Question', name: q, acceptedAnswer: {'@type': 'Answer', text: a}}))});
  return {'@context': 'https://schema.org', '@graph': graph};
}

function actionDestination(label) {
  const text = label.replace(/<[^>]*>/g, ' ').replaceAll('&amp;', '&').replace(/[→↑]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (/^(find parking|browse parking|search parking)/.test(text)) return '/parking';
  if (/^(become a host|learn more about hosting|host)$/.test(text)) return '/hosts';
  if (text === 'driver' || text === 'drivers') return '/drivers';
  if (/^(explore )?trust & safety$/.test(text)) return '/trust-and-safety';
  if (/^(help|help & faq|view all help & faq)$/.test(text)) return '/help';
  if (/^(contact us|contact|contact parkshare|contact support)$/.test(text)) return '/contact';
  if (/^(about|about parkshare)$/.test(text)) return '/about';
  if (/^(legal & t\/c|terms of service|terms and conditions)$/.test(text)) return '/terms';
  if (text === 'privacy policy') return '/privacy';
  return null;
}

export function readOnlyMarkup(html) {
  return html.replace(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi, (_, attrs, content) => {
    const label = attrs.match(/aria-label="([^"]*)"/)?.[1] || '';
    const destination = /parkshare.*(?:home|logo)/i.test(label) ? '/' : actionDestination(content);
    if (!destination) return `<button${attrs.replace(/\sdisabled(?:="[^"]*")?/g, '')} disabled="" aria-disabled="true">${content}</button>`;
    return `<a${attrs.replace(/\s(?:type|disabled|aria-expanded|aria-controls)(?:="[^"]*")?/g, '')} href="${destination}" data-public-action="">${content}</a>`;
  }).replace(/<(input|select|textarea)\b([^>]*)>/gi, (_, tag, attrs) => `<${tag}${attrs.replace(/\sdisabled(?:="[^"]*")?/g, '').replace(/\s*\/\s*$/, '')} disabled="">`)
    .replace(/<form\b([^>]*)>/gi, (_, attrs) => '<div' + attrs.replace(/\snovalidate(?:="[^"]*")?/gi, '') + ' data-public-form="">').replace(/<\/form>/gi, '</div>')
    .replaceAll('id="main-content"', 'id="public-document-main"').replaceAll('href="#main-content"', 'href="#public-document-main"');
}

export async function createPublicRenderer() {
  let source = await readFile(join(root, 'src/App.jsx'), 'utf8');
  if (!source.includes('export default function App(')) throw new Error('Public rendering entry could not be identified');
  // Build-only entry: reuse authored pages and the anonymous homepage App tree.
  // Effects do not run here; service/network access remains forbidden.
  source = 'const useLayoutEffect = React.useEffect;\n' + source.replace('export default function App(', 'function App(').replace('useEffect, useLayoutEffect,', 'useEffect,').replaceAll('fetchPriority=', 'fetchpriority=')
    + '\nexport {App,LandingPage,HostPage,DriverPage,AboutPage,TrustPage,HelpPage,ContactPage,LegalPage,BrowseView,DiscoverView,HELP_DATA};';
  const result = await build({stdin: {contents: source, resolveDir: join(root, 'src'), sourcefile: 'App.jsx', loader: 'jsx'}, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, define: {'import.meta.env': '{}'},
    plugins: [{name: 'public-render-no-services', setup(b) {
      b.onResolve({filter: /supabaseClient(?:\.js)?$/}, () => ({path: 'services', namespace: 'public-only'}));
      b.onResolve({filter: /^@react-google-maps\/api$/}, () => ({path: 'maps', namespace: 'public-only'}));
      b.onLoad({filter: /.*/, namespace: 'public-only'}, args => ({contents: args.path === 'services'
        ? 'export const supabase = new Proxy({}, {get(){throw Error("Services are unavailable during public rendering")}});export function updateRecoveryPasswordForAccount(){throw Error("Auth is unavailable during public rendering")}'
        : 'export function useJsApiLoader(){return {isLoaded:false,loadError:null}};export const GoogleMap=()=>null,OverlayView=()=>null,Rectangle=()=>null,Marker=()=>null;'}));
    }}]});
  const cache = join(root, 'node_modules/.cache'); await mkdir(cache, {recursive: true});
  const directory = await mkdtemp(join(cache, 'public-render-'));
  try {
    const file = join(directory, 'pages.mjs'); await writeFile(file, result.outputFiles[0].text);
    const pages = await import(pathToFileURL(file).href);
    const questions = pages.HELP_DATA.flatMap(category => category.groups.flatMap(group => group.items));
    const navigation = '<details data-public-navigation=""><summary>Explore ParkShare</summary><nav aria-label="Public pages">' + PARKSHARE_ROUTES.filter(r => !r.private).map(r => `<a href="${r.path}">${escapeHtml(r.title.replace(/ \|.*$/, ''))}</a>`).join(' ') + '</nav></details>';
    const overview = `<footer data-public-overview=""><p>ParkShare is operated by ESKA Technologies Inc. and connects Drivers with private parking Hosts in Canada. Availability depends on the listings offered by Hosts.</p>${navigation}<noscript><p>Enable JavaScript for live maps, booking, account features and forms. For support, email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p></noscript></footer>`;
    return {
      questions,
      render(route) {
        if (route.private) return {html: '', jsonLd: ''};
        const components = {landing: 'LandingPage', host: 'HostPage', driver: 'DriverPage', about: 'AboutPage', trust: 'TrustPage', help: 'HelpPage', contact: 'ContactPage', legal: 'LegalPage'};
        const Component = route.path === '/' ? pages.App : route.screen === 'app' ? pages[route.tab === 'Browse' ? 'BrowseView' : 'DiscoverView'] : pages[components[route.screen]];
        if (!Component) throw new Error('Missing public page renderer: ' + route.path);
        const props = {user: null, tab: route.tab || 'Browse', section: route.anchor || 'terms', mode: route.tab === 'Restaurants' ? 'restaurants' : route.tab === 'Events & Festivals' ? 'events' : null};
        const oldFetch = globalThis.fetch;
        let html;
        try { globalThis.fetch = () => {throw new Error('Network access is unavailable during public rendering');}; html = (route.path === '/' ? renderToString : renderToStaticMarkup)(React.createElement(Component, props)); }
        finally { globalThis.fetch = oldFetch; }
        if (route.screen === 'app') {
          const guide = questions.slice(0, 4).map(({q,a}) => `<h2>${escapeHtml(q)}</h2><p>${escapeHtml(a)}</p>`).join('');
          html = `<header data-public-header=""><a href="/" aria-label="ParkShare home"><img src="/brand/parkshare-william-parker-logo.webp" alt="ParkShare" width="300"></a></header><main id="main-content">${route.tab === 'Browse' ? '<h1>Find Parking</h1>' : ''}<p>${escapeHtml(route.description)}</p>${html}<section aria-label="Parking guide">${guide}</section><p>Enable JavaScript to search current listings and check live availability. Hosts set their rates; review the final price at checkout.</p></main>`;
        }
        if (route.path === '/help') {
          const answers = '<section data-public-faq=""><h2>Questions and answers</h2>' + questions.map(({q,a}) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join('') + '</section>';
          html = html.replace('</main>', () => answers + '</main>');
        }
        return {html: `<!--parkshare-public-document:start--><div id="public-document">${readOnlyMarkup(html)}${overview}</div><!--parkshare-public-document:end-->`,
          ...(route.path === '/' ? {appHtml: html} : {}),
          jsonLd: `<script id="parkshare-structured-data" type="application/ld+json">${jsonScript(structuredData(route, questions))}</script>`};
      },
      close: () => rm(directory, {recursive: true, force: true}),
    };
  } catch (error) { await rm(directory, {recursive: true, force: true}); throw error; }
}
