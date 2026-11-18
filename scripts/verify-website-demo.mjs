// Offline integrity and publication-hygiene checks for the interactive website.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'docs/assets/demo');
const manifest=JSON.parse(await fs.readFile(path.join(dir,'native/source-manifest.json'),'utf8'));
const failures=[];let scripts=0,bytes=0;
const check=(ok,message)=>{if(!ok)failures.push(message);};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const entry of manifest.entries){
 const file=path.join(dir,'native',entry.file),buf=await fs.readFile(file);let content=buf;
 if(entry.file.endsWith('.html')){
   content=buf.toString().replace(/ defer data-bv-defer/g,'').replace(/<script data-bv-adapter[^>]*><\/script>/g,'').replace(/<meta http-equiv="Content-Security-Policy"[^>]*><script src="[^"\n]*native-transport\.js(?:\?[^"\n]*)?"><\/script><script src="[^"\n]*paper-data\.js(?:\?[^"\n]*)?"><\/script><script src="[^"\n]*native-data\.js(?:\?[^"\n]*)?"><\/script>/,'')
     .replace(/<script src="[^"\n]*(?:native-(?:workbench-store|sidebar|sidebar-tools|workbench|radar|highlights)|highlight-examples|reading-tools-data)\.js(?:\?[^"\n]*)?"><\/script>/g,'');
   check(buf.toString().includes("connect-src 'self'"),`${entry.file}: isolated network policy missing`);
 }
 check(hash(content)===entry.sha256,`Production source changed: ${entry.file}`);bytes+=buf.length;
}
const expected=new Set(manifest.entries.map(e=>e.file));expected.add('source-manifest.json');
for(const exported of [manifest.selection,manifest.translation,manifest.figureViewer]){
const component=await fs.readFile(path.join(dir,'native',exported.file),'utf8');
expected.add(exported.file);
check(hash(component)===exported.sha256,`${exported.file}: component hash mismatch`);
for(const fn of exported.functions){
 const start=`/* production:${fn.name}:start */\n`,end=`\n/* production:${fn.name}:end */`;
 const source=component.split(start)[1]?.split(end)[0];
 check(source&&hash(source)===fn.sha256,`Production selection function changed: ${fn.name}`);
}
}
async function visit(current){for(const e of await fs.readdir(current,{withFileTypes:true})){
 const p=path.join(current,e.name),rel=path.relative(dir,p).replaceAll('\\','/');
 check(!/(^|\/)(?:tests?|outputs?|tmp|node_modules|\.git|\.env)(\/|$)/i.test(rel),`Non-production path: ${rel}`);
 if(e.isDirectory()){await visit(p);continue;}
 check(!/\.(?:mp4|webm|gif|map|log|tap|zip)$/i.test(rel),`Unexpected artifact: ${rel}`);
 if(rel.startsWith('native/'))check(expected.has(rel.slice(7)),`Stale native export: ${rel}`);
 const b=await fs.readFile(p);
 if(/\.(?:js|mjs|html|css|json|md|svg|txt)$/.test(e.name)){
   const s=b.toString();
   check(!/(?:\/Users\/user\/|\/var\/folders\/|[A-Z]:\\Users\\)/.test(s),`Personal computer path: ${rel}`);
   check(!/(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/.test(s),`Possible credential: ${rel}`);
   if(/\.(?:html|css)$/.test(e.name)){
     const refs=e.name.endsWith('.html')?[...s.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]).filter(v=>/\.(?:css|js|png|svg|woff2?)(?:[?#]|$)/.test(v)):[...s.matchAll(/url\(["']?([^\s)'";]+)["']?\)/g)].map(m=>m[1]);
     for(const ref of refs){if(/^(?:[a-z-]+:|#|\/\/)/i.test(ref))continue;try{await fs.access(path.resolve(path.dirname(p),ref.split(/[?#]/)[0]));}catch{failures.push(`Missing asset: ${rel} -> ${ref}`);}}
   }
   if(e.name.endsWith('.js')&&!rel.startsWith('native/')){const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});check(r.status===0,`Syntax error: ${rel}\n${r.stderr}`);scripts++;}
 }
 if(e.name.endsWith('.png')){let offset=8;while(offset+12<=b.length){const len=b.readUInt32BE(offset),kind=b.toString('ascii',offset+4,offset+8);check(!['eXIf','tEXt','zTXt','iTXt'].includes(kind),`Image metadata requires review: ${rel} ${kind}`);offset+=len+12;}}
}}
await visit(dir);
for(const file of ['docs/index.html','README.md']){const s=await fs.readFile(path.join(root,file),'utf8');check(!/<video\b|assets\/site\/[^\s"')]+\.(?:mp4|webm|gif)/i.test(s),`Obsolete video reference: ${file}`);}
for(const file of ['docs/media/interactive-website.md','docs/assets/demo/licenses/mermaid-MIT.txt'])await fs.access(path.join(root,file));
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log(JSON.stringify({status:'PASS',version:manifest.version,unchangedProductionFiles:manifest.entries.length,adapterScriptsChecked:scripts,productionBytes:bytes,credentials:'none detected',privatePaths:'none detected',imageMetadata:'clean',obsoleteVideoReferences:0},null,2));
