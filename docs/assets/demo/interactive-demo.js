/* Website shell around the unmodified production BREVESS sidebar/workbench. */
(() => {
 'use strict';
 const D=window.BV_DEMO_DATA, root=document.getElementById('reading-demo'), wb=document.getElementById('workbench-demo');if(!D||!root||!wb)return;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const en=()=>document.documentElement.lang==='en',t=(zh,eng)=>en()?eng:zh;
 window.__bvPageTools={supported:true,preferences:{selection:true,semantic:true,pageTranslation:true},shortcut:'J',translation:{enabled:false,phase:'idle'}};
 const svg=p=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
 const ico={help:svg('<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 4m0 4h.01"/>'),expand:svg('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>'),reset:svg('<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>')};
 let module='navigation',reading={figures:[],annotations:[],notes:{},chat:[]},timer,tourStep=-1,guideSeen=false,guideEligible=false;
 const $=(s,inRoot=root)=>inRoot.querySelector(s);
 const paper=()=>$('.bv-paper'),sidebar=()=>$('#native-sidebar'),workbench=()=>$('#native-workbench',wb);
 const send=(frame,type,data={})=>frame?.contentWindow?.postMessage({source:'brevess-website',type,...data},location.origin);
 function article(){return `<div class="np-sticky" data-bv-filter-target="sticky" data-bv-filter-kind="distraction" data-bv-filter-label="浮动标题与 Download PDF 栏"><strong>${D.title}</strong><a class="np-download" href="https://www.nature.com/articles/s41586-021-03819-2.pdf" target="_blank" rel="noopener">Download PDF ↓</a></div><div class="np-ad" data-bv-filter-target="ad" data-bv-filter-kind="distraction" data-bv-filter-label="广告占位区域">Advertisement</div><header class="np-header"><div class="bv-journal">nature</div><nav data-bv-filter-target="navigation" data-bv-filter-kind="distraction" data-bv-filter-label="期刊导航栏"><a href="${D.source}" target="_blank" rel="noopener">Explore content</a><a href="${D.source}" target="_blank" rel="noopener">About the journal</a><span>Publish with us</span></nav></header><div class="np-body"><div class="np-breadcrumb">nature › articles › article</div><div class="np-article-meta">Article <span>Open access</span> Published: 15 July 2021</div><h1>${D.title}</h1><p class="np-authors"><a href="${D.source}#auth-John-Jumper-Aff1" target="_blank" rel="noopener">John Jumper</a>, Richard Evans, Alexander Pritzel et al.</p><p class="np-citation"><em>Nature</em> <b>596</b>, 583–589 (2021)</p><a class="np-download np-download-main" href="https://www.nature.com/articles/s41586-021-03819-2.pdf" target="_blank" rel="noopener">Download PDF ↓</a>`+D.paragraphs.map(p=>`<section><h2 id="bv-${p.id}">${p.heading}</h2>${p.caption?`<small>${t('节选自 Figure 4 图注','Excerpt from the Figure 4 caption')}</small>`:''}<p data-paragraph="${p.id}" data-bv-filter-target="text-${p.id}" data-bv-filter-kind="text" data-bv-filter-label="${esc(p.heading)} 正文">${esc(p.text)}</p>${D.figures.filter(f=>f.section===p.id).map(f=>`<figure id="bv-figure-${f.id}" data-bv-filter-target="figure-${f.id}" data-bv-filter-kind="figure" data-bv-filter-label="Figure ${f.id} 图文区域"><figcaption data-bv-filter-target="caption-${f.id}" data-bv-filter-kind="caption" data-bv-filter-label="Figure ${f.id} 图注">Fig. ${f.id}: ${f.title}</figcaption><button data-action="image" data-id="${f.id}" aria-label="${t('放大查看 Figure','Enlarge Figure')} ${f.id}"><img src="assets/demo/figure-${f.id}.png" width="${f.width}" height="${f.height}" loading="lazy" alt="${esc(f.title)}"></button></figure>`).join('')}</section>`).join('')+`<footer>Jumper et al. · CC BY 4.0 · ${t('开放获取论文节选 · 引用编号略','Open-access excerpts · Citation markers omitted')}<br><a href="${D.source}" target="_blank" rel="noopener">${t('查看完整论文 ↗','Read the full paper ↗')}</a></footer></div>`;}

 function tools(scope){return `${scope==='wb'?'':`<button class="bv-tools-button" data-action="page-tools" aria-label="${t('网页工具：翻译与语义搜索','Page tools: translation and semantic search')}" aria-expanded="false"><img src="assets/site/logo.svg" alt="" width="15" height="18"><span>${t('网页工具','Page tools')}</span></button>`}<button data-action="${scope==='wb'?'wb-help':'help'}" aria-label="${t('操作提示','Show tips')}">${ico.help}</button><button data-action="${scope==='wb'?'wb-expand':'expand'}" aria-label="${t('展开体验','Expand demo')}">${ico.expand}</button>${scope==='wb'?'':`<button data-action="reset" aria-label="${t('重置体验','Reset demo')}">${ico.reset}</button>`}`;}
 root.innerHTML=`<div class="bv-topbar"><span>nature.com</span><span class="bv-preview">${t('真实界面 · AI 为预置示例','Real UI · Prepared AI examples')}</span>${tools('read')}</div><div class="bv-helpbar"><span id="demo-context-tip"></span><button data-action="sample">${t('试试划句','Try selecting text')}</button><button data-action="generate">${t('运行 AI 示例','Run AI example')}</button></div><div class="bv-mobile-switch"><button data-action="paper-view">${t('论文原文','Paper')}</button><button data-action="sidebar-view">BREVESS</button></div><div class="bv-layout"><article class="bv-paper" tabindex="0" aria-label="${t('论文节选，可选择文字','Paper excerpts; select text')}">${article()}</article><aside class="bv-sidebar is-loading"><div class="bv-loading" role="status">${t('正在准备真实侧栏…','Loading the BREVESS sidebar…')}</div><div class="bv-brand"><img src="assets/site/logo.svg" alt="" width="19" height="23">BREVESS</div><iframe id="native-sidebar" data-src="assets/demo/native/popup.html?v=20261119-web6" title="BREVESS ${t('真实侧栏交互体验','real sidebar demo')}" loading="lazy"></iframe></aside></div><div class="bv-tour" hidden></div><div class="bv-toast" role="status" hidden></div>`;
 wb.innerHTML=`<div class="bv-topbar"><span>${t('课题工作台','Research workbench')}</span><span class="bv-preview">${t('真实画布 · 可编辑 · 仅本页保存','Real canvas · Editable · In-memory')}</span>${tools('wb')}</div><div class="bv-loading" role="status">${t('正在准备真实工作台…','Loading the BREVESS workbench…')}</div><div class="bv-workbench-scroll"><iframe id="native-workbench" data-src="assets/demo/native/workbench/index.html?v=20261119-web6" title="BREVESS ${t('真实课题工作台交互体验','real workbench demo')}" loading="lazy"></iframe></div><div class="bv-wb-tip" hidden></div>`;
 root.dataset.view='sidebar';wb.classList.add('is-loading');$('#demo-context-tip').parentElement.querySelector('[data-action=generate]').disabled=true;
 paper().addEventListener('scroll',()=>paper().classList.toggle('is-scrolled',paper().scrollTop>250),{passive:true});
 const toolPopover=document.createElement('div');toolPopover.className='bv-extension-popover';toolPopover.hidden=true;
 toolPopover.innerHTML='<iframe id="native-page-tools" title="BREVESS 网页工具菜单"></iframe>';root.append(toolPopover);
 const toolFrame=()=>$('#native-page-tools');
 function closeTools(){toolPopover.hidden=true;$('[data-action=page-tools]').setAttribute('aria-expanded','false');}
 function openTools(){if(!toolPopover.hidden){closeTools();return;}hideSelection();tour(-1);toolPopover.hidden=false;$('[data-action=page-tools]').setAttribute('aria-expanded','true');toolFrame().src='assets/demo/native/action-popup.html?v=20261119-web6';}
 let highlightEngine='regex';
 let readerTools;
 const nativeReading=BVCreateReadingDemo({root,data:D,onToast:toast,onPaint:()=>readerTools?.refresh(),onAbbreviation:entry=>send(sidebar(),'abbreviation-add',{entry}),onChange:state=>{reading.annotations=state.items;send(sidebar(),'annotations',state);}});
 readerTools=BVCreateReaderTools({root,data:D,reading:nativeReading,onToast:toast,onView:setView});
 const imageTools=BVCreateImageTools({root,data:D,onToast:toast,onNote:note=>send(sidebar(),'image-note',note),onViewerState:state=>send(sidebar(),'image-viewer',{state}),onOpen:()=>{hideSelection();closeTools();readerTools.closeSearch();tour(-1);setView('paper');}});
 paper().addEventListener('wheel',hideSelection,{passive:true});
 function maybeGuide(){if(matchMedia('(max-width:760px)').matches)return;if(guideEligible&&!guideSeen&&root.dataset.nativeReady==='true'){guideSeen=true;tour(0);}}
 function toast(text){clearTimeout(timer);const el=$('.bv-toast');el.textContent=text;el.hidden=false;timer=setTimeout(()=>el.hidden=true,4200);}
 function setView(view){if(view==='sidebar')hideSelection();root.dataset.view=view;window.BV_MOBILE?.viewChanged(view);}
 function jump(id){hideSelection();if(matchMedia('(max-width:760px)').matches)setView('paper');const el=$('#bv-'+id)||$('[data-paragraph="'+id+'"]');if(!el)return;const p=paper(),inset=window.BV_MOBILE?.active?76:matchMedia('(min-width:761px)').matches&&getComputedStyle($('.np-sticky')).display!=='none'?86:24;p.scrollTo({top:el.getBoundingClientRect().top-p.getBoundingClientRect().top+p.scrollTop-inset,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});el.classList.remove('bv-flash');requestAnimationFrame(()=>el.classList.add('bv-flash'));}
 function updateTip(){const run=$('[data-action=generate]');run.textContent=module==='highlights'?(highlightEngine==='regex'?t('运行正则','Run regex'):t('展示 LLM 高亮','Show LLM highlights')):t('运行 AI 示例','Run AI example');const names={navigation:t('大纲','Outline'),highlights:t('高亮','Highlights'),figures:t('解图','Figures'),chat:t('问答','Q&A'),notes:t('笔记','Notes')};$('#demo-context-tip').textContent=module==='highlights'?t('正则匹配短语；LLM 识别句意。切换引擎后双击底部高亮图标。','Regex finds terms; LLM recognizes meaning. Switch engine and double-click Highlights.'):module==='chat'?t('试问：AlphaFold 为什么需要 MSA？','Try: Why does AlphaFold need an MSA?'):`${names[module]} · ${t('单击切换，双击底部图标启动 AI','Click to switch. Double-click below for AI.')}`;}
 function tour(step){tourStep=step;const el=$('.bv-tour');if(step<0||matchMedia('(max-width:760px)').matches){el.hidden=true;return;}
   const rows=[
    [t('从底部五个模块开始','Start with the five modules'),t('单击切换；双击启动处理。高亮可切换正则 / LLM；问答输入问题后发送。','Click to switch; double-click to run. Highlights supports regex or LLM. Type and send in Q&A.')],
    [t('在原文里划一句','Select a sentence'),t('拖动选择文字，会出现高亮、翻译和备注工具。也可点击“试试划句”。','Drag to select text for highlighting, translation and notes. Or use “Try selecting text”.')],
    [t('翻译、搜索与缩略词','Translation, search and terms'),t('上方“网页工具”可翻译正文、语义搜索。侧栏工具栏可翻译大纲或打开缩略词表；悬停图标可查看名称。','Open Page tools above for body translation and semantic search. Use the sidebar toolbar for outline translation and abbreviations; hover icons for labels.')],
    [t('图片旁也有工具','Tools beside each figure'),t('鼠标移到图片上，可切换高清图与放大镜、调整尺寸、写图片笔记。长按画笔打开标注工具；双击尺寸按钮还原。','Hover a figure for high resolution, a magnifier, resizing and image notes. Hold the pen to annotate; double-click resize to restore.')],
    [t('同一份材料，继续使用','Reuse what you read'),t('点击侧栏的保存图标，再到下方工作台。展开右侧论文，拖动 Figure 或 Panel 到画布。','Save with the sidebar icon. In the workbench below, expand the paper and drag a Figure or Panel onto the canvas.')]
   ];const [title,desc]=rows[step];el.innerHTML=`<button data-action="dismiss-tour" aria-label="${t('关闭提示','Close tips')}">×</button><small>${step+1} / ${rows.length}</small><strong>${title}</strong><p>${desc}</p><div><button data-action="dismiss-tour">${t('自己探索','Explore')}</button><button data-action="next-tour">${step===rows.length-1?t('开始体验','Let’s try it'):t('下一步','Next')}</button></div>`;el.hidden=false;el.dataset.step=step;
 }
 function syncAnnotations(){nativeReading.sync();}

 function offset(p,node,o){const r=document.createRange();r.selectNodeContents(p);r.setEnd(node,o);return r.toString().length;}
 function selection(){if(!window.__bvPageTools.preferences.selection)return;const s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;const r=s.getRangeAt(0);if(!paper().contains(r.startContainer)||!paper().contains(r.endContainer))return;const segments=[];for(const p of root.querySelectorAll('[data-paragraph]'))if(r.intersectsNode(p)){const start=p.contains(r.startContainer)?offset(p,r.startContainer,r.startOffset):0,end=p.contains(r.endContainer)?offset(p,r.endContainer,r.endOffset):p.textContent.length;if(end>start)segments.push({p:p.dataset.paragraph,start,end});}if(!segments.length)return;tour(-1);nativeReading.open(segments,r.getBoundingClientRect());}
 function hideSelection(){nativeReading.close();}
 function sample(){tour(-1);setView('paper');hideSelection();const p=$('[data-paragraph="msa"]');paper().scrollTop=p.getBoundingClientRect().top-paper().getBoundingClientRect().top+paper().scrollTop-95;const end=D.paragraphs.find(p=>p.id==='msa').text.indexOf(' We observe');nativeReading.open([{p:'msa',start:0,end}],p.getBoundingClientRect());}
 function image(id){void imageTools.open(id);}
 function expand(el){if(el.classList.contains('bv-expanded')){el.classList.remove('bv-expanded');document.body.style.overflow='';}else{document.querySelectorAll('.bv-expanded').forEach(x=>x.classList.remove('bv-expanded'));el.classList.add('bv-expanded');document.body.style.overflow='hidden';}hideSelection();}
 function helpWorkbench(){if(matchMedia('(max-width:760px)').matches)return;const el=$('.bv-wb-tip',wb);el.innerHTML=`<strong>${t('把阅读材料拖入课题','Bring reading materials into your project')}</strong><p>${t('先在上方切换文献雷达、文献总库、假说梳理和组图规划。进入后两个模块后，在右侧展开论文 → Figure → Panel，拖到画布即可引用。','Explore Radar, Library, Hypotheses and Figure Planning above. In the last two modules, expand the paper → Figure → Panel in Materials and drag it onto the canvas.')}</p><button data-action="wb-dismiss">${t('知道了','Got it')}</button>`;el.hidden=false;}
 root.addEventListener('pointerup',e=>{if(e.target.closest('.bv-paper'))setTimeout(selection,0);});
 root.addEventListener('keyup',e=>{if(e.shiftKey)selection();});
 root.addEventListener('pointerdown',e=>{if(!e.target.closest('[data-demo-annotation]'))hideSelection();if(!e.target.closest('.bv-extension-popover,[data-action=page-tools]'))closeTools();});
 root.addEventListener('click',e=>{
   const b=e.target.closest('[data-action]');if(!b)return;switch(b.dataset.action){
    case 'help':tour(0);break;case 'dismiss-tour':tour(-1);break;case 'next-tour':tour(tourStep<4?tourStep+1:-1);break;
    case 'page-tools':openTools();break;
    case 'sample':sample();break;case 'paper-view':setView('paper');break;case 'sidebar-view':setView('sidebar');break;
    case 'expand':expand(root);break;case 'generate':send(sidebar(),'generate',{module});tour(-1);break;
    case 'reset':window.BV_FILTER_DEMO?.reset();guideSeen=false;guideEligible=true;root.dataset.nativeReady='false';$('.bv-sidebar').classList.add('is-loading');wb.classList.add('is-loading');$('#demo-context-tip').parentElement.querySelector('[data-action=generate]').disabled=true;reading={figures:[],annotations:[],notes:{},chat:[]};readerTools.reset();imageTools.reset();closeTools();window.__bvPageTools.preferences={selection:true,semantic:true,pageTranslation:true};window.__bvPageTools.translation={enabled:false,phase:'idle'};nativeReading.reset();sidebar().src=sidebar().dataset.src;workbench().src=workbench().dataset.src;tour(-1);break;
    case 'image':image(Number(b.dataset.id));break;
   }
 });
 wb.addEventListener('click',e=>{switch(e.target.closest('[data-action]')?.dataset.action){case 'wb-help':helpWorkbench();break;case 'wb-dismiss':$('.bv-wb-tip',wb).hidden=true;break;case 'wb-expand':expand(wb);break;}});
 addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('sci-manual-toolbar')){hideSelection();return;}if(readerTools.keydown(e))return;if(e.key==='Escape'){if(!toolPopover.hidden){closeTools();return;}document.querySelectorAll('.bv-expanded').forEach(x=>x.classList.remove('bv-expanded'));document.body.style.overflow='';tour(-1);}});
 addEventListener('message',e=>{
   if(e.origin!==location.origin||e.data?.source!=='brevess-native-demo')return;
   const tableFrame=document.querySelector('.bv-table-dialog iframe');
   if(e.data.type==='close-table'&&e.source===tableFrame?.contentWindow){tableFrame.closest('dialog').close();return;}
   const isSidebar=e.source===sidebar()?.contentWindow,isWB=e.source===workbench()?.contentWindow,isRadar=e.source===workbench()?.contentWindow?.document.querySelector('iframe')?.contentWindow;
   const isTools=e.source===toolFrame()?.contentWindow;
   if(!isSidebar&&!isWB&&!isRadar&&!isTools)return;
   const m=e.data;
   if(isTools){
    if(m.type==='close-tools')closeTools();
    if(m.type==='body-translation')readerTools.translate(m.enabled);
    if(m.type==='semantic-open'){closeTools();readerTools.openSearch();}
    if(m.type==='show-sidebar')setView('sidebar');
    if(m.type==='page-tools-change'&&!m.enabled){if(m.tool==='semantic')readerTools.closeSearch();if(m.tool==='selection')hideSelection();}
    if(m.type==='workbench'){closeTools();loadFrame(workbench());document.querySelectorAll('.bv-expanded').forEach(x=>x.classList.remove('bv-expanded'));document.body.style.overflow='';wb.scrollIntoView({behavior:'smooth',block:'center'});}
   }
   if(m.type==='table'&&isSidebar){
     const url=new URL(m.url);if(url.origin!==location.origin||!url.pathname.endsWith('/native/table-viewer.html')||!m.key.startsWith('brevess.tableView.'))return;
     window.__bvTableSnapshots={[m.key]:m.value};
     const dialog=document.createElement('dialog');dialog.className='bv-table-dialog';
     const frame=document.createElement('iframe');frame.title=t('完整表格','Complete table');frame.src=url.href;dialog.append(frame);document.body.append(dialog);
     dialog.addEventListener('close',()=>{delete window.__bvTableSnapshots;dialog.remove();});dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.showModal();return;
   }
   if(m.type==='highlight-engine'){highlightEngine=m.engine;updateTip();}
   if(m.type==='module'){module=m.module;updateTip();}
   if(m.type==='jump'){if((isWB||isRadar)&&!window.BV_MOBILE?.active){document.querySelectorAll('.bv-expanded').forEach(x=>x.classList.remove('bv-expanded'));document.body.style.overflow='';}jump(m.id);if((isWB||isRadar)&&!window.BV_MOBILE?.active)root.scrollIntoView({behavior:'smooth',block:'center'});}
   if(m.type==='toast')toast(m.message);
   if(m.type==='highlight-config')nativeReading.configure(m.config);
   if(m.type==='highlight-clear')nativeReading.clear(m.target);
   if(m.type==='highlight-visibility')nativeReading.setVisibility(m.sources);
   if(m.type==='annotation'){const a=nativeReading.find(m.id);if(a){jump(a.segments[0].p);requestAnimationFrame(()=>{const mark=root.querySelector('[data-demo-annotation="'+a.id+'"]');if(mark)nativeReading.openAnnotation(a.id,mark);});}}
   if(m.type==='generated'){reading={...m.reading,annotations:reading.annotations};if(m.module!=='highlights')toast(t('已展示预置 AI 结果，可继续展开与编辑','Prepared AI example is ready to explore and edit.'));}
   if(m.type==='highlight-run'){nativeReading.configure(m.config);const count=m.engine==='regex'?nativeReading.runRegex():nativeReading.runLlm();send(sidebar(),'highlight-complete',{engine:m.engine,count});const first=reading.annotations.find(a=>a.source===m.engine);if(first)jump(first.p);toast(m.engine==='regex'?`正则已匹配 ${count} 处，可切换短语或整句`:`已展示 ${count} 处预置语义高亮；未调用在线模型`);}
   if(m.type==='save'){reading={...m.reading,annotations:reading.annotations};loadFrame(workbench());send(workbench(),'reading',{reading});toast(t('已存入下方文献库；在材料库展开论文即可引用','Saved to the library below. Expand the paper in Materials to reuse it.'));helpWorkbench();}
   if(m.type==='ready'&&isWB){wb.classList.remove('is-loading');send(workbench(),'reading',{reading});if(en())send(workbench(),'language',{language:'en'});}
   if(m.type==='ready'&&isSidebar){$('.bv-sidebar').classList.remove('is-loading');root.dataset.nativeReady='true';$('#demo-context-tip').parentElement.querySelector('[data-action=generate]').disabled=false;maybeGuide();syncAnnotations();if(en())send(sidebar(),'language',{language:'en'});}
   if(m.type==='escape'){if(isTools){closeTools();return;}document.querySelectorAll('.bv-expanded').forEach(x=>x.classList.remove('bv-expanded'));document.body.style.overflow='';hideSelection();tour(-1);}
   if(m.type==='install'){document.querySelectorAll('.bv-expanded').forEach(x=>x.classList.remove('bv-expanded'));document.body.style.overflow='';document.getElementById('install').scrollIntoView({behavior:'smooth'});toast(t('账号、模型与本机文件配置请在安装后的插件中使用','Configure accounts, models and local folders in the installed extension.'));}
 });
 function loadFrame(frame){if(!frame)return;frame.loading='eager';if(!frame.getAttribute('src'))frame.src=frame.dataset.src;}
 window.BV_DEMO_API={root,wb,paper:paper(),sidebar:sidebar(),workbench:workbench(),send,loadFrame,sample,jump,setView,hideSelection,readerTools,imageTools,toast,
   get module(){return module;},get engine(){return highlightEngine;},
   snapshot:()=>structuredClone({...reading,...sidebar()?.contentWindow?.__websiteDemo?.reading,annotations:reading.annotations}),
   generate:()=>send(sidebar(),'generate',{module}),switchModule:value=>send(sidebar(),'module',{module:value}),
   closeOverlays(){hideSelection();closeTools();readerTools.closeSearch();imageTools.close();tour(-1);$('.bv-wb-tip',wb).hidden=true;}
 };
 const lazy=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting&&!matchMedia('(max-width:760px)').matches){loadFrame(entry.target.querySelector('iframe'));lazy.unobserve(entry.target);}},{rootMargin:'600px'});lazy.observe(root);lazy.observe(wb);
 const guide=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){guideEligible=true;maybeGuide();guide.disconnect();}},{threshold:.35});guide.observe(root);
 const wbGuide=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){helpWorkbench();wbGuide.disconnect();}},{threshold:.5});wbGuide.observe(wb);
 addEventListener('resize',hideSelection);document.addEventListener('brevess-languagechange',()=>{updateTip();send(sidebar(),'language',{language:en()?'en':'zh-CN'});send(workbench(),'language',{language:en()?'en':'zh-CN'});if(tourStep>=0)tour(tourStep);});
 updateTip();
})();
