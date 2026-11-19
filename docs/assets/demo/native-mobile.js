/* Mobile-only adapter: native renderers, model validation and in-memory session. */
(() => {
  'use strict';
  const kind=document.currentScript.dataset.kind,doc=document.documentElement;
  const demo=window.__websiteDemo,t=(a,b)=>document.documentElement.lang==='en'?b:a;
  const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let enabled=false,nav,marker,tools,objectBar,paneHead,observer,scheduled=false,readingResources=[],sidebarObserver;
  const desktopText=new Map();
  const r=window.__workbenchRuntime;
  const $=s=>document.querySelector(s);
  function insertButton(parent,text,action){const b=document.createElement('button');b.type='button';b.textContent=text;b.dataset.touchAction=action;parent.append(b);return b;}
  function styleRadar(){
    const frame=$('#literature-radar-frame'),d=frame?.contentDocument;if(!d?.body)return;
    d.documentElement.classList.toggle('bv-touch-native',enabled);d.documentElement.classList.toggle('bv-touch-radar',enabled);
    if(!d.getElementById('bv-touch-style')){const link=d.createElement('link');link.id='bv-touch-style';link.rel='stylesheet';link.href=$('#bv-touch-style').href;d.head.append(link);}
  }
  function pane(name){
    if(name)doc.dataset.touchPane=name;else delete doc.dataset.touchPane;
    if(name){paneHead.querySelector('strong').textContent=t(({materials:'阅读材料',properties:'查看与编辑',detail:'文献详情'})[name],({materials:'Reading materials',properties:'View & edit',detail:'Paper details'})[name]);demo.send('touch-workbench-pane');paneHead.querySelector('button').focus();}
    if(name==='materials'){r.ui.libraryCollapsed=false;r.ui.inspectorCollapsed=true;r.render();void loadMaterials();}
    if(!name&&enabled)requestAnimationFrame(()=>focusCanvas());
  }
  async function loadMaterials(){
    if(!r.ui.libraryEntries.length)await r.loadGlobalLibrary();
    const entry=r.ui.materialPaperEntry||r.ui.libraryEntries[0];if(entry&&!r.ui.materialResources.length)await r.loadMaterialPaper(entry);
    syncResources();
  }
  function readingCards(){
    const records=demo.reading.annotations||[],byId=new Map();for(const a of records){if(!byId.has(a.id))byId.set(a.id,a);}
    const paragraphs=r.ui.materialResources.filter(row=>row.type==='fragment');
    readingResources=[...byId.values()].map(a=>{
      const row=paragraphs.find(p=>p.data?.paragraphId===a.p);if(!row)return null;
      return {...structuredClone(row),id:row.id+':reading:'+a.id,title:a.note?t('高亮与备注','Highlight & note'):t('手动高亮','Highlight'),detail:a.quote||a.text,note:a.note||'',data:{...row.data,savedExcerpt:a.quote||a.text,note:a.note||''}};
    }).filter(Boolean);
    for(const [key,value] of Object.entries(demo.reading.notes||{}))if(value){const paper=r.ui.materialResources.find(row=>row.type==='paper');if(paper)readingResources.push({...structuredClone(paper),id:paper.id+':note:'+key,title:t('论文笔记','Paper note'),detail:value,note:value});}
    for(const turn of demo.reading.chat||[]){const row=r.ui.materialResources.find(p=>p.type==='paper');if(row)readingResources.push({...structuredClone(row),id:row.id+':chat:'+turn.turnId,title:turn.question,detail:turn.answer,note:turn.answer});}
    return readingResources;
  }
  function useButtons(id){return `<div class="bv-touch-use-actions"><button class="bv-touch-use" data-touch-use="${E(id)}" data-destination="hypothesis">${t('加入假说','Add to hypothesis')}</button><button class="bv-touch-use" data-touch-use="${E(id)}" data-destination="figure">${t('加入组图','Add to figure plan')}</button></div>`;}
  function syncResources(){
    if(!enabled||!r)return;
    const host=$('#resource-list');if(!host)return;
    const custom=readingCards();
    if(custom.length&&!host.querySelector('[data-touch-reading]')){const section=document.createElement('section');section.dataset.touchReading='true';section.innerHTML=`<h3 class="bv-touch-saved-heading">${t('刚才保存的阅读记录','Your saved reading')}</h3>`+custom.map(row=>`<article class="resource"><strong>${E(row.title)}</strong><p>${E(row.detail)}</p>${row.note&&row.note!==row.detail?`<p><b>${t('备注','Note')}：</b>${E(row.note)}</p>`:''}${useButtons(row.id)}</article>`).join('');host.prepend(section);}
    for(const card of host.querySelectorAll('[data-resource]')){
      let id=card.dataset.resource;if(id.startsWith('library-paper:'))id=r.ui.materialResources.find(row=>row.type==='paper')?.id;
      if(!id)continue;
      if(!card.querySelector('.bv-touch-use-actions'))card.insertAdjacentHTML('beforeend',useButtons(id));
      for(const small of card.querySelectorAll('small'))if(/拖入|拖到/.test(small.textContent)){if(!desktopText.has(small))desktopText.set(small,small.textContent);small.textContent=t('点击引用，保留原文来源','Tap to reference; the source stays attached');}
      const strong=card.querySelector(':scope>strong');if(strong&&/· 拖入/.test(strong.textContent)){if(!desktopText.has(strong))desktopText.set(strong,strong.textContent);strong.textContent=strong.textContent.replace(' · 拖入','');}
    }
  }
  const objects=()=>{const s=r.sel(),p=r.project();return s.mode==='hypothesis'?p?.hypotheses.find(h=>h.id===s.hypothesisId)?.nodes||[]:p?.plans.find(p=>p.id===s.planId)?.figures.find(f=>f.id===s.figureId)?.panels||[];};
  function focusCanvas(){
    if(!enabled||r.ui.radar||r.ui.library)return;
    const items=objects(),object=items.find(o=>o.id===r.ui.view.selection[0])||items[0],stage=$('#stage');if(!object||!stage?.clientWidth||!stage.clientHeight)return;
    const box=Workbench.rect(object),zoom=Math.min(1,(stage.clientWidth-44)/box.w,(stage.clientHeight-64)/box.h);
    r.ui.view.zoom=Math.max(.2,zoom);r.ui.view.x=(stage.clientWidth-box.w*r.ui.view.zoom)/2-box.x*r.ui.view.zoom;r.ui.view.y=42-box.y*r.ui.view.zoom;r.render();
  }
  function refresh(){
    if(!enabled||!r)return;
    const mode=r.ui.radar?'radar':r.ui.library?'library':r.sel().mode;
    const canvas=['hypothesis','figure'].includes(mode);tools.hidden=mode==='radar';objectBar.hidden=!canvas;
    tools.querySelector('[data-touch-action=materials]').textContent=mode==='library'?t('使用阅读材料','Use reading materials'):t('添加阅读材料','Add reading materials');
    tools.querySelector('[data-touch-action=properties]').hidden=!canvas;
    const select=objectBar.querySelector('select'),list=objects(),value=r.ui.view.selection[0]||'';
    const signature=JSON.stringify(list.map(o=>[o.id,o.label||o.title]));
    if(select.dataset.signature!==signature){select.dataset.signature=signature;select.innerHTML=`<option value="">${t('选择对象查看详情','Choose an object to inspect')}</option>`+list.map(o=>`<option value="${E(o.id)}">${E(o.label||o.title)}</option>`).join('');}
    select.value=value;syncResources();styleRadar();
  }
  function showObject(id){if(!id)return;r.ui.view.selection=[id];r.ui.inspectorCollapsed=false;r.render();pane('properties');}
  async function useResource(id,destination){
    const resource=[...readingResources,...r.ui.materialResources,...r.project().resources].find(row=>row.id===id);if(!resource)throw Error(t('请重新打开阅读材料。','Reopen reading materials.'));
    const project=r.project(),hypothesis=project.hypotheses[0],plan=project.plans[0],figure=plan?.figures[0];
    const targets=destination==='hypothesis'?hypothesis?.nodes:figure?.panels;if(!targets?.length)throw Error(t('请先创建一个目标对象。','Create a target first.'));
    r.modal(t('引用阅读材料','Reference reading material'),`<p><strong>${E(resource.title)}</strong></p>${resource.detail?`<p class="bv-touch-reference-excerpt">${E(resource.detail)}</p>`:''}<label class="field"><span>${destination==='hypothesis'?t('加入哪个假说节点','Hypothesis node'):t('加入哪个 Panel','Figure panel')}</span><select id="bv-touch-target">${targets.map(o=>`<option value="${E(o.id)}">${E(o.label||o.title)}</option>`).join('')}</select></label><label class="field"><span>${t('用途 / 备注','Purpose / note')}</span><textarea id="bv-touch-purpose">${E(resource.note||'')}</textarea></label><p id="bv-touch-reference-error" role="alert"></p><div class="modal-actions"><button data-touch-cancel>${t('取消','Cancel')}</button><button class="primary" data-touch-confirm>${t('确认引用','Add reference')}</button></div>`,dialog=>{
      dialog.querySelector('[data-touch-cancel]').onclick=()=>dialog.close();
      dialog.querySelector('[data-touch-confirm]').onclick=async()=>{
        const confirm=dialog.querySelector('[data-touch-confirm]');if(confirm.disabled)return;confirm.disabled=true;
        const targetId=dialog.querySelector('#bv-touch-target').value,note=dialog.querySelector('#bv-touch-purpose').value;
        try{
          await r.session.edit(t('引用阅读材料','Reference reading material'),p=>{
            const capture=row=>{if(!row||p.resources.some(x=>x.id===row.id))return;p.resources.push(structuredClone(row));for(const parentId of [row.parentResourceId,row.paperId])capture(r.ui.materialResources.find(x=>x.id===parentId));};capture(resource);
            if(destination==='hypothesis'){
              p.materialLinks||=[];if(!p.materialLinks.some(link=>link.targetId===targetId&&link.resourceId===resource.id))p.materialLinks.push(Workbench.materialLink({hypothesisId:hypothesis.id,targetType:'node',targetId,materialType:resource.type==='fragment'||resource.type==='block'?'evidence-block':resource.type,sourceKind:'library',resourceId:resource.id,sourceSnapshot:resource.source,stance:'neutral',note}));
            }else{const target=p.plans.find(x=>x.id===plan.id).figures.find(x=>x.id===figure.id).panels.find(x=>x.id===targetId);target.references||=[];if(!target.references.some(ref=>ref.resourceId===resource.id))target.references.push({resourceId:resource.id,borrow:'实验设计',note,sourceSnapshot:structuredClone(resource.source)});}
          });
          dialog.close();pane(null);r.ui.library=false;r.ui.radar=false;
          await r.navigate(destination==='hypothesis'?{mode:'hypothesis',hypothesisId:hypothesis.id}:{mode:'figure',planId:plan.id,figureId:figure.id});
          r.ui.view.selection=[targetId];r.ui.inspectorCollapsed=false;r.render();pane('properties');refresh();
          r.toast(t('已引用，原文来源和备注一起保留','Reference, source and note kept together'));
          demo.send('touch-reference',{destination,resourceId:resource.id,targetId});
        }catch(error){dialog.querySelector('#bv-touch-reference-error').textContent=error.message;confirm.disabled=false;}
      };
    });
  }
  function initWorkbench(){
    nav=$('.mode-switch');marker=document.createComment('mobile-navigation-return');nav.before(marker);nav.classList.add('bv-touch-wb-nav');
    tools=document.createElement('div');tools.className='bv-touch-wb-tools';insertButton(tools,t('使用阅读材料','Use reading materials'),'materials');insertButton(tools,t('对象详情','Details'),'properties');
    objectBar=document.createElement('div');objectBar.className='bv-touch-object-bar';objectBar.innerHTML='<select aria-label="选择画布对象"></select>';
    $('#workbench').before(tools,objectBar);objectBar.querySelector('select').onchange=e=>showObject(e.target.value);
    paneHead=document.createElement('div');paneHead.className='bv-touch-pane-head';paneHead.append(document.createElement('strong'));insertButton(paneHead,'×','pane-close').setAttribute('aria-label',t('返回工作台','Return to workbench'));document.body.append(paneHead);
    document.addEventListener('pointerdown',e=>{if(enabled&&e.target.closest('.bv-touch-use'))e.stopImmediatePropagation();},true);
    document.addEventListener('click',e=>{
      if(!enabled)return;const use=e.target.closest('[data-touch-use]');if(use){e.preventDefault();e.stopImmediatePropagation();void useResource(use.dataset.touchUse,use.dataset.destination).catch(error=>r.toast(error.message));return;}
      const action=e.target.closest('[data-touch-action]')?.dataset.touchAction;
      if(action==='pane-close')pane(null);
      if(action==='materials'){if(r.ui.library){r.ui.library=false;r.ui.radar=false;void r.navigate({mode:'hypothesis',hypothesisId:r.project().hypotheses[0].id}).then(()=>pane('materials'));}else pane('materials');}
      if(action==='properties'){if(!r.ui.view.selection.length)r.ui.view.selection=[objects()[0]?.id].filter(Boolean);r.ui.inspectorCollapsed=false;r.render();pane('properties');}
      if(e.target.closest('[data-action^=mode-]')){pane(null);requestAnimationFrame(()=>{refresh();requestAnimationFrame(focusCanvas);});}
      if(e.target.closest('[data-library-entry],[data-catalog-entry],[data-catalog-select]'))requestAnimationFrame(()=>{if(r.ui.librarySelected)pane('detail');});
    },true);
    let pointer;
    $('#stage').addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,id:e.target.closest('[data-object]')?.dataset.object};},true);
    $('#stage').addEventListener('pointerup',e=>{if(enabled&&pointer?.id&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)<7){const id=pointer.id;requestAnimationFrame(()=>showObject(id));}pointer=null;},true);
    $('#literature-radar-frame').addEventListener('load',styleRadar);
    observer=new MutationObserver(()=>{if(!enabled||scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;refresh();});});
    for(const target of ['#resource-list','#contextbar','#stage','#library-view-list'])observer.observe($(target),{childList:true,subtree:true});
  }
  function refreshSidebar(){
    if(!enabled||kind!=='sidebar')return;
    for(const card of document.querySelectorAll('.workspace-figure-card[data-figure-id]')){
      const summary=card.querySelector(':scope>summary');if(!summary)continue;
      let b=summary.querySelector('.bv-touch-figure-check');
      if(!b){b=document.createElement('button');b.type='button';b.className='bv-touch-figure-check';b.setAttribute('role','checkbox');b.setAttribute('aria-label',t('选择 ','Select ')+card.dataset.figureId);b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 3 3 5-6"/></svg>';summary.append(b);
        b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();updateFigureSelection(card.dataset.figureId,{ctrlKey:true},demo.figures());refreshSidebar();});
      }
      const selected=figureSelectedIds.has(card.dataset.figureId);if(b.getAttribute('aria-checked')!==String(selected))b.setAttribute('aria-checked',String(selected));
    }
    demo.send('touch-figure-selection',{count:figureSelectedIds.size});
  }
  function enable(value){
    enabled=Boolean(value);doc.classList.toggle('bv-touch-native',enabled);
    if(kind==='sidebar'){
      if(!sidebarObserver){sidebarObserver=new MutationObserver(()=>{if(enabled)requestAnimationFrame(refreshSidebar);});sidebarObserver.observe($('#figureWorkspace'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});}
      refreshSidebar();
      for(const b of document.querySelectorAll('[data-workspace-target]')){
        let label=b.querySelector('.bv-touch-tab-label');if(!label){label=document.createElement('span');label.className='bv-touch-tab-label';b.append(label);}
        const names={navigation:t('大纲','Outline'),highlights:t('高亮','Highlights'),figures:t('解图','Figures'),chat:t('问答','Q&A'),notes:t('笔记','Notes')};label.textContent=names[b.dataset.workspaceTarget];label.hidden=!enabled;
      }
    }else if(r){
      if(!nav)initWorkbench();doc.classList.toggle('bv-touch-workbench',enabled);
      if(enabled){document.body.append(nav);refresh();requestAnimationFrame(()=>requestAnimationFrame(focusCanvas));}
      else{marker.after(nav);tools.hidden=true;objectBar.hidden=true;pane(null);styleRadar();for(const [el,text] of desktopText)if(el.isConnected)el.textContent=text;desktopText.clear();}
    }
  }
  window.BV_TOUCH_FRAME={enable,refresh,closePane:()=>pane(null)};
})();
