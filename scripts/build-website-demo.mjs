// Website preview uses the shipping HTML, CSS and renderer code verbatim.
// Only entry-point HTML receives a demo transport before the production scripts.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { selectionExport, translationExport, figureViewerExport } from './website-selection-export.mjs';
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
    for(const ref of refs)if(!/^(?:[a-z-]+:|#|\/\/)/i.test(ref)) {
      const name=path.normalize(path.join(path.dirname(rel),ref.split(/[?#]/)[0]));
      await include(name);
    }
  }
}
for(const entry of ['popup.html','workbench/index.html','literature-radar/index.html','table-viewer.html','icons/Brevess-logo.svg','vendor/semantic-icons-r42/vendor/lucide/LICENSE','vendor/semantic-icons-r42/vendor/mdi/LICENSE','vendor/semantic-icons-r42/vendor/mdi/LICENSE-Apache-2.0.txt','vendor/phosphor/LICENSE','LICENSE','THIRD_PARTY_NOTICES.md'])await include(entry);
for(const entry of ['action-popup.html','content.css','core/sentence-boundary.js','core/abbreviation-extractor.js','core/highlight-distribution.js','semantic-find-controller.js','core/semantic-find.js','semantic-find.css','bilingual-translation.css','core/figure-magnifier.js','core/figure-viewer.js','core/figure-annotations.js','core/figure-annotation-ui.js','core/web-media.js'])await include(entry);
await fs.mkdir(out,{recursive:true});
for(const [rel,bytes] of files){const dest=path.join(out,rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);}
for(const [entry,adapter] of [['popup.html','native-sidebar.js'],['action-popup.html',null],['workbench/index.html','native-workbench.js'],['literature-radar/index.html','native-radar.js'],['table-viewer.html',null]]) {
  const prefix=entry.includes('/')?'../../':'../';
  let html=files.get(entry).toString();
  html=html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'"><script src="${prefix}native-transport.js"></script><script src="${prefix}paper-data.js"></script><script src="${prefix}native-data.js"></script>`);
  if(entry==='workbench/index.html')html=html.replace('<script src="app.js">',`<script src="${prefix}native-workbench-store.js"></script><script src="app.js">`);
  if(entry==='literature-radar/index.html')html=html.replace(/(<script[^>]*src="(?:app|radar)\.js")/,`<script src="${prefix}native-workbench-store.js"></script>$1`);
  if(entry==='popup.html')html=html.replace('</body>',`<script data-bv-adapter src="core/highlight-distribution.js"></script><script src="../highlight-examples.js"></script><script src="../native-highlights.js"></script><script src="../reading-tools-data.js"></script><script src="../native-sidebar-tools.js"></script></body>`);
  if(adapter)html=html.replace('</body>',`<script src="${prefix}${adapter}"></script></body>`);
  html=html.replace(/(<script[^>]*src="[^"\n]*\/(?:native-(?:transport|data|workbench-store|sidebar|sidebar-tools|workbench|radar|highlights)|paper-data|highlight-examples|reading-tools-data)\.js)(")/g,(_,src,quote)=>src+'?v='+(/\/native-(?:data|sidebar)\.js$/.test(src)?'20261119-touch2':'20261118-native4')+quote);
  html=html.replace(/<script(?![^>]*\bdefer\b)(?=[^>]*\bsrc=)/g,'<script defer data-bv-defer');
  await fs.writeFile(path.join(out,entry),html);
}
const selection=selectionExport(await fs.readFile(path.join(source,'content.js'),'utf8'));
await fs.writeFile(path.join(out,'selection-component.js'),selection.source);
const translation=translationExport(await fs.readFile(path.join(source,'bilingual-translation-content.js'),'utf8'));
await fs.writeFile(path.join(out,'translation-component.js'),translation.source);
const figureViewer=figureViewerExport(await fs.readFile(path.join(source,'content.js'),'utf8'));
await fs.writeFile(path.join(out,'figure-viewer-component.js'),figureViewer.source);
await fs.writeFile(path.join(out,'source-manifest.json'),JSON.stringify({version:JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8')).version_name,entries:[...files].map(([file,bytes])=>({file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length})),selection:{file:'selection-component.js',sha256:crypto.createHash('sha256').update(selection.source).digest('hex'),functions:selection.pieces},translation:{file:'translation-component.js',sha256:crypto.createHash('sha256').update(translation.source).digest('hex'),functions:translation.pieces},figureViewer:{file:'figure-viewer-component.js',sha256:crypto.createHash('sha256').update(figureViewer.source).digest('hex'),functions:figureViewer.pieces},note:'UI source copies are unchanged. HTML only adds isolated versioned adapters and deferred loading. Selection, regex, translation and figure viewer functions are exact production excerpts in environment factories.'},null,2)+'\n');
console.log(`Exported ${files.size} production UI assets (${[...files.values()].reduce((sum,b)=>sum+b.length,0)} bytes).`);
