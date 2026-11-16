(function(){
const checks=[],equal=(a,b)=>{if(a!==b)throw Error(JSON.stringify({actual:a,expected:b}));};
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}
document.querySelector('#check-reading').onclick=async()=>{
 checks.length=0;const frame=document.createElement('iframe');frame.src='/articles/c';document.body.append(frame);await new Promise(r=>frame.onload=r);
 const w=frame.contentWindow,q=w.qa,doc=w.document,article=doc.querySelector('article'),img=doc.querySelector('img'),initialText=article.textContent,src=img.getAttribute('src');
 const target=selector=>({frame:'top',roots:[],selector});
 const scenarios=[
  ['移除侧栏推荐',{type:'hide',target:target('aside.related')},()=>equal(w.getComputedStyle(doc.querySelector('aside')).display,'none')],
  ['移除悬浮导航栏的无标识子元素',{type:'hide',target:target('#js-enable-context-bar > div')},()=>equal(w.getComputedStyle(doc.querySelector('.context-inner')).display,'none')],
  ['正文的字号、行距、左对齐',{type:'style',target:target('.paper-body > p'),styles:{'font-size':'20px','line-height':'1.8','text-align':'left','white-space':'normal'}},()=>{equal(w.getComputedStyle(article.querySelector('p')).fontSize,'20px');equal(w.getComputedStyle(article.querySelector('p')).lineHeight,'36px');}],
  ['正文宽度和居中',{type:'style',target:target('.paper-body'),styles:{'max-width':'78ch','margin-left':'auto','margin-right':'auto'}},()=>equal(article.style.maxWidth,'78ch')],
  ['图片完整等比显示',{type:'style',target:target('figure img'),styles:{width:'100%','max-width':'100%',height:'auto','max-height':'none','object-fit':'contain'}},()=>{equal(w.getComputedStyle(img).objectFit,'contain');const r=img.getBoundingClientRect();if(Math.abs(r.width/r.height-2)>.01)throw Error('图片比例被改变');}],
  ['图注大小和对比度',{type:'style',target:target('figcaption'),styles:{'font-size':'16px','line-height':'1.6',color:'#333333'}},()=>equal(w.getComputedStyle(doc.querySelector('figcaption')).lineHeight,'25.6px')],
  ['长表格横向阅读',{type:'style',target:target('table'),styles:{display:'block','max-width':'100%','overflow-x':'auto','font-size':'16px'}},()=>equal(w.getComputedStyle(doc.querySelector('table')).overflowX,'auto')],
  ['标题间距和层级',{type:'style',target:target('.paper-body > p'),styles:{'margin-bottom':'20px','font-weight':'500'}},()=>equal(w.getComputedStyle(article.querySelector('p')).marginBottom,'20px')]
 ];
 for(const [name,op,verify] of scenarios)await check(name+'：预览、保存重放、还原',async()=>{
  const plan={schemaVersion:2,id:'reading-qa',revision:0,name,scope:await w.WFGSchema.scope(w.location.href),operations:[op]};
  q.reading.setConfig(q.config(q.base));q.reading.setPreview(true);const preview=q.engine.apply(q.native(plan),q.engine.session());equal(preview.verified,true);verify();
  const module=q.reading.validatePlan(plan,{reusable:false});q.engine.undo();q.reading.setPreview(false);q.reading.setConfig(q.config(module));verify();
  equal(article.textContent,initialText);equal(img.getAttribute('src'),src);equal(doc.querySelector('figcaption a').getAttribute('href'),'#citation');
  q.reading.setConfig(q.config(q.base));equal(article.querySelector('p').style.fontSize,'');equal(img.style.width,'');equal(doc.querySelector('.context-inner').style.display,'');
 });
 await check('仅将实际验证的正文根传给泛化，不包含备用交互区域',async()=>{
  const field=doc.createElement('input');doc.querySelector('main').append(field);
  const base=structuredClone(q.base);base.rules.roots=['.paper-body','main'];q.reading.setConfig(q.config(base));
  const plan={schemaVersion:2,id:'root-proof',revision:0,name:'正文',scope:await w.WFGSchema.scope(w.location.href),operations:[{type:'style',target:target('.paper-body > p'),styles:{'font-size':'20px'}}]};
  const result=q.reading.validatePlan(plan,{reusable:false});equal(JSON.stringify(result.rules.roots),JSON.stringify(['.paper-body']));
  field.remove();q.reading.setConfig(q.config(q.base));
 });
 for(const selector of ['.paper-body','figure','table','figcaption'])await check('拒绝自动隐藏受保护内容 '+selector,()=>{let denied=false;try{q.reading.validateModule({...structuredClone(q.base),rules:{...q.base.rules,operations:[{type:'hide',target:target(selector)}]}});}catch(e){denied=e.message==='PROTECTED_CONTENT_HIDE';}equal(denied,true);});
 await check('带输入框的悬浮栏不能自动隐藏',()=>{const field=doc.createElement('input');doc.querySelector('.context-inner').append(field);let denied=false;try{q.reading.validateModule({...structuredClone(q.base),rules:{...q.base.rules,operations:[{type:'hide',target:target('.context-inner')}]}});}catch(e){denied=e.message==='PROTECTED_CONTENT_HIDE';}field.remove();equal(denied,true);});
 await check('选区取消后恢复原有选区',async()=>{
  const p=article.querySelector('p');q.picker.setTargets([q.engine.describeElement(p)]);const pending=q.picker.pick().catch(e=>e.message);const shadow=doc.querySelector('[data-wfg-owned=selection]').shadowRoot;[...shadow.querySelectorAll('button')].find(b=>b.textContent==='取消').click();equal(await pending,'SELECTION_CANCELLED');equal(shadow.querySelectorAll('.box').length,1);
 });
 await check('透明图片链接覆盖层优先选择图像，按钮文字仍可选',async()=>{
  const figure=img.closest('figure'),link=doc.createElement('a');link.href='#image';link.textContent='Full size image';figure.append(link);img.scrollIntoView({block:'center'});
  const r=img.getBoundingClientRect();let pending=q.picker.pick();
  for(const type of ['pointerdown','pointerup'])link.dispatchEvent(new w.PointerEvent(type,{bubbles:true,composed:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0}));
  q.picker.finishPick();equal((await pending)[0].tag,'img');
  pending=q.picker.pick();const lr=link.getBoundingClientRect();for(const type of ['pointerdown','pointerup'])link.dispatchEvent(new w.PointerEvent(type,{bubbles:true,composed:true,clientX:lr.left+2,clientY:lr.bottom-1,button:0}));
  q.picker.finishPick();equal((await pending)[0].tag,'a');link.remove();
 });
 await check('图片透明链接覆盖悬浮导航时优先选中可见栏位',async()=>{
  img.scrollIntoView({block:'center'});const r=img.getBoundingClientRect(),bar=doc.createElement('nav');bar.textContent='Visible fixed navigation';bar.style.cssText='position:fixed;background:white;z-index:1000;left:'+r.left+'px;top:'+(r.top+10)+'px;width:200px;height:40px';doc.body.append(bar);
  const pending=q.picker.pick();for(const type of ['pointerdown','pointerup'])img.dispatchEvent(new w.PointerEvent(type,{bubbles:true,composed:true,clientX:r.left+20,clientY:r.top+20,button:0}));q.picker.finishPick();equal((await pending)[0].tag,'nav');bar.remove();
 });
 await check('图片放大镜的光标变化不使选区失效，尺寸变化仍拒绝',async()=>{
  const record=q.engine.describeElement(img),args={session:q.engine.session(),records:[{kind:'inspect',record,selection:true}]};
  img.style.setProperty('cursor','none','important');await Promise.resolve();equal(q.engine.query('verifyRecords',args).verified,true);
  img.style.removeProperty('cursor');await Promise.resolve();equal(q.engine.query('verifyRecords',args).verified,true);
  img.style.width='100px';await Promise.resolve();let denied=false;try{q.engine.query('verifyRecords',args);}catch(e){denied=e.message==='SOURCE_TARGET_CHANGED';}equal(denied,true);img.style.removeProperty('width');
 });
 await check('已确认的隐藏父容器允许内层选区，拒绝无关元素及整个页面',async()=>{
  const inner=doc.querySelector('.context-inner'),selected=q.engine.describeElement(inner),sibling=q.engine.describeElement(article.querySelector('p'));
  const plan={schemaVersion:2,id:'parent-proof',revision:0,name:'隐藏悬浮栏',scope:await w.WFGSchema.scope(w.location.href),operations:[{type:'hide',target:target('#js-enable-context-bar')}]};
  q.reading.setPreview(true);q.engine.apply(q.native(plan),q.engine.session());
  const args={session:q.engine.session(),targets:[target('#js-enable-context-bar')],selectedIds:[selected.id]};
  equal(q.engine.query('planTargets',q.native(args)).groups[0].selectionRelated,true);
  equal(q.engine.query('planTargets',q.native({...args,selectedIds:[sibling.id]})).groups[0].selectionRelated,false);
  equal(q.engine.query('planTargets',q.native({...args,targets:[target('body')]})).groups[0].selectionRelated,false);
  q.engine.undo();q.reading.setPreview(false);
 });
 q.picker.destroy();q.engine.destroy();q.reading.destroy();frame.remove();window.readingChecks=checks;document.querySelector('#results').textContent=JSON.stringify(checks,null,2);
};
})();
