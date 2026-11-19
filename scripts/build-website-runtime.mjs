// Pack the unchanged native UI scripts in their original execution order.
// Native source copies remain the audit baseline; these are website-only assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(import.meta.dirname,'..'),demo=path.join(repo,'docs/assets/demo');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const relative=(from,to)=>path.relative(from,to).replaceAll('\\','/');
const entries=['native/popup.html','native/workbench/index.html','native/literature-radar/index.html','web-demo.html'];
export async function runtimeFiles(){
 const files=new Map(),manifest={format:1,entries:[]};
 const users=new Map();
 for(const entry of entries){
  const source=path.join(demo,entry),html=await fs.readFile(source,'utf8');
  for(const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)){
   const input=path.resolve(path.dirname(source),match[1].split('?')[0]);
   if(!users.has(input))users.set(input,new Set());users.get(input).add(entry);
  }
 }
 for(const entry of entries){
  const source=path.join(demo,entry),name=entry.replace(/^native\//,''),dest=path.join(demo,'fast',name);
  let html=await fs.readFile(source,'utf8'),chunks=[],group=[],inputs=[];
  async function flush(){
   if(!group.length)return;
   const code=group.map(item=>'\n;/* '+item.file+' */\n'+item.code+'\n').join('');
   // No eval, module wrappers or scope changes; the classic scripts keep globals.
   new vm.Script(code);
   const filename='runtime-'+hash(code).slice(0,16)+'.js';
   const output='bundles/'+filename;files.set(output,code);
   chunks.push('<script defer src="'+relative(path.dirname(source),path.join(demo,'fast',output))+'"></script>');group=[];
  }
  for(const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)){
   const input=path.resolve(path.dirname(source),match[1].split('?')[0]);
   const file=relative(demo,input),code=await fs.readFile(input,'utf8');inputs.push({file,sha256:hash(code)});
   // Keep large shared dependencies cacheable across the host and all demos.
   // The popup bootstrap also identifies its own script URL.
   if(file==='native/popup.js'||(users.get(input).size>1&&Buffer.byteLength(code)>=40000)){
    await flush();chunks.push('<script defer src="'+match[1]+'"></script>');continue;
   }
   if(file==='native/vendor/mermaid/mermaid.min.js'){
    const lazy=await fs.readFile(path.join(demo,'lazy-mermaid.js'),'utf8');
    inputs.push({file:'lazy-mermaid.js',sha256:hash(lazy)});group.push({file:'lazy-mermaid.js',code:lazy});continue;
   }
   group.push({file,code});
  }
  await flush();
  html=html.replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/g,'');
  html=html.replace('<html ','<html data-bv-fast ');
  html=html.replace('<head>','<head><base href="'+relative(path.dirname(dest),source)+'">');
  html=html.replace('</body>',chunks.join('')+'</body>');files.set(name,html);
  manifest.entries.push({source:entry,sha256:hash(await fs.readFile(source)),output:name,scriptRequests:chunks.length,inputs});
 }
 manifest.outputs=[...files].map(([file,content])=>({file,sha256:hash(content)}));
 files.set('manifest.json',JSON.stringify(manifest,null,2)+'\n');return files;
}
export async function verifyRuntime(){
 const expected=await runtimeFiles();
 for(const [file,content] of expected){
  const actual=await fs.readFile(path.join(demo,'fast',file),'utf8');
  if(actual!==content)throw Error('Website runtime is stale: '+file+'; run node scripts/build-website-runtime.mjs');
 }
 return expected.size;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--check'))console.log('Verified '+await verifyRuntime()+' website runtime assets.');
 else{
  const files=await runtimeFiles(),out=path.join(demo,'fast');
  await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
  for(const [file,content] of files){const target=path.join(out,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content);}
  console.log('Built '+files.size+' website runtime assets.');
 }
}
