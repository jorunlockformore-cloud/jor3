import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'jor-vercel-files');
const assets = path.join(output, 'assets');
const site = 'https://jor3.vercel.app';
await mkdir(assets, { recursive: true });
let html = await readFile(path.join(output, 'index.html'), 'utf8');
const originals = new Map();
const imagePattern = /data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)/g;

// Reuse exact original bytes. The hash changes the cache URL when an image changes.
async function registerImage(uri, name) {
  if (originals.has(uri)) return originals.get(uri);
  const match = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  if (!match) throw new Error(`Unsupported image: ${name}`);
  const bytes = Buffer.from(match[2], 'base64');
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const url = `/assets/${name}-${hash}.${extension}`;
  await writeFile(path.join(output, url.slice(1)), bytes);
  originals.set(uri, url);
  return url;
}

let bottleUrl = /src="(\/assets\/jor-water-bottle-[^"]+)"/.exec(html)?.[1];
for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
  const uri = /src="(data:image\/[^"]+)"/.exec(tag[0])?.[1];
  if (!uri) continue;
  const name = /alt="[^"]*bottle/i.test(tag[0]) ? 'jor-water-bottle'
    : /id="lgRing"/.test(tag[0]) ? 'jor-logo-ring'
    : /id="lgLet"/.test(tag[0]) ? 'jor-logo-lettering'
    : /class="flogo"/.test(tag[0]) ? 'jor-brand-logo'
    : 'jor-wordmark';
  const url = await registerImage(uri, name);
  if (name === 'jor-water-bottle') bottleUrl = url;
}
const posterUri = /<video\b[^>]*poster="(data:image\/[^"]+)"/.exec(html)?.[1];
if (posterUri) await registerImage(posterUri, 'jor-water-hero-poster');
for (const match of html.matchAll(imagePattern)) {
  await registerImage(match[0], 'jor-decoration');
}
for (const [uri, url] of originals) html = html.replaceAll(uri, url);

// Below-the-fold product images can load as needed without changing their layout.
html = html.replace(/<img\b[^>]*>/g, tag => {
  if (!/src="\/assets\/jor-water-bottle-/.test(tag) || /\bloading=/.test(tag)) return tag;
  return tag.replace('<img ', '<img loading="lazy" decoding="async" ');
});

if (bottleUrl) {
  const schemaPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
  const schemaMatch = schemaPattern.exec(html);
  if (!schemaMatch) throw new Error('Homepage structured data missing');
  const schema = JSON.parse(schemaMatch[1]);
  const webpage = schema['@graph'].find(node => node['@type'] === 'WebPage');
  if (!webpage) throw new Error('WebPage structured data missing');
  webpage.primaryImageOfPage = {
    '@type': 'ImageObject',
    url: site + bottleUrl,
    contentUrl: site + bottleUrl,
    caption: 'JÖR Water premium packaged drinking water bottle',
    width: 1252,
    height: 1660
  };
  html = html.replace(schemaPattern, `<script type="application/ld+json">${JSON.stringify(schema)}</script>`);
}
await writeFile(path.join(output, 'index.html'), html);
await copyFile(path.join(root, 'google71ef1b5539713a69.html'), path.join(output, 'google71ef1b5539713a69.html'));

// Preserve the content modification date instead of changing it on every deployment.
let sitemap = await readFile(path.join(output, 'sitemap.xml'), 'utf8');
if (bottleUrl) {
  if (!sitemap.includes('xmlns:image=')) {
    sitemap = sitemap.replace('<urlset ', '<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" ');
  }
  const imageEntry = `<image:image><image:loc>${site}${bottleUrl}</image:loc></image:image>`;
  sitemap = sitemap.replace(/<image:image>[\s\S]*?<\/image:image>/g, '');
  sitemap = sitemap.replace('</url>', `${imageEntry}</url>`);
  await writeFile(path.join(output, 'sitemap.xml'), sitemap);
}
console.log(`Published ${originals.size} deduplicated images; homepage HTML: ${Buffer.byteLength(html)} bytes.`);
