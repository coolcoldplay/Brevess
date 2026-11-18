// Website preview uses the shipping HTML, CSS and renderer code verbatim.
// Only entry-point HTML receives a demo transport before the production scripts.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const repo = path.resolve(import.meta.dirname, '..');
const arg = process.argv.indexOf('--source');
const source = arg >= 0 ? path.resolve(process.argv[arg + 1]) : path.join(repo,'extension');
const out = path.join(repo,'docs/assets/demo/native');
const files = new Map();
async function include(rel) {
  rel=path.normalize(rel); if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Invalid UI asset path');
  if(files.has(rel))return;
  const input=path.join(source,rel),bytes=await fs.readFile(input);files.set(rel,bytes);
  if(/\.(?:html|css)$/.test(rel)) {
    const text=bytes.toString();const refs=rel.endsWith('.html') ? [...text.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]).filter(x=>/\.(?:css|js|png|svg|woff2?)(?:[?#]|$)/.test(x)) : [...text.matchAll(/url\(["']?([^\s)'";]+)["']?\)/g)].map(m=>m[1]);
    for(const ref of refs)if(!/^(?:https?:|data:|blob:|#|\/\/)/.test(ref)) {
      const name=path.normalize(path.join(path.dirname(rel),ref.split(/[?#]/)[0]));
      await include(name);
    }
  }
}
for(const entry of ['popup.html','workbench/index.html','literature-radar/index.html','table-viewer.html','icons/Brevess-logo.svg','vendor/semantic-icons-r42/vendor/lucide/LICENSE','vendor/semantic-icons-r42/vendor/mdi/LICENSE','vendor/semantic-icons-r42/vendor/mdi/LICENSE-Apache-2.0.txt','vendor/phosphor/LICENSE','LICENSE','THIRD_PARTY_NOTICES.md'])await include(entry);
await fs.mkdir(out,{recursive:true});
for(const [rel,bytes] of files){const dest=path.join(out,rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);}
for(const [entry,adapter] of [['popup.html','native-sidebar.js'],['workbench/index.html','native-workbench.js'],['literature-radar/index.html','native-radar.js'],['table-viewer.html',null]]) {
  const prefix=entry.includes('/')?'../../':'../';
  let html=files.get(entry).toString();
  html=html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'"><script src="${prefix}native-transport.js"></script><script src="${prefix}paper-data.js"></script><script src="${prefix}native-data.js"></script>`);
  if(entry==='workbench/index.html')html=html.replace('<script src="app.js">',`<script src="${prefix}native-workbench-store.js"></script><script src="app.js">`);
  if(entry==='literature-radar/index.html')html=html.replace(/(<script[^>]*src="(?:app|radar)\.js")/,`<script src="${prefix}native-workbench-store.js"></script>$1`);
  if(adapter)html=html.replace('</body>',`<script src="${prefix}${adapter}"></script></body>`);
  await fs.writeFile(path.join(out,entry),html);
}
await fs.writeFile(path.join(out,'source-manifest.json'),JSON.stringify({version:JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8')).version_name,entries:[...files].map(([file,bytes])=>({file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length})),note:'UI source copies are unchanged. The HTML entry points only add an isolated website demo transport and data adapter.'},null,2)+'\n');
console.log(`Exported ${files.size} production UI assets (${[...files.values()].reduce((sum,b)=>sum+b.length,0)} bytes).`);
