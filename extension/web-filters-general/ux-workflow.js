(function(g){'use strict';
const views=new WeakMap(),all=new Set();
const presets=[
 ['移除干扰','隐藏所选的广告、推荐或悬浮导航区域，保留论文正文、图片、图注与引用链接。'],
 ['正文舒适阅读','将所选正文设为 20px，行高 1.8，左对齐，正常换行；保留原文和引用链接。'],
 ['图文留白','仅将当前所选元素的上、下外边距设为 24px，不修改父元素；保留图片、图注和引用链接，不改变图片大小、比例或来源。'],
 ['图注更清楚','将所选图注字号设为 16px，行高 1.6，文字颜色 #333333；保留图注内容与链接。'],
 ['宽表格滚动','让所选表格横向滚动：display 为 block，最大宽度 100%，overflow-x 为 auto；保留全部表格行列和单元格。'],
 ['长行适合阅读','将所选正文容器最大宽度设为 78ch，左右居中，保留自然换行。']
];
function element(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;}
function mount(form,u,api){
 const v={form,u,api,key:null,drafts:new Map(),state:null};views.set(form,v);all.add(v);
 const box=element('section','wfg-workflow');box.dataset.filterWorkflow='';box.setAttribute('aria-label','网页滤镜编辑');
 const head=element('div','wfg-workflow-head'),heading=element('strong','','网页滤镜'),close=u.querySelector('[data-exit-display]');close.textContent='返回问答';close.title='退出编辑并取消未保存的预览';close.setAttribute('aria-label','返回普通问答');const collapse=api.button('收起',()=>{v.collapsed=!v.collapsed;body.hidden=v.collapsed;collapse.textContent=v.collapsed?'展开':'收起';collapse.setAttribute('aria-expanded',String(!v.collapsed));});collapse.className+=' wfg-workflow-collapse';collapse.setAttribute('aria-expanded','true');head.append(heading,collapse,close);
 const steps=element('ol','wfg-workflow-steps');for(const label of ['选元素','提要求 / 预览','验证 / 保存'])steps.append(element('li','',label));
 const target=element('div','wfg-workflow-target'),title=element('span','wfg-workflow-page');title.dataset.workflowPage='';
 const choose=api.button('切换网页',async()=>{await api.list();chooser.hidden=!chooser.hidden;renderTabs(v);if(!chooser.hidden)search.focus();});choose.dataset.choosePage='';choose.setAttribute('aria-expanded','false');
 const select=u.querySelector('[data-select-target]');target.append(title,choose,select);
 const chooser=element('div','wfg-workflow-chooser');chooser.hidden=true;chooser.setAttribute('role','group');chooser.setAttribute('aria-label','切换网页并选择元素');
 const search=element('input');search.type='search';search.placeholder='搜索已打开的论文网页';search.setAttribute('aria-label','搜索要调整的网页');search.oninput=()=>renderTabs(v);
 const rows=element('div','wfg-workflow-tabs');chooser.append(search,rows);chooser.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();chooser.hidden=true;choose.setAttribute('aria-expanded','false');choose.focus();}});
 const chips=u.querySelector('.wfg-ux-chips'),hint=element('p','wfg-workflow-hint');hint.dataset.workflowHint='';
 const prompt=element('details','wfg-workflow-presets');prompt.setAttribute('aria-label','论文阅读调整示例');
 const caption=element('summary','','快捷要求 · 6');prompt.append(caption);
 for(const [label,text]of presets){const b=api.button(label,()=>{const i=api.input();i.value=i.value.trim()?i.value.trim()+'\n'+text:text;i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();});b.dataset.filterPreset='';b.title=text;prompt.append(b);}
 const review=element('div','wfg-workflow-review');review.append(u.querySelector('[data-generalization]'),u.querySelector('.wfg-ux-preview'));
 const body=element('div','wfg-workflow-body');body.append(steps,target,chooser,chips,hint,prompt,review);box.append(head,body);u.prepend(box);
 Object.assign(v,{box,body,heading,collapse,steps,title,choose,chooser,search,rows,hint,prompt,review,select,chips});
 api.input().addEventListener('input',()=>{if(v.key)v.drafts.set(v.key,api.input().value);});
}
function renderTabs(v){
 const q=v.search.value.toLowerCase();v.rows.replaceChildren();v.choose.setAttribute('aria-expanded',String(!v.chooser.hidden));
 const host=new URL(v.state.url).hostname, samples=v.state.generalization?.samples||[];
 const choices=v.api.tabs().filter(t=>(t.title+' '+t.url).toLowerCase().includes(q)).sort((a,b)=>Number(new URL(b.url).hostname===host)-Number(new URL(a.url).hostname===host));
 for(const t of choices){
  const row=element('div','wfg-workflow-tab'),name=element('span','',t.title),host=element('small','',new URL(t.url).hostname+(new URL(t.url).hostname===new URL(v.state.url).hostname?' · 同站点':''));name.title=t.url;const text=element('div');text.append(name,host);
  const current=t.id===v.state?.tabId,sample=v.state?.generalization?.samples.find(s=>s.tabId===t.id);
  const action=v.api.button(current?'在本页选取':sample?'返回样例':'切换并选取',()=>{v.chooser.hidden=true;v.choose.setAttribute('aria-expanded','false');return current?v.api.pick():v.api.switch(t.id,!sample);});if(current&&samples.length)continue;row.append(text,action);v.rows.append(row);
 }
 if(!v.rows.childElementCount)v.rows.append(element('p','','没有匹配的网页；先在 Chrome 打开另一篇论文。'));
}
function render(form,state,picking){const v=views.get(form);if(!v)return;v.state=state;
 const active=state.adjusting&&state.adjustmentMode!=='outline';
 const key=state.tabId+':'+state.documentKey+':'+(active?'filter':'chat');
 if(v.active&&!active){v.drafts.delete(v.key);v.key=null;v.u.querySelector('.wfg-ux-status').textContent='';v.u.querySelector('.wfg-ux-sources').hidden=true;v.chooser.hidden=true;v.prompt.open=false;v.collapsed=false;v.body.hidden=false;v.collapse.textContent='收起';v.collapse.setAttribute('aria-expanded','true');}
 v.active=active;if(v.key!==key){if(v.key)v.drafts.set(v.key,v.api.input().value);v.key=key;v.api.input().value=v.drafts.get(key)||'';v.api.input().dispatchEvent(new Event('input',{bubbles:true}));}
 v.box.hidden=!active;
 v.u.dataset.filterEditing=String(active);
 if(active)v.body.insertBefore(v.chips,v.hint);else v.u.querySelector('.wfg-composer-deck')?.append(v.chips);
 v.u.querySelector('[data-pick]').hidden=active;v.title.textContent=(state.generalization?'当前验证页 · ':'当前页 · ')+state.title;v.title.title=state.url;
 v.select.textContent=picking?'完成选取':state.targets.length?'重新选择元素':'选择元素';v.select.hidden=!active;
 v.choose.disabled=!!state.busy||!!state.generalization?.busy||picking;v.choose.hidden=!active&&!state.generalization;
 const stage=state.generalization||state.saved?2:state.plan||state.targets.length?1:0;
 [...v.steps.children].forEach((li,i)=>{li.dataset.active=String(i===stage);if(i===stage)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
 v.heading.textContent=state.generalization?'网页滤镜 · 跨页验证':'网页滤镜';v.hint.hidden=!!state.generalization||!picking&&!state.busy&&!!(state.targets.length||state.plan);v.hint.textContent=picking?'点击要调整的区域；选好后点网页上的「完成选取」。':state.busy?'AI 正在检查目标并生成预览…':!active?'滤镜已保留，可切换原貌或继续编辑。':!state.targets.length?'点选网页元素，再描述调整。':state.plan?'预览已显示在网页上。可继续提要求，或对比原貌后保存。':'已选 '+state.targets.length+' 个元素。点击下方示例或输入你的要求，再发送预览。';
 v.prompt.hidden=!active||!!state.plan||picking;for(const b of v.prompt.querySelectorAll('button'))b.disabled=!!state.busy;
 const send=form.querySelector('[type=submit]');if(active&&send){send.setAttribute('aria-label',state.busy?'正在生成预览':'发送要求并预览');send.title='发送要求并在网页预览';}else if(send){send.removeAttribute('aria-label');send.removeAttribute('title');}
 if(!v.chooser.hidden)renderTabs(v);
}
function suspend(){for(const v of all){if(v.key)v.drafts.set(v.key,v.api.input().value);v.key=null;v.api.input().value='';v.box.hidden=true;v.chooser.hidden=true;}}
g.WFGWorkflow={mount,render,suspend};
})(globalThis);
