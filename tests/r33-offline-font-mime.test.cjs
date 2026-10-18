'use strict';
// Pure resource/MIME regression. This small magic-bearing payload is not a
// decoded font; actual exported Nature font bytes are covered in the audit.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {functionSource}=require('./helpers/r28-full07-source.js');
const api=require('../core/faithful-page-snapshot.js');
const background=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
const fixtureSource=fs.readFileSync(path.join(__dirname,'r21-export-faithful-snapshot.test.js'),'utf8');
const fixture=new Function(functionSource(fixtureSource,'fixture')+'\nreturn fixture;')();
const code=['exportAbortError','exportResourceDeadline','waitForBackgroundExportSignal','parseRemoteFigureUrl','fetchExportSnapshotResource'].map(n=>functionSource(background,n)).join('\n');
const bytes=Buffer.alloc(64);bytes.write('wOF2');bytes.writeUInt32BE(bytes.length,8);
const aliases=['application/font-woff2','application/x-font-woff2'];
function route(mime,data=bytes){let read=false;return new Function('fetch','bytesToBase64','fetchExportImageResource',code+'\nreturn fetchExportSnapshotResource;')(
 async()=>({ok:true,url:'https://nature.test/font.woff2',headers:{get:name=>name==='content-type'?mime:String(data.length)},body:{getReader:()=>({
  async read(){if(read)return{done:true};read=true;return{done:false,value:new Uint8Array(data)};},async cancel(){},releaseLock(){}})}}),
 value=>Buffer.from(value).toString('base64'),()=>{throw Error('Image route must not be called');});}
async function snapshot(headerMime,dataMime=headerMime,data=bytes,{inline=false}={}){
 const f=fixture(),dataUrl=`data:${dataMime};base64,${data.toString('base64')}`;
 f.style(`@font-face{font-family:MimeQA;src:url("${inline?dataUrl:'https://nature.test/font.woff2'}")}`);
 let calls=0;const result=await api.exportFaithfulPageSnapshot({...f.options,fetchResource:async()=>{calls++;return{contentType:headerMime+'; charset="UTF-8"',dataUrl};}});
 return{...result,calls};
}
for(const alias of aliases){
 test(alias+' remote route accepts WOFF2 magic and returns canonical MIME without changing bytes',async()=>{
  const result=await route(alias+'; charset="UTF-8"')({kind:'font',url:'https://nature.test/font.woff2'});
  assert.equal(result.contentType,'font/woff2');assert.equal(result.dataUrl,`data:font/woff2;base64,${bytes.toString('base64')}`);
 });
 for(const inline of [false,true])test(alias+(inline?' inline':' callback')+' export normalizes safe WOFF2 to canonical font MIME',async()=>{
  const result=await snapshot(alias,alias,bytes,{inline});assert.equal(result.report.embeddedFonts,1);assert.deepEqual(result.report.missingResources,[]);
  assert.ok(result.html.includes(`data:font/woff2;base64,${bytes.toString('base64')}`));assert.equal(result.calls,inline?0:1);
 });
 for(const [header,data]of [[alias,'font/woff2'],['font/woff2',alias]])test(header+' header and '+data+' URL agree as WOFF2 after magic validation',async()=>{
  const result=await snapshot(header,data);assert.equal(result.report.embeddedFonts,1);assert.deepEqual(result.report.missingResources,[]);
 });
 test(alias+' route rejects non-WOFF2 magic instead of broadening application types',async()=>{
  const bad=Buffer.from(bytes);bad.write('wOFF');await assert.rejects(route(alias,bad)({kind:'font',url:'https://nature.test/font.woff2'}),{code:'EXPORT_RESOURCE_TYPE'});
 });
 for(const inline of [false,true])test(alias+(inline?' inline':' callback')+' refuses false WOFF2 magic',async()=>{
  const bad=Buffer.from(bytes);bad.write('wOFF');const result=await snapshot(alias,alias,bad,{inline});assert.equal(result.report.embeddedFonts,0);assert.equal(result.report.missingResources.length,1);
 });
 test(alias+' header cannot relabel a different font data MIME',async()=>{
  const result=await snapshot(alias,'font/ttf');assert.equal(result.report.embeddedFonts,0);assert.equal(result.report.missingResources.length,1);
 });
}
for(const mime of ['text/html','application/octet-stream','application/font-woff20','application/font-woff2+xml'])test('rejects unapproved font MIME '+mime,async()=>{
 await assert.rejects(route(mime)({kind:'font',url:'https://nature.test/font.woff2'}),{code:'EXPORT_RESOURCE_TYPE'});
 const result=await snapshot(mime);assert.equal(result.report.embeddedFonts,0);assert.equal(result.report.missingResources.length,1);
});
