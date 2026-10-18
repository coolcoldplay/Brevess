#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'benchmarks', 'checkpoint2');
const human = JSON.parse(fs.readFileSync(path.join(dataDir, 'human-review-queue.json'), 'utf8'));
const figures = JSON.parse(fs.readFileSync(path.join(dataDir, 'figure-review-queue.json'), 'utf8'));
if (human.items.some(item => item.split === 'locked_test') ||
    figures.items.some(item => item.split === 'locked_test')) {
  throw new Error('Review tools must not expose locked_test items');
}

const humanPath = path.join(root, 'Checkpoint2_Human_Review_Queue.html');
const figurePath = path.join(root, 'Checkpoint2_Figure_Review_Queue.html');
fs.writeFileSync(humanPath, humanHtml(human), 'utf8');
fs.writeFileSync(figurePath, figureHtml(figures), 'utf8');
for (const name of [
  'Checkpoint2_Corpus_And_Split_Report.md',
  'Checkpoint2_Prompt_Record_Variant_Map.csv',
  'Checkpoint2_Conflict_Analysis.csv'
]) {
  const source = path.join(dataDir, name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(root, name));
}
const testResults = path.join(root, 'Checkpoint2_Test_Results.txt');
if (fs.existsSync(testResults)) {
  fs.copyFileSync(testResults, path.join(dataDir, 'Checkpoint2_Test_Results.txt'));
}
console.log(JSON.stringify({ humanPath, humanItems: human.items.length,
  figurePath, figureItems: figures.items.length, lockedTestItems: 0 }, null, 2));

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function shell(title, subtitle, body, script) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:light;--ink:#18211f;--muted:#63706d;--paper:#f5f1e8;--card:#fffdf8;--line:#d8d1c3;--accent:#0d6b5d;--warn:#9a4f16;--soft:#e7f1ed}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 Inter,Segoe UI,"Microsoft YaHei",sans-serif}
header{position:sticky;top:0;z-index:5;background:rgba(245,241,232,.96);border-bottom:1px solid var(--line);padding:18px max(22px,calc((100vw - 1180px)/2)) 14px;backdrop-filter:blur(10px)}
h1{font:700 24px/1.2 Georgia,"Noto Serif SC",serif;margin:0 0 5px}.subtitle{color:var(--muted)}
.progress{display:flex;align-items:center;gap:12px;margin-top:12px}.bar{height:7px;background:#ddd6ca;border-radius:20px;flex:1;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent);width:0}
main{max-width:1180px;margin:22px auto 70px;padding:0 22px}.toolbar,.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.toolbar{justify-content:space-between;margin-bottom:14px}
button,.button,select,input,textarea{font:inherit}button,.button{border:1px solid #a7b0ac;background:#fff;border-radius:8px;padding:8px 12px;color:var(--ink);cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.warn{color:var(--warn);border-color:#d5a17b}button:disabled{opacity:.45;cursor:not-allowed}
.card{background:var(--card);border:1px solid var(--line);box-shadow:0 8px 30px rgba(44,43,36,.06);border-radius:15px;padding:22px}.meta{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:15px}.tag{background:#eee8dc;border-radius:20px;padding:3px 9px;color:#4e5956;font-size:12px}.tag.good{background:var(--soft);color:#075c4f}.title{font:700 19px/1.35 Georgia,"Noto Serif SC",serif;margin:0 0 14px}
.context{border-left:3px solid #c4bba9;padding:4px 0 4px 15px;margin:9px 0;color:#59625f}.target-text{font-size:18px;line-height:1.75;background:#fff7d8;border:1px solid #eadca5;border-radius:10px;padding:15px;margin:14px 0;white-space:pre-wrap}.panel{border-top:1px solid var(--line);margin-top:20px;padding-top:18px}
label{display:block;font-weight:650;margin:10px 0 5px}select,input[type=text],input[type=number],textarea{width:100%;border:1px solid #bcb7ad;border-radius:8px;background:#fff;padding:9px}textarea{min-height:80px;resize:vertical}.small{font-size:13px;color:var(--muted)}.hidden{display:none!important}.notice{background:#edf4f1;border:1px solid #bdd4cb;border-radius:9px;padding:10px 12px;color:#30524b}.danger{background:#fff1e7;border-color:#e1b38e;color:#813d11}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.three{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.image-wrap{background:#191b1a;border-radius:12px;padding:12px;text-align:center}.image-wrap img{max-width:100%;max-height:70vh;object-fit:contain;background:#fff}.decision button.active{outline:3px solid #a8d0c6;background:var(--soft)}
dialog{border:0;border-radius:12px;max-width:680px;padding:22px;box-shadow:0 30px 90px #0005}code{font-size:12px}@media(max-width:760px){.two,.three{grid-template-columns:1fr}.card{padding:15px}header{position:static}}
</style></head><body><header><h1>${title}</h1><div class="subtitle">${subtitle}</div><div class="progress"><span id="count"></span><div class="bar"><i id="bar"></i></div><span id="saved"></span></div></header>
<main>${body}</main>${script}</body></html>`;
}

function humanHtml(queue) {
  const categories = Object.keys(queue.coverage || {}).sort();
  const items = queue.items.map(item => ({ ...item,
    blindId: `blind-${item.blindOrderKey.slice(0, 12)}`
  }));
  const body = `<div class="toolbar"><div class="row"><button id="prev">← 上一条</button><button id="next" class="primary">下一条 →</button><select id="jump" aria-label="跳转条目"></select></div><div class="row"><button id="export">导出 JSONL</button><button id="reset" class="warn">清除本机进度</button></div></div>
  <div id="locked" class="notice">独立判定流程：先选择你认为最合适的类别并锁定；候选标签在此之前不会显示。此队列不含 locked_test。</div>
  <article class="card" id="card"></article>`;
  const script = `<script>
const ITEMS=${safeJson(items)};const CATEGORIES=${safeJson(categories)};const KEY='brevess-cp2-human-v1';
let index=Number(localStorage.getItem(KEY+'-index')||0);let answers=JSON.parse(localStorage.getItem(KEY)||'{}');
const card=document.querySelector('#card'),jump=document.querySelector('#jump');ITEMS.forEach((x,i)=>jump.add(new Option(String(i+1).padStart(3,'0')+' · '+x.blindId,i)));jump.onchange=()=>{save();index=Number(jump.value);render()};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function current(){return ITEMS[index]}function state(){const x=current();return answers[x.blindId]||(answers[x.blindId]={decision:'',independentCategory:'',candidateAction:'',correctedCategory:'',contextInsufficient:false,quote:'',quoteStart:null,quoteEnd:null,reviewerNote:'',revealedAt:null})}
function options(selected,blank='请选择'){return '<option value="">'+blank+'</option>'+CATEGORIES.map(x=>'<option '+(x===selected?'selected':'')+' value="'+esc(x)+'">'+esc(x)+'</option>').join('')}
function render(){const x=current(),a=state(),revealed=Boolean(a.independentCategory);jump.value=index;card.innerHTML='<div class="meta"><span class="tag good">'+esc(x.split)+'</span><span class="tag">'+esc(x.studyType)+'</span><span class="tag">'+esc(x.sectionKind)+'</span><span class="tag">cluster '+esc(x.clusterId)+'</span><span class="tag">'+esc(x.blindId)+'</span></div><h2 class="title">'+esc(x.title)+'</h2><div class="context">'+x.contextBefore.map(esc).join('<br><br>')+'</div><div id="quoteText" class="target-text">'+esc(x.text)+'</div><div class="context">'+x.contextAfter.map(esc).join('<br><br>')+'</div><div class="panel"><h3>第一步：独立判定</h3><label>最合适的类别</label><select id="independent" '+(revealed?'disabled':'')+'>'+options(a.independentCategory,'选择后才可查看候选标签')+'</select><div class="row" style="margin-top:10px"><button id="lock" class="primary" '+(revealed?'disabled':'')+'>锁定独立判定</button><button id="unlock" '+(!revealed?'disabled':'')+'>重新判定（会再次隐藏）</button></div></div><div id="candidate" class="panel '+(!revealed?'hidden':'')+'"><h3>第二步：候选核对</h3><div class="notice">候选标签：<strong>'+esc(x.targetCategory)+'</strong>　候选来源：'+esc(x.candidateKind)+'（候选不是 Gold）</div><div class="row decision" style="margin-top:12px"><button data-action="accept">接受</button><button data-action="reject">驳回</button><button data-action="change">改类</button></div><label>改为类别</label><select id="corrected">'+options(a.correctedCategory)+'</select></div><div class="panel"><h3>证据范围与备注</h3><label><input id="insufficient" type="checkbox" style="width:auto" '+(a.contextInsufficient?'checked':'')+'> 上下文不足，不能可靠裁决</label><div class="row"><button id="selection">使用当前选中文本作为精确 quote</button><span class="small">也可手工填写字符起止位点</span></div><div class="three"><div><label>quote start</label><input id="qstart" type="number" min="0" max="'+x.text.length+'" value="'+(a.quoteStart??'')+'"></div><div><label>quote end</label><input id="qend" type="number" min="0" max="'+x.text.length+'" value="'+(a.quoteEnd??'')+'"></div><div><label>quote</label><input id="quote" type="text" value="'+esc(a.quote)+'"></div></div><label>审阅备注</label><textarea id="note">'+esc(a.reviewerNote)+'</textarea></div>';
document.querySelectorAll('[data-action]').forEach(b=>{if(b.dataset.action===a.candidateAction)b.classList.add('active');b.onclick=()=>{a.candidateAction=b.dataset.action;if(a.candidateAction==='accept')a.correctedCategory=x.targetCategory;if(a.candidateAction==='reject')a.correctedCategory='';save();render()}});
document.querySelector('#lock').onclick=()=>{const v=document.querySelector('#independent').value;if(!v)return alert('请先完成独立类别判定');a.independentCategory=v;a.revealedAt=new Date().toISOString();save();render()};document.querySelector('#unlock').onclick=()=>{a.independentCategory='';a.candidateAction='';a.correctedCategory='';a.revealedAt=null;save();render()};
document.querySelector('#selection').onclick=()=>{const sel=getSelection();const node=document.querySelector('#quoteText');if(!sel.rangeCount||!node.contains(sel.anchorNode)||!node.contains(sel.focusNode))return alert('请先在黄色原句中选择文本');const range=sel.getRangeAt(0);const pre=document.createRange();pre.selectNodeContents(node);pre.setEnd(range.startContainer,range.startOffset);a.quoteStart=pre.toString().length;a.quoteEnd=a.quoteStart+range.toString().length;a.quote=range.toString();save();render()};update()}
function save(){const a=state();const get=id=>document.querySelector(id);if(get('#independent')&&!a.independentCategory)a.independentCategory='';if(get('#corrected'))a.correctedCategory=get('#corrected').value;if(get('#insufficient'))a.contextInsufficient=get('#insufficient').checked;if(get('#qstart'))a.quoteStart=get('#qstart').value===''?null:Number(get('#qstart').value);if(get('#qend'))a.quoteEnd=get('#qend').value===''?null:Number(get('#qend').value);if(get('#quote'))a.quote=get('#quote').value;if(get('#note'))a.reviewerNote=get('#note').value;localStorage.setItem(KEY,JSON.stringify(answers));localStorage.setItem(KEY+'-index',index);update()}
function update(){const done=ITEMS.filter(x=>answers[x.blindId]?.independentCategory).length;document.querySelector('#count').textContent=(index+1)+' / '+ITEMS.length;document.querySelector('#bar').style.width=(done/ITEMS.length*100)+'%';document.querySelector('#saved').textContent='已判定 '+done}
document.querySelector('#prev').onclick=()=>{save();index=Math.max(0,index-1);render()};document.querySelector('#next').onclick=()=>{save();index=Math.min(ITEMS.length-1,index+1);render()};document.querySelector('#export').onclick=()=>{save();const rows=ITEMS.filter(x=>answers[x.blindId]).map(x=>({queueId:x.queueId,blindId:x.blindId,documentId:x.documentId,clusterId:x.clusterId,split:x.split,studyType:x.studyType,text:x.text,...answers[x.blindId]}));download('checkpoint2-human-adjudication.jsonl',rows.map(JSON.stringify).join('\\n')+'\\n')};document.querySelector('#reset').onclick=()=>{if(confirm('确定清除这台电脑上的全部人工判定进度？')){localStorage.removeItem(KEY);answers={};render()}};function download(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/jsonl'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}render();
</script>`;
  return shell('Checkpoint 2 · 句子人工审阅队列', `${items.length} 个自然候选 · development/validation · locked_test 不可见`, body, script);
}

function figureHtml(queue) {
  const items = queue.items.map(item => ({ ...item,
    imageAsset: `benchmarks/checkpoint2/${item.imageAsset}`
  }));
  const body = `<div class="toolbar"><div class="row"><button id="prev">← 上一图</button><button id="next" class="primary">下一图 →</button><select id="jump" aria-label="跳转 Figure"></select></div><div class="row"><button id="export">导出 JSONL</button><button id="reset" class="warn">清除本机进度</button></div></div><div class="notice">必须同时查看原图与图注。候选 modality 仅用于分层抽样，不是 Gold；locked_test 不在本工具中。</div><article class="card" id="card" style="margin-top:14px"></article>`;
  const script = `<script>
const ITEMS=${safeJson(items)};const KEY='brevess-cp2-figure-v1';let index=Number(localStorage.getItem(KEY+'-index')||0);let answers=JSON.parse(localStorage.getItem(KEY)||'{}');const card=document.querySelector('#card'),jump=document.querySelector('#jump');ITEMS.forEach((x,i)=>jump.add(new Option(String(i+1).padStart(2,'0')+' · '+x.figureLabel,i)));jump.onchange=()=>{save();index=Number(jump.value);render()};const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const lines=v=>Array.isArray(v)?v.join('\\n'):String(v||'');
function current(){return ITEMS[index]}function state(){const x=current();return answers[x.queueId]||(answers[x.queueId]={panelLabels:[],captionPairing:'',groups:[],comparisons:[],methods:[],directObservations:[],evidenceLevel:'',unsupportedConclusions:[],reviewerNote:'',complete:false})}
function render(){const x=current(),a=state();jump.value=index;card.innerHTML='<div class="meta"><span class="tag good">'+esc(x.split)+'</span><span class="tag">'+esc(x.studyType)+'</span><span class="tag">cluster '+esc(x.clusterId)+'</span><span class="tag">'+x.imageWidth+'×'+x.imageHeight+'</span></div><h2 class="title">'+esc(x.figureLabel)+' · '+esc(x.title)+'</h2><div class="two"><div class="image-wrap"><img src="'+encodeURI(x.imageAsset)+'" alt="'+esc(x.figureLabel)+' actual extracted image"></div><div><label>原始图注</label><div class="target-text" style="font-size:15px">'+esc(x.caption||'（无可用图注）')+'</div><div class="small">PDF page: '+esc(x.pdfPage??'unknown')+' · candidate sampling strata: '+esc(x.candidateModalities.join(', '))+'</div><label>Panel 标签（每行一个）</label><textarea id="panels">'+esc(lines(a.panelLabels))+'</textarea><label>图注配对</label><textarea id="pairing">'+esc(a.captionPairing)+'</textarea></div></div><div class="panel two"><div><label>分组（每行一个）</label><textarea id="groups">'+esc(lines(a.groups))+'</textarea><label>比较（每行一个）</label><textarea id="comparisons">'+esc(lines(a.comparisons))+'</textarea><label>方法（每行一个）</label><textarea id="methods">'+esc(lines(a.methods))+'</textarea></div><div><label>直接观察（每行一个，不写推断）</label><textarea id="observations">'+esc(lines(a.directObservations))+'</textarea><label>证据等级</label><select id="level"><option value="">请选择</option>'+['direct_observation','descriptive_association','causal_intervention','supportive_only','not_assessable'].map(v=>'<option '+(a.evidenceLevel===v?'selected':'')+'>'+v+'</option>').join('')+'</select><label>不可支持的结论（每行一个）</label><textarea id="unsupported">'+esc(lines(a.unsupportedConclusions))+'</textarea></div></div><div class="panel"><label>审阅备注</label><textarea id="note">'+esc(a.reviewerNote)+'</textarea><label><input id="complete" type="checkbox" style="width:auto" '+(a.complete?'checked':'')+'> 本图已完成原图+图注联合审阅</label></div>';update()}
function arrayValue(id){return document.querySelector(id).value.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean)}function save(){const a=state(),q=id=>document.querySelector(id);if(q('#panels')){a.panelLabels=arrayValue('#panels');a.captionPairing=q('#pairing').value.trim();a.groups=arrayValue('#groups');a.comparisons=arrayValue('#comparisons');a.methods=arrayValue('#methods');a.directObservations=arrayValue('#observations');a.evidenceLevel=q('#level').value;a.unsupportedConclusions=arrayValue('#unsupported');a.reviewerNote=q('#note').value.trim();a.complete=q('#complete').checked}localStorage.setItem(KEY,JSON.stringify(answers));localStorage.setItem(KEY+'-index',index);update()}
function update(){const done=ITEMS.filter(x=>answers[x.queueId]?.complete).length;document.querySelector('#count').textContent=(index+1)+' / '+ITEMS.length;document.querySelector('#bar').style.width=(done/ITEMS.length*100)+'%';document.querySelector('#saved').textContent='已完成 '+done}
document.querySelector('#prev').onclick=()=>{save();index=Math.max(0,index-1);render()};document.querySelector('#next').onclick=()=>{save();index=Math.min(ITEMS.length-1,index+1);render()};document.querySelector('#export').onclick=()=>{save();const rows=ITEMS.filter(x=>answers[x.queueId]).map(x=>({queueId:x.queueId,documentId:x.documentId,clusterId:x.clusterId,split:x.split,figureLabel:x.figureLabel,imageSha256:x.imageSha256,...answers[x.queueId]}));download('checkpoint2-figure-adjudication.jsonl',rows.map(JSON.stringify).join('\\n')+'\\n')};document.querySelector('#reset').onclick=()=>{if(confirm('确定清除这台电脑上的全部 Figure 判定进度？')){localStorage.removeItem(KEY);answers={};render()}};function download(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/jsonl'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}render();
</script>`;
  return shell('Checkpoint 2 · Figure 人工审阅队列', `${items.length} 张真实提取图 · 原图与图注联合判定`, body, script);
}
