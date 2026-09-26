// Public PubMed HTML/CSS evidence only. No credentials, models or user data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const output = path.resolve(process.argv[2]);
if (fs.existsSync(output)) throw Error('Use a new evidence directory');
fs.mkdirSync(output, { recursive: true });
const source = 'https://pubmed.ncbi.nlm.nih.gov/?term=astrocyte+calcium+signaling&size=10';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const response = await fetch(source);
if (!response.ok) throw Error(`PubMed HTTP ${response.status}`);
const html = await response.text();
fs.writeFileSync(path.join(output, 'pubmed-original.html'), html);
const manifest = { url: source, fetchedAt: new Date().toISOString(), status: response.status,
  htmlSha256: digest(html), replay: 'Original HTML with scripts removed and fetched stylesheet text embedded; live network interaction is not simulated.', styles: [] };
let rendered = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '');
for (const tag of html.match(/<link\b[^>]*>/giu) || []) {
  if (!/rel\s*=\s*["']stylesheet["']/iu.test(tag)) continue;
  const href = tag.match(/href\s*=\s*["']([^"']+)/iu)?.[1];
  if (!href) continue;
  const url = new URL(href.replaceAll('&amp;', '&'), source).href;
  if (!['pubmed.ncbi.nlm.nih.gov', 'cdn.ncbi.nlm.nih.gov'].includes(new URL(url).hostname)) throw Error('Unexpected stylesheet origin');
  const cssResponse = await fetch(url); if (!cssResponse.ok) throw Error(`CSS HTTP ${cssResponse.status}`);
  const css = await cssResponse.text();
  const file = `pubmed-${manifest.styles.length + 1}.css`;
  fs.writeFileSync(path.join(output, file), css);
  manifest.styles.push({ url, file, status: cssResponse.status, sha256: digest(css) });
  rendered = rendered.replace(tag, `<style>${css.replace(/<\/style/giu, '<\\/style')}</style>`);
}
fs.writeFileSync(path.join(output, 'pubmed-replay.html'), rendered);
manifest.replaySha256 = digest(rendered);
fs.writeFileSync(path.join(output, 'source.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output, styles: manifest.styles.length, bytes: html.length }));
