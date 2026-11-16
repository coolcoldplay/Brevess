(async function () {
  const events = () => { const listeners=[];return {addListener:fn=>listeners.push(fn),emit:(...args)=>listeners.forEach(fn=>fn(...args))}; };
  const tabs = new Map(), states = new Map(), runtimeEvent=events(), activated=events(); let active=1, raw, session={};
  const frames = [document.querySelector('#a'),document.querySelector('#b')];
  await Promise.all(frames.map(frame=>frame.contentWindow.qa?Promise.resolve():new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}))));
  frames.forEach((frame,i)=>tabs.set(i+1,{id:i+1,windowId:7,url:frame.contentWindow.location.href,title:'Sample '+(i+1),frame}));
  const repo=WFGReadingModules.repository({readRaw:async()=>raw,writeRaw:async value=>{raw=value;}});
  function view(){const st=states.get(active)||{tabId:active,windowId:7,documentKey:'fixture-'+active,url:tabs.get(active).url,title:tabs.get(active).title,sourceIds:[active],referenceIds:[],targets:[],turns:[],adjusting:false,preview:false};return {...st,navigationUrl:st.url,saveScopeLabel:'当前网页路径；相似网页须补充样例',generalization:general.summary(7)};}
  const publish=()=>runtimeEvent.emit({type:'WFG_UX_STATE',state:view()},{id:'qa-extension'});
  const browser={storage:{session:{get:async key=>({[key]:session[key]}),set:async value=>Object.assign(session,structuredClone(value))}},tabs:{get:async id=>tabs.get(id)}};
  const general=WFGGeneralization.create({browser,repository:()=>repo,notify:async()=>{},onChange:publish,
    broker:{overview:async id=>({frames:[{frameId:0,ok:true,data:tabs.get(id).frame.contentWindow.qa.engine.query('overview')}]}),rpc:async(id,frame,command,data)=>tabs.get(id).frame.contentWindow.qa.rpc(command,data)},
    createTask:async()=>({maxCharacters:40000,adapter:{async *generateTextStream(){yield {type:'text_delta',text:JSON.stringify({name:'双样例论文排版',selectors:['.paper-body > p'],hosts:['127.0.0.1'],pathPrefixes:['/articles/'],excludePrefixes:[],roots:['.paper-body'],required:['h1.paper-title'],common:'论文标题、正文容器和段落结构一致。',differences:'正文编号不同，B页多了一层包装及一个段落。',scopeReason:'仅 /articles/ 下符合论文标题和正文结构的页面。'})};yield {type:'completed',finishReason:'stop'};}}})});
  await general.ready;
  globalThis.chrome={runtime:{id:'qa-extension',onMessage:runtimeEvent,sendMessage:async m=>{try{if(m.command==='STATE'||m.command==='HISTORY')return {ok:true,data:view()};if(m.command==='LIST')return {ok:true,data:[...tabs.values()].map(({frame,...t})=>t)};if(m.command==='OUTLINE')return {ok:true,data:{tabId:active,frames:[]}};if(m.command==='MODE'){const st=states.get(active)||view();st.adjusting=m.active;st.adjustmentMode='display';if(!m.active){tabs.get(active).frame.contentWindow.qa.engine.undo();tabs.get(active).frame.contentWindow.qa.reading.setPreview(false);st.plan=null;st.preview=false;st.targets=[];}states.set(active,st);publish();return {ok:true,data:view()};}if(m.command==='GENERALIZE_ADD')await general.add(states.get(active));else if(m.command==='GENERALIZE_GENERATE')await general.generate(7);else if(m.command==='GENERALIZE_SAVE')await general.save(7,m.token);else if(m.command==='GENERALIZE_REMOVE')await general.remove(7,m.tabId);else if(m.command==='GENERALIZE_CANCEL')await general.cancel(7);return {ok:true,data:view()};}catch(e){return {ok:false,error:e.message};}}},windows:{getCurrent:async()=>({id:7})},tabs:{query:async()=>[{...tabs.get(active),frame:undefined}],onActivated:activated,onUpdated:events()}};
  async function prepare(id){active=id;const tab=tabs.get(id),p=await tab.frame.contentWindow.qa.preview();states.set(id,{tabId:id,windowId:7,documentKey:'fixture-'+id,url:tab.url,title:tab.title,sourceIds:[id],referenceIds:[],turns:[],adjusting:true,adjustmentMode:'display',preview:true,plan:p.plan,feedback:[p.feedback],targets:[{...p.target,tabId:id,frameId:0,sourceTitle:tab.title}]});activated.emit({tabId:id,windowId:7});publish();}
  document.querySelector('#prepare-a').onclick=()=>prepare(1);document.querySelector('#prepare-b').onclick=()=>prepare(2);
  const script=document.createElement('script');script.src='/web-filters-general/ux-panel.js';document.body.append(script);
  const checks=[];function check(name,fn){try{fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}const equal=(a,b)=>{if(a!==b)throw Error(JSON.stringify({actual:a,expected:b}));};
  document.querySelector('#check-dom').onclick=async()=>{
    checks.length=0;check('真实问答编辑器保留双页验证控件',()=>equal(!!document.querySelector('#articleChatForm[data-wfg-composer] [data-generalization]'),true)); const module=(await repo.read()).entries.find(e=>!e.builtinId)?.module;
    if(!module){document.querySelector('#results').textContent='请先用两个样例完成保存。';return;}
    for(const route of ['/articles/c','/help/a','/articles/form']){
      const frame=document.createElement('iframe');frame.src=route;document.body.append(frame);await new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
      const w=frame.contentWindow,q=w.qa,body=w.document.querySelector('.paper-body'),before=body.textContent;
      q.reading.setConfig(q.config(module));
      if(route==='/articles/c'){
        check('第三篇新论文套用字号',()=>equal(w.getComputedStyle(body.querySelector('p')).fontSize,'22px'));
        check('第三篇新论文套用行距',()=>equal(w.getComputedStyle(body.querySelector('p')).lineHeight,'39.6px'));
        check('侧栏没有误套用',()=>equal(w.getComputedStyle(w.document.querySelector('aside p')).fontSize,'16px'));
        check('正文原文完整',()=>equal(body.textContent,before));
        check('表格原节点保留',()=>equal(body.querySelectorAll('table').length,1));
        const single={...structuredClone(module),id:'zz-local',match:{...module.match,pathMode:'exact',pathPrefixes:['/articles/c']},rules:{...module.rules,operations:[{...module.rules.operations[0],styles:{'font-size':'25px'}}]}};
        q.reading.setConfig({version:1,generation:0,deletedBuiltins:[],entries:[{module,enabled:true,builtinId:null},{module:single,enabled:true,builtinId:null}]});
        check('当前页规则优先于宽范围规则',()=>equal(w.getComputedStyle(body.querySelector('p')).fontSize,'25px'));
        q.reading.setConfig({version:1,generation:0,deletedBuiltins:[],entries:[{module,enabled:false,builtinId:null}]});
        check('停用恢复原字号',()=>equal(w.getComputedStyle(body.querySelector('p')).fontSize,'16px'));
      }else check(route===' /help/a'?'其他路径保持原貌':route+'未自动修改',()=>equal(w.getComputedStyle(body.querySelector('p')).fontSize,'16px'));
      q.engine.destroy();q.reading.destroy();frame.remove();
    }
    const q=frames[0].contentWindow.qa;
    check('隐藏正文仍受保护',()=>{let denied=false;try{q.reading.validateModule({...structuredClone(module),rules:{...module.rules,operations:[{type:'hide',target:{frame:'top',roots:[],selector:'.paper-body'}}]}});}catch(e){denied=e.message==='PROTECTED_CONTENT_HIDE';}equal(denied,true);});
    window.displayChecks=checks;document.querySelector('#results').textContent=JSON.stringify(checks,null,2);
  };
  window.displayQA={general,tabs,states,repo,prepare};
})();
