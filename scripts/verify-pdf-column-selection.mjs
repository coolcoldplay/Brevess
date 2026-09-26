import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {chromium} from 'playwright';
const arg = (key,fallback='') => process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const root = path.resolve(arg('--extension',path.join(import.meta.dirname,'..')));
const pdf = path.resolve(arg('--pdf'));
const out = path.resolve(arg('--output'));
fs.mkdirSync(out,{recursive:true});
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'brevess-column-selection-'));
const extension = path.join(temp,'extension'); fs.mkdirSync(extension);
for(const dir of ['core','providers','vendor','icons','_locales']) fs.cpSync(path.join(root,dir),path.join(extension,dir),{recursive:true});
for(const file of fs.readdirSync(root)) if(/\.(js|mjs|html|css)$/.test(file)||file==='manifest.json')fs.copyFileSync(path.join(root,file),path.join(extension,file));
const report={status:'RUNNING',pdfSha256:crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex'),errors:[],requests:[],selections:[]};
let context;
try {
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'msedge',headless:true,viewport:{width:1886,height:1412},deviceScaleFactor:1,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route(/^https?:\/\//,route=>{report.requests.push(new URL(route.request().url()).origin);return route.abort();});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const reader=await context.newPage();
 reader.on('pageerror',error=>report.errors.push(error.message));
 reader.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 await reader.goto(`chrome-extension://${new URL(worker.url()).host}/pdf-reader.html`);
 await reader.locator('#pdfLocalFile').setInputFiles(pdf);
 await reader.waitForFunction(()=>globalThis.__brevessNativePdfDocument?.phase==='text-ready',null,{timeout:180000});
 await reader.evaluate(()=>__brevessPdfReaderBridge.command('setScale',1.97));
 await reader.evaluate(()=>__brevessPdfReaderBridge.command('focusPage',2));
 await reader.waitForFunction(()=>document.querySelector('.pdf-native-page[data-pdf-page-number="2"].is-rendered .pdf-native-text-layer span'),null,{timeout:90000});
 const start='Stress is a major disease risk';
 await reader.evaluate(start=>{
   const span=[...document.querySelectorAll('.pdf-native-page[data-pdf-page-number="2"] .pdf-native-text-layer span')].find(s=>s.textContent.startsWith(start));
   const viewer=document.querySelector('#pdfNativeViewer');
   viewer.scrollTop+=span.getBoundingClientRect().top-viewer.getBoundingClientRect().top-350;
 },start);
 await reader.waitForTimeout(800);
 await reader.evaluate(()=>prepareManualDocument());
 const points=await reader.evaluate(start=>{
   const page=document.querySelector('.pdf-native-page[data-pdf-page-number="2"]');
   const spans=[...page.querySelectorAll('.pdf-native-text-layer span')];
   const from=spans.find(s=>s.textContent.startsWith(start));
   const to=spans.find(s=>s.textContent.startsWith('often arises or relapses after'));
   const point=(span,end)=>{const node=span.firstChild;const r=document.createRange();r.setStart(node,end?node.length-1:0);r.setEnd(node,end?node.length:1);const b=r.getBoundingClientRect();return {x:end?b.right-0.2:b.left+2,y:(b.top+b.bottom)/2};};
   return {from:point(from,false),to:point(to,true),scale:getComputedStyle(page).getPropertyValue('--scale-factor'),totalScale:getComputedStyle(page).getPropertyValue('--total-scale-factor'),spans:spans.filter(s=>s.textContent.trim()).map(s=>({text:s.textContent,rect:s.getBoundingClientRect().toJSON(),style:s.getAttribute('style'),font:getComputedStyle(s).fontFamily,fontSize:getComputedStyle(s).fontSize,fontHeight:getComputedStyle(s).getPropertyValue('--font-height'),transform:getComputedStyle(s).transform})),page:page.getBoundingClientRect().toJSON()};
 },start);
 report.geometry=points;
 report.startTarget=await reader.evaluate(p=>{const e=document.elementFromPoint(p.x,p.y);return {tag:e?.tagName,text:e?.textContent?.slice(0,100),furniture:e?.dataset.pdfPageFurniture}},points.from);
 await reader.mouse.move(points.from.x,points.from.y);await reader.mouse.down();
 await reader.mouse.move(points.from.x+100,points.from.y,{steps:10});
 report.duringStart=await reader.evaluate(()=>document.getSelection().toString());
 await reader.mouse.move(points.to.x,points.to.y,{steps:30});
 report.duringEnd=await reader.evaluate(()=>document.getSelection().toString());
 await reader.mouse.up();
 await reader.waitForTimeout(350);
 report.selections.push(await reader.evaluate(()=>{
  const sel=document.getSelection(),range=sel.rangeCount?sel.getRangeAt(0):null;
  const endpoint=(node,offset)=>({text:node.textContent,offset});
  return {text:sel.toString(),start:range?endpoint(range.startContainer,range.startOffset):null,end:range?endpoint(range.endContainer,range.endOffset):null,rects:range?[...range.getClientRects()].map(r=>r.toJSON()):[]};
 }));
 report.paint=await reader.evaluate(()=>({
   lineCount:document.querySelectorAll('.pdf-native-selection-hit').length,
   activePages:[...document.querySelectorAll('.has-native-selection-paint')].map(page=>Number(page.dataset.pdfPageNumber))
 }));
 await reader.screenshot({path:path.join(out,'left-column-selected.png')});
 const text=report.selections[0].text;
 report.continuousVisualLines=report.paint.lineCount===text.split('\n').filter(line=>line.trim()).length;
 report.noRightColumn=!text.includes('pandemic')&&!text.includes('regenerative epithelial');
 report.noFooter=!text.includes('Published by Elsevier')&&!text.includes('creativecommons');
 report.hasEnd=text.includes('often arises or relapses after');
 const baseline=arg('--selection-baseline');
 report.selectionUnchanged=!baseline||report.selections[0].text===JSON.parse(fs.readFileSync(baseline,'utf8')).selections[0].text;
 report.status=report.noRightColumn&&report.noFooter&&report.hasEnd&&report.selectionUnchanged&&report.continuousVisualLines&&report.errors.length===0?'PASS':'FAIL';
 await reader.mouse.click(points.from.x,points.from.y);
 await reader.waitForTimeout(80);
 report.clearPaint=await reader.locator('.pdf-native-selection-layer').count()===0;
 if(!report.clearPaint)report.status='FAIL';
}catch(error){report.status='FAIL';report.error=error.stack;}finally{
 await context?.close(); fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 if(path.dirname(path.resolve(temp))===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('brevess-column-selection-'))fs.rmSync(temp,{recursive:true,force:true});
 console.log(JSON.stringify({status:report.status,noRightColumn:report.noRightColumn,noFooter:report.noFooter,hasEnd:report.hasEnd,error:report.error,output:out}));
}
