(function(g){'use strict';
const views=new WeakMap(),all=new Set();
function element(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;}
function mount(form,u,api){
 const v={form,u,api,key:null,drafts:new Map(),state:null};views.set(form,v);all.add(v);
 const box=element('section','wfg-workflow');box.dataset.filterWorkflow='';box.setAttribute('aria-label','网页滤镜编辑');
 const head=element('div','wfg-workflow-head'),heading=element('strong','','网页滤镜'),close=u.querySelector('[data-exit-display]');close.textContent='返回问答';close.title='退出编辑并取消未保存的预览';close.setAttribute('aria-label','返回普通问答');const collapse=api.button('收起',()=>{v.collapsed=!v.collapsed;body.hidden=v.collapsed;collapse.textContent=v.collapsed?'展开':'收起';collapse.setAttribute('aria-expanded',String(!v.collapsed));});collapse.className+=' wfg-workflow-collapse';collapse.setAttribute('aria-expanded','true');const scripts=api.button('我的脚本',()=>api.scripts());scripts.title='管理已保存的网页脚本';if(form.id==='articleChatForm') { close.hidden=true; head.append(heading,collapse,close); } else head.append(heading,scripts,collapse,close);
 const steps=element('ol','wfg-workflow-steps');for(const label of ['描述调整','预览与微调','保存滤镜'])steps.append(element('li','',label));
 const target=element('div','wfg-workflow-target'),title=element('span','wfg-workflow-page');title.dataset.workflowPage='';
 target.append(title);
 const chips=u.querySelector('.wfg-ux-chips'),hint=element('p','wfg-workflow-hint');hint.dataset.workflowHint='';
 const review=element('div','wfg-workflow-review');review.append(u.querySelector('[data-generalization]'),u.querySelector('.wfg-ux-preview'));
 const body=element('div','wfg-workflow-body');body.append(steps,target,chips,hint,review);box.append(head,body);u.prepend(box);
 Object.assign(v,{box,body,heading,collapse,steps,title,hint,chips});
 api.input().addEventListener('input',()=>{if(v.key)v.drafts.set(v.key,api.input().value);});
}
function isDisplay(form) {
 return views.get(form)?.active === true;
}
function openPageCommands(form) {
 const view = views.get(form);
 if (!view?.active) return;
 const field = view.api.input();
 const space = field.selectionStart && !/\s$/u.test(field.value.slice(0, field.selectionStart)) ? ' ' : '';
 field.setRangeText(space + '@@', field.selectionStart, field.selectionEnd, 'end');
 field.focus();
 field.dispatchEvent(new Event('input', {bubbles: true}));
}
function refreshTabs(form) {
 return views.get(form)?.api.refreshTabs();
}
function targetCommands(form, symbol) {
 const view = views.get(form);
 if (!view?.active || view.state.busy || view.state.generalization?.busy) return [];
 if (symbol === '@') {
  return [{name: view.picking ? '完成选取' : '选择页面元素',
   detail: view.picking ? '使用已选的页面元素' : '在网页上点选要调整的区域',
   action: view.api.pick}];
 }
 if (view.picking) return [];
 const state = view.state, draft = state.generalization, samples = draft?.samples || [];
 const origin = draft?.wholePage && samples.length ? new URL(samples[0].url).origin : null;
 const host = new URL(state.url).hostname;
 return view.api.tabs().filter(tab => tab.id !== state.tabId && (!origin || new URL(tab.url).origin === origin))
  .sort((a,b) => Number(new URL(b.url).hostname === host) - Number(new URL(a.url).hostname === host))
  .map(tab => {
   const item = {name: tab.title || tab.url, detail: tab.url,
    action: () => view.api.switch(tab.id, !!draft && !samples.some(sample => sample.tabId === tab.id))};
   const included = state.referenceIds.includes(tab.id);
   if (!draft && (included || state.sourceIds.length < 6)) {
    item.referenceLabel = included ? '移除参考' : '作参考';
    item.referenceAction = () => view.api.toggleReference(tab.id);
   }
   return item;
  });
}
function render(form,state,picking){const v=views.get(form);if(!v)return;
 const availabilityChanged=v.picking!==picking || v.state?.busy!==state.busy ||
  v.state?.generalization?.busy!==state.generalization?.busy;
 v.state=state;
 const active=state.adjusting&&state.adjustmentMode!=='outline';
 const key=state.tabId+':'+state.documentKey+':'+(active?'filter':'chat');
 if(v.active&&!active){v.drafts.delete(v.key);v.key=null;v.u.querySelector('.wfg-ux-status').textContent='';v.u.querySelector('.wfg-ux-sources').hidden=true;v.collapsed=false;v.body.hidden=false;v.collapse.textContent='收起';v.collapse.setAttribute('aria-expanded','true');}
 v.active=!!active;v.picking=picking;v.u.dataset.filterEditing=String(!!active);if(v.key!==key){if(v.key)v.drafts.set(v.key,v.api.input().value);v.key=key;v.api.input().value=v.drafts.get(key)||'';v.api.input().dispatchEvent(new Event('input',{bubbles:true}));}
 v.box.hidden=!active;
 if(active)v.body.insertBefore(v.chips,v.hint);else v.u.querySelector('.wfg-composer-deck')?.append(v.chips);
 v.u.querySelector('[data-pick]').hidden=active;v.title.textContent=(state.generalization?'当前验证页 · ':'当前页 · ')+state.title;v.title.title=state.url;
 const stage=state.generalization||state.saved?2:state.plan?1:0;
 [...v.steps.children].forEach((li,i)=>{li.dataset.active=String(i===stage);if(i===stage)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
 v.heading.textContent=state.generalization?'网页滤镜 · 跨页验证':'网页滤镜';v.hint.hidden=!!state.generalization||!picking&&!state.busy&&!!(state.targets.length||state.plan);v.hint.textContent=picking?'点击要调整的区域；选好后点网页上的「完成选取」。':state.busy?'AI 正在检查目标并生成预览…':!active?'滤镜已保留，可切换原貌或继续编辑。':!state.targets.length?'':state.plan?'预览已显示在网页上。可继续提要求，或对比原貌后保存。':'已选 '+state.targets.length+' 个元素。输入调整要求，再发送预览。';
 if(!v.hint.textContent)v.hint.hidden=true;
 if(availabilityChanged && active && form.querySelector('#articleChatCommandMenu')?.hidden===false &&
    typeof updateArticleChatCommandMenu==='function')updateArticleChatCommandMenu();
 const send=form.querySelector('[type=submit]');if(active&&send){send.setAttribute('aria-label',state.busy?'正在生成预览':'发送要求并预览');send.title='发送要求并在网页预览';}else if(send){send.removeAttribute('aria-label');send.removeAttribute('title');}
}
function suspend(){if(typeof closeArticleChatCommandMenu==='function')closeArticleChatCommandMenu();for(const v of all){if(v.key)v.drafts.set(v.key,v.api.input().value);v.key=null;v.active=false;v.u.dataset.filterEditing='false';v.api.input().value='';v.box.hidden=true;}}
g.WFGWorkflow={mount,render,suspend,isDisplay,refreshTabs,targetCommands,openPageCommands};
})(globalThis);
