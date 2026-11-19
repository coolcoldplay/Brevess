/* Touch navigation around the real extension pages. No remote model calls. */
(() => {
  'use strict';
  const api=window.BV_DEMO_API;if(!api)return;
  const {root,wb}=api,mq=matchMedia('(max-width:760px)');
  const en=()=>document.documentElement.lang==='en',t=(a,b)=>en()?b:a;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
  const button=(action,text)=>{const b=el('button','',text);b.type='button';b.dataset.mobile=action;return b;};
  const version='20261119-touch1';
  let active=false,route='reading',focusBefore=null,scrollBefore=0,seen=new Set(),hintTimer,loadEpoch=0,saved=false,selectedFigures=0;
  const header=el('header','bv-mobile-header');
  header.innerHTML='<button type="button" data-mobile="close" aria-label="返回官网"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14 5-7 7 7 7"/></svg></button><strong><img src="assets/site/logo.svg" alt="">BREVESS</strong>';
  header.append(button('route',t('去工作台','Workbench')));document.body.append(header);
  const hint=el('div','bv-mobile-hint');hint.hidden=true;hint.setAttribute('role','status');hint.append(el('span'),button('hint-close',t('知道了','Got it')));document.body.append(hint);
  const source=el('div','bv-touch-source');source.innerHTML='<div><strong>AlphaFold</strong><span>Nature · 2021 · '+t('预置 AI 示例','Prepared AI examples')+'</span></div>';
  source.append(button('paper',t('查看原文','Read paper')));root.prepend(source);
  const actions=el('div','bv-touch-actions');actions.append(button('generate',t('AI 梳理大纲','AI outline')),button('save',t('保存到课题','Save to project')));source.after(actions);
  const sourceHead=el('div','bv-paper-heading');sourceHead.append(el('strong','',t('论文原文','Paper')),
    button('sample',t('试试选句','Select a sentence')),button('paper-tools',t('工具','Tools')),button('paper-close','×'));
  sourceHead.lastChild.setAttribute('aria-label',t('收起原文，返回阅读结果','Close paper and return to results'));api.paper.prepend(sourceHead);
  const wbSource=el('div','bv-touch-source');wbSource.innerHTML='<div><strong>'+t('AlphaFold · 可靠性与验证','AlphaFold · Reliability')+'</strong><span data-mobile-count>'+t('同一篇论文，继续构建课题','Build on the same paper')+'</span></div>';wb.prepend(wbSource);
  function entry(target,workbench){
    const box=el('div','bv-mobile-entry');
    if(!workbench){box.innerHTML='<div class="bv-entry-paper"><img src="assets/demo/figure-5.png" alt="AlphaFold Figure 5" loading="lazy"><div><span>Nature · Open access</span><strong>Highly accurate protein structure prediction with AlphaFold</strong></div></div>';}
    else box.append(el('div','bv-entry-title',t('把读过的证据，带进课题。','Bring evidence into your project.')));
    box.append(button(workbench?'open-workbench':'open-reading',workbench?t('体验课题工作台','Explore the workbench'):t('开始竖屏体验','Start the touch demo')));
    box.append(el('small','',t('桌面插件的交互演示 · AI 为预置示例','Desktop extension demo · Prepared AI examples')));target.before(box);return box;
  }
  entry(root,false);entry(wb,true);
  function updateCopy(){
    const labels={'open-reading':t('开始竖屏体验','Start the touch demo'),'open-workbench':t('体验课题工作台','Explore the workbench'),'paper':t('查看原文','Read paper'),'save':t('保存到课题','Save to project'),'sample':t('试试选句','Select a sentence'),'paper-tools':t('工具','Tools'),'hint-close':t('知道了','Got it')};
    for(const [action,label] of Object.entries(labels))document.querySelectorAll(`[data-mobile="${action}"]`).forEach(b=>b.textContent=label);
    header.querySelector('[data-mobile=route]').textContent=route==='reading'?t('去工作台','Workbench'):t('返回精读','Reading');
    header.querySelector('[data-mobile=close]').setAttribute('aria-label',t('返回官网','Return to website'));
    source.querySelector('span').textContent='Nature · 2021 · '+t('预置 AI 示例','Prepared AI examples');
    sourceHead.querySelector('strong').textContent=t('论文原文','Paper');
    wbSource.querySelector('strong').textContent=t('AlphaFold · 可靠性与验证','AlphaFold · Reliability');
    document.querySelector('.bv-entry-title').textContent=t('把读过的证据，带进课题。','Bring evidence into your project.');
    document.querySelectorAll('.bv-mobile-entry small').forEach(e=>e.textContent=t('桌面插件的交互演示 · AI 为预置示例','Desktop extension demo · Prepared AI examples'));
    updateActions();
  }
  document.addEventListener('brevess-languagechange',()=>{updateCopy();hideHint();for(const frame of [api.sidebar,api.workbench])if(active)frame.contentWindow?.BV_TOUCH_FRAME?.enable(true);});
  function showHint(key,text){if(!active||seen.has(key))return;seen.add(key);hint.querySelector('span').textContent=text;hint.hidden=false;clearTimeout(hintTimer);hintTimer=setTimeout(()=>hint.hidden=true,6500);}
  function hideHint(){hint.hidden=true;clearTimeout(hintTimer);}
  function syncHeight(){if(active)document.documentElement.style.setProperty('--bv-visual-height',(visualViewport?.height||innerHeight)+'px');}
  function enhance(frame,kind){
    const doc=frame.contentDocument;if(!doc||!frame.contentWindow.__websiteDemo?.ready)return;
    let style=doc.getElementById('bv-touch-style');if(!style){style=doc.createElement('link');style.id='bv-touch-style';style.rel='stylesheet';style.href=new URL('assets/demo/native-mobile.css?v='+version,location.href).href;doc.head.append(style);}
    if(frame.contentWindow.BV_TOUCH_FRAME){frame.contentWindow.BV_TOUCH_FRAME.enable(active);return;}
    if(doc.getElementById('bv-touch-script'))return;
    const script=doc.createElement('script');script.id='bv-touch-script';script.src=new URL('assets/demo/native-mobile.js?v='+version,location.href).href;
    script.dataset.kind=kind;script.onload=()=>frame.contentWindow.BV_TOUCH_FRAME?.enable(active);doc.head.append(script);
  }
  async function ready(frame,kind){
    api.loadFrame(frame);const epoch=loadEpoch,start=Date.now();
    while(!frame.contentWindow?.__websiteDemo?.ready){if(epoch!==loadEpoch||!active)return false;if(Date.now()-start>20000)throw Error(t('界面加载较慢，请返回官网后重试。','Loading is taking longer than expected. Return and try again.'));await new Promise(r=>setTimeout(r,100));}
    enhance(frame,kind);return true;
  }
  function updateActions(){
    const labels={navigation:t('AI 梳理大纲','AI outline'),highlights:api.engine==='regex'?t('运行正则高亮','Run regex'):t('AI 语义高亮','AI highlights'),figures:selectedFigures?t(`AI 解读 ${selectedFigures} 张图`,`Analyse ${selectedFigures} figures`):t('AI 解读全部图','AI analyse figures'),chat:t('试问 MSA 的作用','Ask about MSA'),notes:t('AI 填写笔记','AI notes')};
    actions.querySelector('[data-mobile=generate]').textContent=labels[api.module];
    actions.querySelector('[data-mobile=generate]').disabled=root.dataset.nativeReady!=='true';
  }
  function setRoute(next){
    route=next;api.closeOverlays();closeImageNote();api.setView('sidebar');hideHint();
    root.classList.toggle('bv-touch-active',active&&route==='reading');wb.classList.toggle('bv-touch-active',active&&route==='workbench');
    root.setAttribute('role',active?'dialog':'region');wb.setAttribute('role',active?'dialog':'region');
    for(const target of [root,wb]){target.setAttribute('aria-label',target===root?t('论文精读体验','Reading demo'):t('课题工作台体验','Workbench demo'));if(active&&target.classList.contains('bv-touch-active'))target.setAttribute('aria-modal','true');else target.removeAttribute('aria-modal');}
    header.querySelector('[data-mobile=route]').textContent=route==='reading'?t('去工作台','Workbench'):t('返回精读','Reading');
    if(!active)return;
    void ready(route==='reading'?api.sidebar:api.workbench,route==='reading'?'sidebar':'workbench').then(ok=>{
      if(!ok||!active)return;
      if(route==='workbench')api.workbench.contentWindow.BV_TOUCH_FRAME?.refresh();
      updateActions();
      showHint(route,route==='reading'?t('底部单击切换模块。上方 AI 按钮可直接体验生成结果。','Tap a module below, then use its AI button above.'):t('底部按顺序探索。材料按钮里有你刚才保存的阅读记录。','Explore the four modules below. Materials holds your saved reading.'));
    }).catch(error=>api.toast(error.message));
  }
  function open(next='reading'){
    if(!mq.matches)return;
    if(!active){focusBefore=document.activeElement;scrollBefore=scrollY;active=true;document.body.classList.add('bv-mobile-open');document.documentElement.classList.add('bv-mobile-open');syncHeight();history.pushState({...history.state,bvMobileDemo:true},'',location.href);}
    setRoute(next);header.querySelector('[data-mobile=close]').focus({preventScroll:true});
  }
  function closeImageNote(){document.querySelectorAll('[data-brevess-figure-note]').forEach(el=>el.querySelector('[aria-label="关闭"]')?.click());}
  function close(fromHistory=false){
    if(!active)return;active=false;loadEpoch++;api.closeOverlays();closeImageNote();hideHint();
    document.body.classList.remove('bv-mobile-open');document.documentElement.classList.remove('bv-mobile-open');document.body.style.overflow='';document.documentElement.style.removeProperty('--bv-visual-height');
    root.classList.remove('bv-touch-active');wb.classList.remove('bv-touch-active');root.removeAttribute('aria-modal');wb.removeAttribute('aria-modal');
    for(const f of [api.sidebar,api.workbench]){f.contentDocument?.querySelectorAll('dialog[open]').forEach(d=>d.close());f.contentWindow?.BV_TOUCH_FRAME?.enable(false);}
    if(!fromHistory&&history.state?.bvMobileDemo)history.back();
    window.scrollTo({top:scrollBefore,behavior:'instant'});focusBefore?.focus({preventScroll:true});
  }
  async function save(){
    hideHint();const b=actions.querySelector('[data-mobile=save]');b.disabled=true;b.textContent=t('正在保存…','Saving…');b.setAttribute('aria-busy','true');
    try{if(!await ready(api.workbench,'workbench'))return;const reading=api.snapshot();await api.workbench.contentWindow.__websiteDemo.receiveReading(reading);saved=true;
      updateCount(reading);setRoute('workbench');api.send(api.workbench,'module',{module:'library'});
      showHint('saved',t('阅读记录已带到文献总库。点“使用阅读材料”即可加入假说或组图。','Reading saved. Use Materials to attach it to a hypothesis or figure plan.'));
    }catch(error){api.toast(error.message);}finally{b.disabled=false;b.textContent=t('保存到课题','Save to project');b.removeAttribute('aria-busy');}
  }
  function updateCount(reading){const annotations=reading.annotations||[];const count=new Set(annotations.map(a=>a.id)).size;const notes=annotations.filter(a=>a.note).length;wbSource.querySelector('[data-mobile-count]').textContent=t(`${count} 条高亮 · ${notes} 条备注 · ${(reading.figures||[]).length} 张已解读图`,`${count} highlights · ${notes} notes · ${(reading.figures||[]).length} analysed figures`);}
  function paperTools(){
    const row=sourceHead.querySelector('.bv-touch-paper-menu');if(row){row.remove();return;}
    const menu=el('div','bv-touch-paper-menu');Object.assign(menu.style,{position:'absolute',right:'12px',top:'54px',background:'white',boxShadow:'0 8px 30px #0002',padding:'8px',borderRadius:'12px',display:'grid',gap:'4px'});
    menu.append(button('translate',t('翻译正文','Translate paper')),button('search',t('语义搜索','Semantic search')),button('abbreviations',t('缩略词表','Abbreviations')));sourceHead.append(menu);
  }
  document.addEventListener('click',event=>{
    const b=event.target.closest('[data-mobile]');if(!b)return;
    const action=b.dataset.mobile;
    if(!['open-reading','open-workbench'].includes(action)&&!active)return;
    switch(action){
      case 'open-reading':open();break;case 'open-workbench':open('workbench');break;case 'close':close();break;
      case 'route':setRoute(route==='reading'?'workbench':'reading');break;case 'hint-close':hideHint();break;
      case 'paper':hideHint();api.setView(root.dataset.view==='paper'?'sidebar':'paper');break;
      case 'paper-close':api.hideSelection();api.readerTools.closeSearch();api.setView('sidebar');break;
      case 'sample':hideHint();api.sample();break;
      case 'paper-tools':paperTools();break;
      case 'translate':sourceHead.querySelector('.bv-touch-paper-menu')?.remove();api.readerTools.translate();break;
      case 'search':sourceHead.querySelector('.bv-touch-paper-menu')?.remove();api.readerTools.openSearch();break;
      case 'abbreviations':api.setView('sidebar');api.sidebar.contentDocument.querySelector('#showArticleAbbreviations')?.click();break;
      case 'generate':hideHint();api.setView('sidebar');api.generate();break;
      case 'save':void save();break;
      case 'figure-open':void api.imageTools.open(Number(b.dataset.figure));break;
      case 'figure-hr':void api.imageTools.highResolution(Number(b.dataset.figure));break;
      case 'figure-note':api.imageTools.note(Number(b.dataset.figure));break;
    }
  });
  for(const figure of api.paper.querySelectorAll('figure')){
    const id=Number(figure.id.replace('bv-figure-','')),bar=el('div','bv-touch-image-actions');bar.hidden=true;
    for(const [action,label] of [['figure-open',t('放大与标注','Zoom & annotate')],['figure-hr',t('高清原图','High resolution')],['figure-note',t('图片笔记','Image note')]]){const b=button(action,label);b.dataset.figure=id;bar.append(b);}figure.append(bar);
  }
  addEventListener('message',event=>{
    if(event.origin!==location.origin||event.data?.source!=='brevess-native-demo'||!active)return;
    const sidebar=event.source===api.sidebar.contentWindow,workbench=event.source===api.workbench.contentWindow;
    const radar=event.source===api.workbench.contentDocument?.querySelector('#literature-radar-frame')?.contentWindow;
    if(!sidebar&&!workbench&&!radar)return;const m=event.data;
    if(m.type==='ready'){enhance(sidebar?api.sidebar:api.workbench,sidebar?'sidebar':'workbench');updateActions();}
    if(m.type==='module'){api.setView('sidebar');api.imageTools.close();updateActions();hideHint();
      if(m.module==='highlights')showHint('selection',t('点“查看原文 → 试试选句”，体验翻译、分类高亮和备注。','Read paper → Select a sentence to translate, highlight and add notes.'));
    }
    if(m.type==='highlight-engine')updateActions();
    if(m.type==='touch-figure-selection'){selectedFigures=m.count;updateActions();}
    if(m.type==='generated')updateCount(api.snapshot());
    if(m.type==='save'&&sidebar)void save();
    if(m.type==='jump'&&(workbench||radar)){setRoute('reading');api.jump(m.id);}
    if(m.type==='touch-workbench-pane')hideHint();
    if(m.type==='install')close();
  });
  addEventListener('popstate',()=>{if(active&&!history.state?.bvMobileDemo)close(true);});
  addEventListener('keydown',event=>{if(event.key==='Escape'&&active&&!document.getElementById('sci-manual-toolbar')){if(root.dataset.view==='paper')api.setView('sidebar');else close();}});
  visualViewport?.addEventListener('resize',syncHeight);
  mq.addEventListener('change',()=>{if(!mq.matches){close(true);if(history.state?.bvMobileDemo){const state={...history.state};delete state.bvMobileDemo;history.replaceState(state,'',location.href);}api.loadFrame(api.sidebar);api.loadFrame(api.workbench);}for(const n of document.querySelectorAll('.bv-touch-image-actions'))n.hidden=!mq.matches;});
  for(const n of document.querySelectorAll('.bv-touch-image-actions'))n.hidden=!mq.matches;
  window.BV_MOBILE={get active(){return active;},get route(){return route;},get saved(){return saved;},open,close,save,
    viewChanged(view){if(!active)return;source.querySelector('[data-mobile=paper]').setAttribute('aria-expanded',String(view==='paper'));if(view==='paper')hideHint();}};
})();
