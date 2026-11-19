/* Website-only data boundary around the shipping selection, search and sidebar UI. */
(() => {
 const d=window.BV_DEMO_DATA,root=document.getElementById('web-demo');if(!d?.web)return;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isChat=d.web==='chatgpt';let timer,readerTools,lastAnnotations={items:[]};
 window.__bvPageTools={supported:true,preferences:{selection:true,semantic:true,pageTranslation:true},translation:{enabled:false,phase:'idle'}};
 const documentHeader=isChat?'<header class="chat-head">ChatGPT <span>演示对话</span></header>':'<header class="github-head">◉ &nbsp; coolcoldplay / <strong>Brevess</strong><div class="github-menu"><span>Code</span><span>Issues</span><span>Pull requests</span><span>Actions</span></div></header>';
 root.dataset.view='paper';
 root.innerHTML=`<div class="web-toolbar"><nav class="web-tabs" aria-label="切换示例网页"><a href="?web=github" ${!isChat?'aria-current="page"':''}>GitHub</a><a href="?web=chatgpt" ${isChat?'aria-current="page"':''}>ChatGPT</a></nav><span class="web-preview">真实组件 · 预置 AI 示例</span><button class="web-restart" aria-label="重置当前体验" data-action="reset">↻</button></div><div class="web-tools"><button data-action="sample">试试划句</button><button data-action="search">语义检索</button><button data-action="translate">翻译正文</button><span class="web-tip">选中原文，即可翻译、高亮和备注</span></div><div class="web-mobile"><button data-view="paper" aria-pressed="true">网页原文</button><button data-view="sidebar" aria-pressed="false">BREVESS 侧栏</button></div><div class="web-layout"><article class="bv-paper ${d.web}" tabindex="0" aria-label="${isChat?'演示对话':'公开 README 节选'}，可选择文字">${documentHeader}<div class="web-content">${isChat?`<div class="chat-question">${d.prompt}</div>`:'<div class="github-file">☷ &nbsp; README.md</div>'}<h1>${!isChat?'<img src="../site/logo.svg" alt="">':''}${d.title}</h1>${d.paragraphs.map(p=>`<section><h2 id="bv-${p.id}">${p.heading}</h2><p data-paragraph="${p.id}">${esc(p.text)}</p></section>`).join('')}<footer>${isChat?'此对话专为交互演示编写，不含真实账号或聊天记录。':`公开仓库介绍节选 · <a href="${d.source}" target="_blank" rel="noopener">查看完整仓库 ↗</a>`}</footer></div></article><aside class="bv-sidebar"><div class="web-brand"><img src="../site/logo.svg" alt="">BREVESS <span class="web-ready" role="status">正在加载</span></div><div class="web-suggestions" aria-label="示例网页问题">${d.questions.map((q,i)=>`<button data-question="${i}" disabled>${q.q[0]}</button>`).join('')}</div><iframe id="web-sidebar" title="BREVESS 真实网页阅读侧栏" src="native/popup.html?web=${d.web}&v=20261119-web6"></iframe></aside></div><div class="web-guide"><strong>把网页，也变成阅读材料</strong><p>选中一句话，翻译、高亮或备注。侧栏底部单击切换模块，双击运行示例；点击大纲和回答引用回到原文。</p><button data-action="dismiss">开始体验</button></div><div class="web-toast" role="status" hidden></div>`;
 const paper=root.querySelector('.bv-paper'),sidebar=root.querySelector('#web-sidebar');
 const send=(type,data={})=>sidebar.contentWindow.postMessage({source:'brevess-website',type,...data},location.origin);
 function toast(text){clearTimeout(timer);const el=root.querySelector('.web-toast');el.textContent=text;el.hidden=false;timer=setTimeout(()=>el.hidden=true,4000);}
 const dismiss=()=>root.querySelector('.web-guide').hidden=true;
 function view(v){if(v==='sidebar')reading.close();root.dataset.view=v;root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===v)));}
 function jump(id){dismiss();reading.close();view('paper');const el=root.querySelector('#bv-'+id)||root.querySelector('[data-paragraph="'+id+'"]');if(!el)return;paper.scrollTo({top:paper.scrollTop+el.getBoundingClientRect().top-paper.getBoundingClientRect().top-(isChat?65:22),behavior:'instant'});el.classList.remove('web-flash');requestAnimationFrame(()=>el.classList.add('web-flash'));}
 const reading=BVCreateReadingDemo({root,data:d,onToast:toast,onPaint:()=>readerTools?.refresh(),onAbbreviation:entry=>send('abbreviation-add',{entry}),onChange:state=>{lastAnnotations=state;send('annotations',state);}});
 readerTools=BVCreateReaderTools({root,data:d,reading,onToast:toast,onView:view});
 function sample(){dismiss();jump('overview');const p=root.querySelector('[data-paragraph="overview"]');const end=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(d.paragraphs[0].text)][0].segment.trimEnd().length;reading.open([{p:'overview',start:0,end}],p.getBoundingClientRect());}
 function offset(p,node,o){const r=document.createRange();r.selectNodeContents(p);r.setEnd(node,o);return r.toString().length;}
 function selection(){const s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;const r=s.getRangeAt(0);if(!paper.contains(r.startContainer)||!paper.contains(r.endContainer))return;const parts=[];for(const p of paper.querySelectorAll('[data-paragraph]'))if(r.intersectsNode(p)){const start=p.contains(r.startContainer)?offset(p,r.startContainer,r.startOffset):0,end=p.contains(r.endContainer)?offset(p,r.endContainer,r.endOffset):p.textContent.length;if(end>start)parts.push({p:p.dataset.paragraph,start,end});}if(parts.length){dismiss();reading.open(parts,r.getBoundingClientRect());}}
 paper.addEventListener('pointerup',()=>setTimeout(selection,0));paper.addEventListener('keyup',e=>{if(e.shiftKey)selection();});paper.addEventListener('wheel',()=>reading.close(),{passive:true});
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.view){dismiss();view(b.dataset.view);}if(b.dataset.question){dismiss();view('sidebar');send('ask',{question:d.questions[Number(b.dataset.question)].q[0]});}switch(b.dataset.action){case'dismiss':dismiss();break;case'sample':sample();break;case'search':dismiss();readerTools.openSearch();break;case'translate':dismiss();readerTools.translate();break;case'reset':location.reload();break;}});
 addEventListener('keydown',e=>{if(e.key==='Escape'){reading.close();dismiss();}readerTools.keydown(e);});
 addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==sidebar.contentWindow||e.data?.source!=='brevess-native-demo')return;
  const m=e.data;
  if(m.type==='ready'){root.dataset.ready='true';root.querySelector('.web-ready').textContent='已激活';root.querySelectorAll('[data-question]').forEach(b=>b.disabled=false);reading.sync();}
  if(m.type==='jump')jump(m.id);
  if(m.type==='toast')toast(m.message);
  if(m.type==='highlight-config')reading.configure(m.config);
  if(m.type==='highlight-clear')reading.clear(m.target);
  if(m.type==='highlight-visibility')reading.setVisibility(m.sources);
  if(m.type==='highlight-run'){dismiss();reading.configure(m.config);const count=m.engine==='regex'?reading.runRegex():reading.runLlm();send('highlight-complete',{engine:m.engine,count});const hit=lastAnnotations.items.find(a=>a.source===m.engine);if(hit)jump(hit.p);toast((m.engine==='regex'?'正则匹配':'预置语义高亮')+' · '+count+' 处');}
  if(m.type==='annotation'){const a=reading.find(m.id);if(a){jump(a.segments[0].p);const mark=root.querySelector('[data-demo-annotation="'+a.id+'"]');if(mark)reading.openAnnotation(a.id,mark);}}
  if(m.type==='generated')toast('示例已生成，可继续阅读、展开和编辑');
  if(m.type==='module'&&root.dataset.ready==='true')dismiss();
  if(m.type==='save')toast('此体验中的备注与生成内容保留在当前页面；安装插件后可保存到本地文件夹。');
  if(m.type==='install')parent.postMessage({source:'brevess-web-demo',type:'install'},location.origin);
 });
 window.BV_WEB_API={reading,readerTools,jump,sample,send,sidebar,snapshot:()=>lastAnnotations};
})();
