/* In-memory display-rule simulation, using the production filter composer. */
(() => {
  'use strict';
  const api=window.BV_DEMO_API,D=window.BV_DEMO_DATA;if(!api)return;
  const paper=api.paper,frame=api.sidebar,clone=v=>structuredClone(v);
  const initial=()=>({tabId:1,navigationUrl:D.source,url:D.source,documentKey:'alphafold-example',title:D.title,sourceIds:[1],referenceIds:[],targets:[],turns:[],adjusting:false,adjustmentMode:'display',busy:false,plan:null,notice:'',preview:false,saved:false,canUndo:false,saveScopeLabel:'本次体验中的 AlphaFold 页面（刷新后重置）'});
  let state=initial(),savedPlan=null,undo=[],pendingPick=null,selected=[],hovered=null,serial=0,shownPreview=null;
  const originals=new Map();
  const picker=document.createElement('div');picker.className='bv-filter-picker';picker.hidden=true;picker.setAttribute('role','group');picker.setAttribute('aria-label','选择网页滤镜目标');
  const pickHint=document.createElement('span');picker.append(pickHint);
  for(const [label,fn]of [['完成选取',()=>finishPick()],['取消',()=>finishPick(true)]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);picker.append(b);}api.root.append(picker);
  const entry=document.createElement('button');entry.type='button';entry.className='bv-filter-start';const copy=()=>{entry.textContent=document.documentElement.lang==='en'?'Web filter':'网页滤镜';entry.setAttribute('aria-label',document.documentElement.lang==='en'?'Try web filters':'体验网页滤镜');};copy();document.addEventListener('brevess-languagechange',copy);
  api.root.querySelector('.bv-helpbar').append(entry);
  entry.addEventListener('click',async()=>{api.closeOverlays();api.switchModule('chat');api.setView('sidebar');await frame.contentWindow.BrevessUnifiedComposer?.refresh();if(!state.adjusting)frame.contentDocument.querySelector('[data-pick]')?.click();});
  const targetSelector=id=>'[data-bv-filter-target="'+id+'"]';
  function restore(){for(const [node,props]of originals)for(const [key,value]of props){if(value.value)node.style.setProperty(key,value.value,value.priority);else node.style.removeProperty(key);}originals.clear();}
  function apply(){restore();if(!state.preview||!state.plan)return;for(const op of state.plan.operations){for(const node of paper.querySelectorAll(op.target.selector)){
    let props=originals.get(node);if(!props)originals.set(node,props=new Map());
    const styles=op.type==='hide'?{display:'none'}:op.styles;
    for(const [key,value]of Object.entries(styles)){if(!props.has(key))props.set(key,{value:node.style.getPropertyValue(key),priority:node.style.getPropertyPriority(key)});node.style.setProperty(key,value,'important');}
  }}}
  function cleanSelection(){paper.classList.remove('bv-filter-picking');paper.querySelectorAll('.bv-filter-selected,.bv-filter-hover').forEach(n=>n.classList.remove('bv-filter-selected','bv-filter-hover'));hovered=null;picker.hidden=true;}
  function picked(){return selected.map(node=>({id:node.dataset.bvFilterTarget,tabId:1,tag:node.tagName.toLowerCase(),kind:node.dataset.bvFilterKind,sourceTitle:'AlphaFold',displayText:node.dataset.bvFilterLabel,selector:targetSelector(node.dataset.bvFilterTarget),sameKind:false}));}
  function finishPick(cancel=false){if(!pendingPick)return;const resolve=pendingPick;pendingPick=null;if(!cancel)state.targets=picked();cleanSelection();state.notice=cancel?'已取消选取。':state.targets.length?'已选好区域。选择快捷要求，或输入要调整的效果。':'未选择元素，也可以直接描述正文排版要求。';api.setView('sidebar');resolve({ok:true,data:clone(state)});}
  function beginPick(){api.closeOverlays();api.setView('paper');selected=state.targets.map(t=>paper.querySelector(targetSelector(t.id))).filter(Boolean);selected.forEach(n=>n.classList.add('bv-filter-selected'));paper.classList.add('bv-filter-picking');picker.hidden=false;pickHint.textContent='点选网页区域 · 已选 '+selected.length+' 处';return new Promise(resolve=>pendingPick=resolve);}
  paper.addEventListener('pointerover',e=>{if(!pendingPick)return;const n=e.target.closest('[data-bv-filter-target]');hovered?.classList.remove('bv-filter-hover');hovered=n;if(n)n.classList.add('bv-filter-hover');});
  paper.addEventListener('click',e=>{if(!pendingPick)return;e.preventDefault();e.stopImmediatePropagation();const n=e.target.closest('[data-bv-filter-target]');if(!n)return;const index=selected.indexOf(n);if(index>=0)selected.splice(index,1);else selected.push(n);n.classList.toggle('bv-filter-selected',index<0);pickHint.textContent='已选 '+selected.length+' 处 · '+n.dataset.bvFilterLabel;},true);
  addEventListener('keydown',e=>{if(e.key==='Escape'&&pendingPick){e.preventDefault();finishPick(true);}},true);
  function operationNodes(kind){const chosen=state.targets.filter(t=>t.kind===kind);if(!chosen.length)return [...paper.querySelectorAll('[data-bv-filter-kind="'+kind+'"]')];return chosen.flatMap(t=>[...paper.querySelectorAll(t.sameKind?'[data-bv-filter-kind="'+kind+'"]':targetSelector(t.id))]);}
  function makePlan(question){
    if(/表格|table/i.test(question))return null;
    const operations=[],labels=[],add=(nodes,type,styles)=>{for(const node of new Set(nodes))operations.push({type,target:{selector:targetSelector(node.dataset.bvFilterTarget)},...(styles?{styles}:{})});};
    if(/隐藏|移除|去掉|干扰|hide|remove/i.test(question)){
      let nodes=state.targets.filter(t=>t.kind==='distraction').map(t=>paper.querySelector(targetSelector(t.id))).filter(Boolean);
      if(!nodes.length&&!state.targets.length){const ids=/浮动|悬浮|download|标题栏/i.test(question)?['sticky']:/广告|advert/i.test(question)?['ad']:['sticky','ad','navigation'];nodes=ids.map(id=>paper.querySelector(targetSelector(id)));}
      if(nodes.length){add(nodes,'hide');labels.push('隐藏干扰区域，保留正文、图表与引用');}
    }
    if(/舒适|字号|行高|20px|font|reading|排版/i.test(question)){
      const caption=/图注|caption/i.test(question),kind=caption?'caption':'text';
      add(operationNodes(kind),'style',{'font-size':caption?'16px':'20px','line-height':caption?'1.6':'1.8','text-align':'left','white-space':'normal',color:'#333333'});labels.push(caption?'图注改为 16px，行高 1.6':'正文改为 20px，行高 1.8');
    }
    if(/图注更清楚/.test(question)&&!operations.some(o=>o.styles?.['font-size']==='16px')){add(operationNodes('caption'),'style',{'font-size':'16px','line-height':'1.6',color:'#333333'});labels.push('让图注更清楚');}
    if(/留白|外边距|spacing|margin/i.test(question)){const nodes=state.targets.length?state.targets.map(t=>paper.querySelector(targetSelector(t.id))).filter(Boolean):operationNodes('figure');add(nodes,'style',{'margin-top':'24px','margin-bottom':'24px'});labels.push('增加图文间距');}
    if(/长行|78ch|宽度|line length|width/i.test(question)){add(operationNodes('text'),'style',{'max-width':'78ch','margin-left':'auto','margin-right':'auto','white-space':'normal'});labels.push('限制正文行长并居中');}
    if(!operations.length)return null;
    return {operations,description:labels.join('；')};
  }
  function stopPreview(){state.plan=null;state.preview=false;state.saved=false;state.canUndo=false;state.saveConfirmation=null;undo=[];apply();}
  function tidyUI(){const doc=frame.contentDocument;if(!doc)return;
    for(const n of doc.querySelectorAll('[data-filter-plan] small'))if(n.textContent!=='官网预置规则示例；以下修改已实际应用到左侧论文。')n.textContent='官网预置规则示例；以下修改已实际应用到左侧论文。';
    const gen=doc.querySelector('[data-generalization]');if(gen&&!state.generalization&&gen.dataset.demoExpanded!=='true')gen.open=false;
    const preview=doc.querySelector('.wfg-ux-preview'),signature=JSON.stringify([state.plan,state.saveConfirmation]);
    if(state.plan&&preview&&!preview.hidden&&signature!==shownPreview){shownPreview=signature;requestAnimationFrame(()=>{const flow=doc.querySelector('[data-filter-workflow]');if(flow)flow.scrollTop=flow.scrollHeight;});}
    if(!state.adjusting){for(const n of doc.querySelectorAll('.wfg-ux-preview,.wfg-ux-chips [data-current]'))n.hidden=true;}
  }
  frame.addEventListener('load',()=>{const doc=frame.contentDocument;doc.addEventListener('click',e=>{const summary=e.target.closest('[data-generalization]>summary');if(summary)summary.parentElement.dataset.demoExpanded=String(!summary.parentElement.open);},true);new MutationObserver(tidyUI).observe(doc.body,{childList:true,subtree:true});});
  async function handle(m,demo){
    const active=frame.contentWindow?.__websiteDemo===demo;
    if(!active){if(m.command==='LIST')return {ok:true,data:[{id:1,url:D.source,title:D.title}]};if(m.command==='OUTLINE')return {ok:true,data:{tabId:1,nodes:[]}};return {ok:true,data:initial()};}
    state.notice='';
    switch(m.command){
      case 'STATE':case 'HISTORY':break;
      case 'LIST':return {ok:true,data:[{id:1,url:D.source,title:D.title}]};
      case 'OUTLINE':return {ok:true,data:{tabId:1,nodes:[]}};
      case 'MODE':
        if(!m.active){finishPick(true);state.targets=[];stopPreview();if(savedPlan){state.plan=clone(savedPlan);state.preview=true;apply();state.plan=null;state.preview=false;}state.turns=[];}
        else if(savedPlan){state.plan=clone(savedPlan);state.preview=true;state.saved=true;state.scopeLabel=state.saveScopeLabel;apply();}
        state.adjusting=!!m.active;state.adjustmentMode='display';break;
      case 'PICK':return beginPick();
      case 'FINISH_PICK':finishPick();break;
      case 'CANCEL_PICK':finishPick(true);break;
      case 'TARGETS':state.targets=m.targets.filter(t=>paper.querySelector(targetSelector(t.id)));break;
      case 'LOCATE_TARGET':paper.querySelector(targetSelector(m.id))?.scrollIntoView({block:'center',behavior:'smooth'});break;
      case 'RUN':{
        const next=makePlan(String(m.question||''));
        if(!next){state.notice='官网可演示移除干扰、正文排版、图注和图文留白。请选择一个快捷要求；自由生成规则请在插件中体验。';break;}
        undo.push({plan:clone(state.plan),preview:state.preview});
        state.plan={schemaVersion:2,operations:[...(state.plan?.operations||[]),...next.operations]};state.preview=true;state.saved=false;state.canUndo=true;state.saveConfirmation=null;apply();
        state.turns.push({turnId:'filter-example-'+(++serial),createdAt:Date.now(),question:m.question,answer:next.description+'。可对比原貌、继续修改，或保存本页效果。',status:'complete',interactionMode:'adjustment',displayPlan:clone(state.plan),profileName:'官网预置滤镜示例'});break;
      }
      case 'TOGGLE':state.preview=!state.preview;apply();break;
      case 'UNDO':{const prior=undo.pop();if(prior){state.plan=prior.plan;state.preview=prior.preview;state.saved=false;state.canUndo=undo.length>0;state.saveConfirmation=null;apply();}break;}
      case 'PREPARE_SAVE':if(state.preview&&state.plan)state.saveConfirmation={token:'website-preview-'+serial,scopeUrl:D.source,scopeLabel:state.saveScopeLabel};break;
      case 'SAVE':if(state.saveConfirmation?.token!==m.confirmationToken)return {ok:false,error:'SAVE_CONFIRMATION_EXPIRED'};savedPlan=clone(state.plan);state.saved=true;state.scopeLabel=state.saveScopeLabel;state.saveConfirmation=null;state.notice='本页滤镜已保存到此次体验。返回问答后效果保留；刷新官网会重置。';break;
      case 'CANCEL_SAVE':state.saveConfirmation=null;break;
      case 'DISABLE':savedPlan=null;stopPreview();break;
      case 'CANCEL':finishPick(true);stopPreview();break;
      case 'GENERALIZE_ADD':case 'GENERALIZE_GENERATE':case 'SWITCH_TAB':state.notice='官网仅准备了这一篇公开论文。安装插件后，补充另一网页、确认两页预览，即可比较并保存相似网页滤镜。';break;
      case 'EXPORT':return {ok:true,data:{id:'alphafold-website-example',raw:JSON.stringify({...state.plan,websiteExample:true,source:D.source},null,2)}};
      default:state.notice='此入口需在安装后的插件中使用。';
    }
    queueMicrotask(tidyUI);return {ok:true,data:clone(state)};
  }
  window.BV_FILTER_DEMO={handle,reset(){finishPick(true);restore();savedPlan=null;undo=[];state=initial();shownPreview=null;cleanSelection();},get state(){return clone(state);}};
})();
