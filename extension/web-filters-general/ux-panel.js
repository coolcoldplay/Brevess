(function(){'use strict';
let state=null,tabs=[],busy=false,refreshing=false,scheduled=false,picking=false,modeBusy=false,pickSequence=0,pickTask=null;const mounted=new WeakSet();let outline=null,outlineSequence=0,outlineTimer=null;

let pendingSelectTab=null, focusedFilterKey=null;
let navigationGeneration=0,refreshSequence=0,contextPending=true,nativeSequenceFloor=-1,contextTarget=null,contextWindowId=null;
function binding(value){return value?{tabId:value.tabId,navigationUrl:value.navigationUrl||value.url||'',documentKey:value.documentKey||''}:null;}
function sameBinding(a,b){return !!a&&!!b&&a.tabId===b.tabId&&a.navigationUrl===b.navigationUrl&&a.documentKey===b.documentKey;}
function clearTimeline(){for(const log of document.querySelectorAll('#articleChatMessages,#webHistory')){log.querySelectorAll('.article-chat-turn,[data-wfg-turn],[data-turn-id],.article-chat-draft,.workspace-empty').forEach(n=>n.remove());delete log.dataset.wfgDocument;}liveProcess.clear();}
function invalidateContext(){document.querySelector('dialog.wfg-script-library[open]')?.close();globalThis.WFGWorkflow?.suspend();navigationGeneration++;refreshSequence++;contextPending=true;state=null;tabs=[];busy=false;picking=false;modeBusy=false;pickSequence++;clearTimeout(outlineTimer);outlineSequence++;outline=null;clearTimeline();
 for(const f of forms()){f.querySelector('.wfg-ux-chips')?.replaceChildren();for(const n of f.querySelectorAll('.wfg-ux-preview,.wfg-ux-sources'))n.hidden=true;const send=f.querySelector('[type=submit]');if(send)send.disabled=true;}
 message('正在连接当前页面…');
 if(typeof activePanelTabContext!=='undefined'&&typeof scheduleActiveTabContextSync==='function'){nativeSequenceFloor=Number(activePanelTabContext.tabContextSequence)||0;scheduleActiveTabContextSync({force:true});}
}
function trustedPdfReader(value){try{const url=new URL(value),own=new URL(chrome.runtime.getURL(''));return url.protocol===own.protocol&&url.host===own.host&&url.pathname==='/pdf-reader.html';}catch{return false;}}
function savedNativeContext(context,snapshot){
 if(!context?.activated||!snapshot?.documentId)return false;
 if(context.pdfMode)return trustedPdfReader(context.url)&&typeof currentWorkspaceSnapshot!=='undefined'&&snapshot.documentId===currentWorkspaceSnapshot?.documentId&&snapshot.documentHash===currentWorkspaceSnapshot?.documentHash&&snapshot.url===currentWorkspaceSnapshot?.url;
 if(!context.offlineMode)return false;
 const reader=globalThis.SciLLM?.parseOfflineArticleReaderUrl?.(context.url,chrome.runtime.getURL(''));
 return !!reader&&snapshot.localWorkspace?.workspaceId===reader.workspaceId&&
  (reader.workspaceGeneration===null||Number(snapshot.localWorkspace.workspaceGeneration||1)===reader.workspaceGeneration);
}
function acceptNativeContext(context,snapshot){
 if(savedNativeContext(context,snapshot))return true;
 const target=state?binding(state):contextTarget;
 if(contextPending||!target||!context||context.tabId!==target.tabId)return false;
 const normalize=value=>{try{const u=new URL(value);u.hash='';return u.href;}catch{return String(value||'');}};
 if(normalize(context.url)!==normalize(target.navigationUrl))return false;
 return nativeSequenceFloor<0||(Number(context.tabContextSequence)||0)>nativeSequenceFloor;
}
function restoreNativeTimeline(){if(typeof renderArticleChatSnapshot==='function'&&typeof currentWorkspaceSnapshot!=='undefined'&&typeof activePanelTabContext!=='undefined'&&currentWorkspaceSnapshot&&acceptNativeContext(activePanelTabContext,currentWorkspaceSnapshot))renderArticleChatSnapshot(currentWorkspaceSnapshot);}
async function call(command,data={}){
 const generation=navigationGeneration,expected=state?binding(state):null;
 const windowId=(await chrome.windows.getCurrent()).id;
 if(generation!==navigationGeneration)throw Error('PAGE_CHANGED');
 const r=await chrome.runtime.sendMessage({type:'WFG_UX',command,windowId,...(expected&&!['STATE','LIST'].includes(command)?{expectedContext:expected}:{}),...data});
 if(generation!==navigationGeneration&&command!=='SWITCH_TAB')throw Error('PAGE_CHANGED');
 if(!r?.ok)throw Error(r?.error||'请求未完成');
 if(expected&&r.data&&typeof r.data==='object'&&'sourceIds'in r.data&&command!=='STATE'&&!sameBinding(expected,binding(r.data)))throw Error('PAGE_CHANGED');
 return r.data;
}
async function refreshOutline(){const seq=++outlineSequence;try{const result=await call('OUTLINE');if(result.tabId!==state?.tabId)throw Error('OUTLINE_PAGE_CHANGED');if(seq===outlineSequence){outline=result;document.dispatchEvent(new CustomEvent('brevess:temporary-outline',{detail:result}));}return result;}catch(e){if(seq===outlineSequence){outline=null;document.dispatchEvent(new CustomEvent('brevess:temporary-outline',{detail:null}));}throw e;}}
function forms(){return [...document.querySelectorAll('#articleChatForm,#webQuestionForm')];}
function input(form){return form.querySelector('#articleChatQuestion,#webQuestion');}
function defaultQuestionHint(){
 const text='直接提问或者试试输入 / 或者 @ 或者@@';
 return globalThis.SciLLM?.translateInterfaceText?.(text)||text;
}
function icon(name){
 if(name==='sliders-horizontal'){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');for(const [k,v]of Object.entries({viewBox:'0 0 24 24',width:'20',height:'20',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','aria-hidden':'true'}))svg.setAttribute(k,v);const path=document.createElementNS(ns,'path');path.setAttribute('d','M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10');svg.append(path);for(const [x,y]of [[9,6],[15,12],[9,18]]){const c=document.createElementNS(ns,'circle');c.setAttribute('cx',x);c.setAttribute('cy',y);c.setAttribute('r','2');svg.append(c);}return svg;}
 const i=document.createElement('i');i.className='ph ph-'+name;i.setAttribute('aria-hidden','true');return i;
}
function labelButton(b,text,name){b.replaceChildren();if(name)b.append(icon(name));const label=document.createElement('span');label.textContent=text;b.append(label);}
function btn(text,action,title=''){const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';b.textContent=text;if(title)b.title=title;b.onclick=()=>{if(b.disabled)return;const controls=[...document.querySelectorAll('[data-pick],[data-toggle],[data-undo],[data-save],[data-cancel],[data-add-sources],[data-share],[data-disable],[data-filter-confirm],[data-filter-decline]')];for(const c of controls)c.disabled=true;void run(action).finally(()=>{for(const c of controls)c.disabled=false;render();});};return b;}

async function showSavedScripts(){
 const dialog=document.createElement('dialog');dialog.className='wfg-script-library';
 dialog.setAttribute('aria-label','我的脚本');
 const head=document.createElement('header'),title=document.createElement('strong'),close=document.createElement('button');
 title.textContent='我的脚本';close.type='button';close.textContent='关闭';close.onclick=()=>dialog.close();
 const list=document.createElement('div'),notice=document.createElement('p');notice.setAttribute('role','status');
 head.append(title,close);dialog.append(head,list,notice);document.body.append(dialog);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 const generation=navigationGeneration;
 function draw(items){
  if(!dialog.open)return;
  if(navigationGeneration!==generation){dialog.close();return;}
  list.replaceChildren();
  if(!items.length){list.textContent='还没有保存的脚本';return;}
  for(const relevant of [true,false]){
   const group=items.filter(s=>s.matches===relevant).sort((a,b)=>Number(!!a.builtin)-Number(!!b.builtin));if(!group.length)continue;
   const label=document.createElement('h3');label.textContent=relevant?'当前网页':'其他网页';list.append(label);
   for(const item of group){
    const row=document.createElement('div'),label=document.createElement('label'),info=document.createElement('span'),name=document.createElement('b'),scope=document.createElement('small'),toggle=document.createElement('input');
    row.className='wfg-script-row';
    name.textContent=item.name+' · V'+Math.max(1,item.version);scope.textContent=item.scope;
    if(item.builtin||item.kind==='preview'){
     const origin=document.createElement('span');origin.textContent=item.builtin?'内置脚本':'临时预览';
     scope.prepend(origin,document.createTextNode(' · '));
    }
    toggle.type='checkbox';toggle.checked=item.enabled;toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','启用 '+item.name);
    async function update(command,data,message){
     if(list.inert)return;
     list.inert=true;notice.textContent='正在更新…';
     try{
      draw(await call(command,{kind:item.kind,id:item.id,generation:item.generation,...data}));
      notice.textContent=message;
     }catch(e){
      toggle.checked=item.enabled;
      notice.textContent=e.message==='GENERATION_CONFLICT'?'脚本列表已更新，请重新选择。':errorText(e.message);
      try{draw(await call('SCRIPTS_LIST'));}catch{}
     }finally{
      list.inert=false;
      if(dialog.open){
       const switches=[...list.querySelectorAll('[role="switch"]')];
       (switches.find(el=>el.dataset.scriptId===item.id&&el.dataset.kind===item.kind)||switches[0]||close).focus();
      }
     }
    }
    toggle.dataset.scriptId=item.id;toggle.dataset.kind=item.kind;
    toggle.onchange=()=>update('SCRIPT_ENABLE',{enabled:toggle.checked},'已更新');
    const remove=document.createElement('button');
    remove.type='button';remove.className='wfg-delete-script';remove.title='删除脚本';
    remove.setAttribute('aria-label','删除 '+item.name);remove.append(icon('trash'));
    remove.onclick=()=>update('SCRIPT_DELETE',{},'已删除「'+item.name+'」');
    info.append(name,scope);label.append(info);
    if(item.kind==='preview'){
     remove.textContent='撤销预览';remove.title='撤销预览';remove.setAttribute('aria-label','撤销预览');
     remove.onclick=()=>update('SCRIPT_DISMISS_PREVIEW',{version:item.version,documentKey:item.documentKey},'已撤销预览');
    }else label.append(toggle);
    row.append(label,remove);list.append(row);
   }
  }
 }
 try{draw(await call('SCRIPTS_LIST'));}catch(e){notice.textContent=errorText(e.message);}
}
function renderFilterControls(preview){
 const confirmation=preview.querySelector('[data-filter-confirmation]');
 const proposal=state?.saveConfirmation;
 confirmation.hidden=!proposal;
 confirmation.querySelector('[data-filter-confirmation-text]').textContent=proposal?
  '保存到本地，并自动套用于：'+proposal.scopeLabel+'。'+(proposal.replaces?'将停用 '+proposal.replaces+' 个匹配的旧滤镜，旧记录保留。':''):'';
 const scopeInput=confirmation.querySelector('[data-filter-scope]');
 if(proposal && scopeInput.dataset.token!==proposal.token){scopeInput.value=proposal.scopeUrl||'';scopeInput.dataset.token=proposal.token;}
 const scopeDirty=!!proposal&&scopeInput.value!==proposal.scopeUrl;
 const toggle=preview.querySelector('[data-toggle]');
 toggle.textContent=state.preview?'查看原貌':'查看滤镜';
 toggle.setAttribute('aria-label',state.preview?'查看原貌，保留滤镜供再次预览':'查看滤镜，重新应用当前页预览');
 toggle.setAttribute('aria-pressed',String(state.preview));
 toggle.disabled=!!state.busy;
 const save=preview.querySelector('[data-save]');
 preview.querySelector('[data-similar-save]').hidden=!state.preview||state.saved||state.adjustmentMode==='outline';save.textContent='保存到当前网页';save.disabled=!state.preview||state.saved||state.busy;
 confirmation.querySelector('[data-filter-confirm]').disabled=!!state.busy||scopeDirty;
 preview.querySelector('[data-phase]').textContent=!state.preview?'正在看原貌':state.saved?'已保存 · 自动套用':state.layoutReview?'本页预览 · '+state.layoutReview:'仅本次预览';
}
function explicitFilterSaveReply(question){return !!state?.saveConfirmation&&['确认保存','确认自动套用','确认保存并自动套用','确认保存到本地并自动套用'].includes(String(question||'').trim().replace(/[。！!！]$/u,''));}

function r17ChatNotice(value) {
 const text=String(value||'');
 const last=typeof state==='undefined'?null:state?.turns?.at(-1);
 if(last&&['failed','error'].includes(last.status)&&!last.answer&&text===errorText(last.error||last.status))return '';
 const redundant=new Set(['页面含编辑器、表单或工具画布','已退出调整显示，继续内容问答。','正在调整显示：点选元素，或在下方描述修改。','已在原网页临时预览；继续在这里提出修改，满意后保存。','回答与引用已保存。','正在生成显示指令…','正在阅读所选内容…']);
 if(redundant.has(text)||/^按原文问答处理，保留(?:所选章节|当前原文)与(?:联网开启|按需联网|联网关闭)。$/u.test(text))return '';
 return text.split('；').filter(part=>!redundant.has(part.trim())).join('；');
}

function message(text){for(const f of forms()){const n=f.querySelector('.wfg-ux-status');if(n)n.textContent=r17ChatNotice(text);}}
function errorText(code){const outlineCode=String(code).split(/[;:]/)[0];if(/^OUTLINE_/.test(outlineCode)&&outlineCode!==code)return errorText(outlineCode);const rollback=/^(MODEL_PLAN_INVALID|MODEL_PLAN_UNSUPPORTED|MODEL_PLAN_TARGET_UNREAD|COLOR_SCOPE_LIMIT); rolled back (\d+)$/.exec(String(code||''));if(rollback)return errorText(rollback[1])+' 回退回执：已还原 '+rollback[2]+' 项修改。';return ({READING_BODY_HIDDEN:'本轮修改遮住了正文，已撤回。请缩小要调整的范围。',INTERACTIVE_PAGE:'候选正文范围包含表单或编辑器，未保存。请重新比较或缩小正文范围。',MODULE_MEDIA_CROPPING_DENIED:'自动套用需保留完整图片，请使用高度 auto、max-height none 和 object-fit contain。',GENERALIZE_REPLACE_PREVIEW:'此页已有调整。请先取消本页预览，再沿用样例效果；原样例会保留。',GENERALIZE_SELECTOR_OVERFIT:'候选规则依赖单页编号或固定位置，无法可靠泛化；请补充样例后重新比较。',GENERALIZE_TWO_PAGES_REQUIRED:'套用到相似网页前，请在至少两个不同网页选取对应区域并确认预览，再用 AI 比较验证。',GENERALIZE_SELECT_REQUIRED:'请先选取与当前规则对应的区域并测试预览，确认效果后再加入样例。',GENERALIZE_SAMPLE_CHANGED:'样例页面已变化或预览已失效，请回到该页重新选取、预览并加入样例。',GENERALIZE_EFFECT_MISMATCH:'各样例的调整效果不一致，请使用相同的字号、颜色或隐藏要求，再加入样例。',GENERALIZE_TARGET_MISMATCH:'候选规则在样例中多选或漏选了区域，验证未通过，未保存。',GENERALIZE_SCOPE_UNTESTED:'候选适用范围未被样例覆盖，未保存。',GENERALIZE_STRUCTURE_REQUIRED:'候选规则缺少可靠的正文和页面结构条件，未保存。',GENERALIZE_REPLY_INVALID:'模型返回的泛化规则格式不完整，请重新比较。',GENERALIZE_OPERATION_UNSUPPORTED:'当前样例流程支持顶层网页的样式、隐藏和颜色替换；请每次测试不超过8项调整。',GENERALIZE_SAMPLE_LIMIT:'每组最多6个不同网页样例，请先移除不需要的样例。',GENERALIZE_BUSY:'正在比较或保存样例，请等待完成。',GENERALIZE_START_NEW:'这组规则已保存，请关闭结果后建立新样例集。',GENERALIZE_INSUFFICIENT_EVIDENCE:'样例不足以推导可靠规则，请补充更有代表性的网页和对应区域。',OUTLINE_NONPAPER_REQUIRED:'当前是论文页面；大纲提取调整仅用于非论文网页。',OUTLINE_RELATIVE_SELECTOR:'字段必须使用条目内部的安全选择器。',OUTLINE_NO_MATCHES:'提取规则没有匹配当前已加载条目，未应用大纲。',OUTLINE_FIELD_REQUIRED:'必需字段未在当前条目中找到，请调整字段规则。',OUTLINE_FIELD_AMBIGUOUS:'标题字段匹配了多个位置，请区分当前条目和转发引用。',OUTLINE_FIELD_LIMIT:'单个字段匹配过多，请缩小字段范围。',OUTLINE_OUTPUT_LIMIT:'提取结果超过安全上限，请缩小范围或字段。',OUTLINE_NESTED_ITEMS:'规则同时选中了嵌套条目，请限定独立条目。',OUTLINE_ITEM_LIMIT:'条目超过当前核验上限，请缩小提取范围。',MODEL_PLAN_INVALID:'修改指令不符合安全格式，未应用修改。请简化要求后重试。',MODEL_PLAN_UNSUPPORTED:'当前不支持该修改操作，未应用修改。请改用隐藏、排版或颜色调整等操作。',MODEL_PLAN_TARGET_UNREAD:'修改范围未经当前页面核验，未应用修改。请重新选取目标后重试。',COLOR_SCOPE_LIMIT:'匹配范围过大，未应用修改。请缩小所选范围后重试。',SAVE_SCOPE_INVALID:'请填写当前同站点的网址前缀，须涵盖当前页面且不含查询参数或片段。',SAVE_SCOPE_EXTRACTION:'大纲提取规则只能保存为当前已核验路径。',SAVE_CONFIRMATION_EXPIRED:'当前预览或页面已变化，请重新点击保存并确认适用范围。',PREVIEW_FIRST:'请先点击查看滤镜，再保存当前预览。',READING_ROOT_REQUIRED:'当前页面尚未确认可靠的正文区域，预览已保留，暂不能保存为自动阅读模块。',READING_REPLAY_UNVERIFIED:'当前规则不能在已识别的正文范围重放，暂未保存。',PROTECTED_CONTENT_HIDE:'隐藏规则涉及受保护正文或未确认的区域，预览保留，暂不保存为自动模块。',MODULE_AUTOMATIC_OPERATION_UNSUPPORTED:'此操作可以临时预览，但目前不能保存为自动阅读模块。',MODULE_STYLE_NOT_PORTABLE:'当前样式可以预览，但不能全部保存为自动阅读模块。请改用字号、颜色、换行等阅读排版样式后再保存。',MODULE_WRAPPING_REQUIRED:'自动阅读模块需要保留文字换行。请使用正常换行后再保存，当前预览已保留。',MODULE_POSITIONAL_GROUP_NOT_REUSABLE:'当前规则枚举了固定条目，无法覆盖以后新增的结果。请继续要求按全部同类条目应用，再预览保存。',MODULE_SELECTOR_NOT_PORTABLE:'规则包含本次页面专用标识，暂不能作为自动阅读模块保存。',SOURCE_DOCUMENT_CHANGED:'来源页面已更新，未应用修改。请等待页面稳定后重新选择目标并重试。',SOURCE_TARGET_CHANGED:'所选元素或原文已变化，未应用修改。请重新选择要调整的元素后再试。',SOURCE_EVIDENCE_CHANGED:'已读取的页面内容或结构发生变化，未应用修改。请重新选择目标并重试。',SOURCE_CLOSED_OR_NAVIGATED:'来源页面已关闭或跳转，未应用修改。请回到目标页面后重新选择。',SOURCE_REVALIDATION_LIMIT:'页面持续更新，本次核验已停止，未应用修改。请等待页面稳定或缩小目标范围后重试。',DOCUMENT_CHANGED:'文档已重新加载，未应用修改。请在当前页面重新选择目标。',SELECTION_STALE:'所选元素已过期，未应用修改。请重新选择目标。',MODEL_REQUEST_TIMEOUT:"模型请求超时，未应用修改。",...{"MODEL_AUTH_INVALID":"模型认证失败，请检查原模型配置中的 API Key。","MODEL_AUTH_MISSING":"模型配置缺少 API Key。","MODEL_RATE_LIMITED":"模型服务限流，请稍后重试。","MODEL_PROVIDER_UNAVAILABLE":"模型服务暂时不可用，请稍后重试。","MODEL_NETWORK_ERROR":"模型服务连接失败，请检查网络和原模型服务地址。","MODEL_OUTPUT_TRUNCATED":"模型输出被截断，未应用修改；请缩小本次调整范围后重试。","MODEL_TIMEOUT":"模型请求超时，未应用修改。","MODEL_CANCELLED":"已停止这次请求。","RESEARCH_CANCELLED":"已停止这次请求。","MODEL_INCOMPLETE":"模型响应未完整结束，未应用修改。","MODEL_JSON_INVALID":"模型返回格式错误，自动纠正一次后仍无效；未应用修改。","MODEL_REPLY_INVALID":"模型返回了不支持的响应格式，未应用修改。","MODEL_PROVIDER_ERROR":"模型服务返回未知错误，未应用修改。","MULTI_CONTEXT_BUDGET_EXCEEDED":"所选网页、目标或附件超出当前模型上下文预算。请减少来源或本次调整范围。","MULTI_BUDGET_TOO_SMALL":"当前模型上下文预算不足，尚未发出请求。","MODEL_PLAN_FIELDS":"模型返回了协议以外的字段，修改已拒绝。"},VISION_UNSUPPORTED:'当前模型不支持图片输入。图片未发送，请换用支持视觉的原模型配置。',PREVIEW_NOT_VERIFIED:'目标未匹配或页面已变化，暂不能保存滤镜。请重新选择目标或调整要求后再预览。',PREVIEW_DOCUMENT_CHANGED:'页面已变化，当前预览不能直接保存；请重新提出要求或取消预览。',SELECTION_CANCELLED:'已取消目标选择。',QUESTION_CANCELLED:'已停止这次请求。',ORIGINAL_CONTEXT_COMBINATION_UNSUPPORTED:'本轮包含章节限制或联网设置，暂不能同时处理多网页或显示预览。请移除额外来源和显示目标、取消预览，或调整原章节/联网选项；当前范围没有被扩大。',ORIGINAL_CONTEXT_UNAVAILABLE:'当前页面无法使用原问答上下文，请等待正文载入后重试。'})[code]||({failed:"本次请求未完成；旧记录未保留具体原因。",cancelled:"已停止这次请求。",pending:"请求尚未完成。"})[code]||("未完成："+code);}
async function run(fn){const generation=navigationGeneration;try{const result=await fn();if(generation!==navigationGeneration)return;if(result&&typeof result==='object'&&'sourceIds'in result){if(!state||!sameBinding(binding(state),binding(result)))return;state=result;render();}}catch(e){if(generation!==navigationGeneration)return;const detail=errorText(e.message);if(state)state.notice=detail;message(detail);}}
function toggleDisplayReference(tabId) {
 return run(() => {
  const remove = state.referenceIds.includes(tabId);
  const sources = state.sourceIds.filter(id => id !== tabId);
  const references = state.referenceIds.filter(id => id !== tabId);
  return call('SOURCES', {tabIds: remove ? sources : [...sources, tabId],
   referenceIds: remove ? references : [...references, tabId]});
 });
}
async function switchPage(tabId,pick=false){pendingSelectTab=pick?tabId:null;try{await call('SWITCH_TAB',{tabId});}catch(e){pendingSelectTab=null;throw e;}}
function sourceLabel(id){return tabs.find(t=>t.id===id)?.title||(state?.tabId===id?state.title:'来源 '+id);}
function chip(text,remove,locate){const c=document.createElement('span');c.className='article-chat-attachment-chip';const label=locate?btn(text,locate):document.createElement('span');if(!locate)label.textContent=text;label.classList.add('wfg-chip-label');label.title=text;c.append(label);if(remove){const x=btn('',remove);x.append(icon('x'));x.title='移除来源或目标';x.setAttribute('aria-label','移除 '+text);c.append(x);}return c;}

function appendPlan(answer,plan,turn){
 const colorLabel=op=>{const names={color:'文字颜色','background-color':'背景颜色','border-top-color':'上边框','border-right-color':'右边框','border-bottom-color':'下边框','border-left-color':'左边框','outline-color':'轮廓颜色','text-decoration-color':'文字装饰颜色',fill:'填充颜色',stroke:'描边颜色'};const properties=Array.isArray(op.properties)?op.properties.map(p=>names[p]||p).join('、'):'';const rgba=value=>Array.isArray(value)?'RGBA('+value.join(', ')+')':'';return '（'+properties+'：'+rgba(op.from)+' → '+rgba(op.to)+'）';};
 if(!plan||!Array.isArray(plan.operations))return;
 const box=document.createElement('details');box.className='wfg-ux-plan';box.dataset.filterPlan='';box.open=false;
 const summary=document.createElement('summary');summary.textContent='查看 '+plan.operations.length+' 项修改';box.append(summary);
 const card=document.createElement('section');card.className='wfg-script-card';
 const header=document.createElement('header'),name=document.createElement('strong'),version=document.createElement('small');
 name.textContent=plan.name;const index=state.turns.filter(t=>t.displayPlan||t.displayProposal).indexOf(turn);
 version.textContent='V'+(turn.displayVersion||index+1);
 header.append(icon('code'),name,version);card.append(header);
 if(turn.displayReview){const note=document.createElement('p');note.textContent=turn.displayReview;card.append(note);}
 const annotations=document.createElement('ol');const verbs={pubmedAbstracts:'显示完整摘要',replaceColor:'按颜色替换',hide:'隐藏',show:'显示',collapse:'折叠',sort:'排序',group:'分组',reorder:'重排',outline:'建立大纲',generatedText:'添加独立生成文本',style:'调整样式'};
 for(const op of plan.operations){const line=document.createElement('li');line.textContent=(verbs[op.type]||'网页操作')+'：'+(op.target?.selector||'指定目标')+(op.type==='replaceColor'?colorLabel(op):op.type==='style'?'（'+Object.keys(op.styles||{}).join('、')+'）':'')+(op.type==='outline'&&op.placement==='sidebar'?'，显示在侧栏':'');annotations.append(line);}
 const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=JSON.stringify(plan,null,2);pre.append(code);box.append(annotations,pre);card.append(box);if(turn.status!=='failed')card.append(btn('应用此版本',()=>call('APPLY_VERSION',{turnId:turn.turnId})));answer.append(card);
}
function beginPick(){
 if(!state?.adjusting||picking)return pickTask;
 const seq=++pickSequence;picking=true;render();
 const job=call('PICK').then(async next=>{if(seq===pickSequence&&state?.tabId===next.tabId&&next.adjusting){state=next;render();const d=next.generalization;if(d?.canTransfer&&!d.candidate&&!d.samples.some(s=>s.tabId===next.tabId)&&next.targets.length&&!next.plan){state=await call('GENERALIZE_PREVIEW');render();}}}).catch(e=>{if(seq===pickSequence&&state?.adjusting&&e.message!=='SELECTION_CANCELLED')message(errorText(e.message));}).finally(()=>{if(seq===pickSequence){picking=false;render();}});
 pickTask=job;return job;
}
async function finishPendingPick(){if(!picking)return;const task=pickTask;try{await call('FINISH_PICK');}catch(e){if(e.message!=='请先在网页选择元素')throw e;await call('CANCEL_PICK');}await task;}
const liveProcess=new Map();
function reconcile(log){
 const nodes=[...log.children].filter(n=>n.matches('.article-chat-turn,[data-wfg-turn]'));
 for(const n of nodes)n.hidden=Boolean(state?.adjusting)!==(n.dataset.wfgMode==='adjustment');
 const ordered=nodes.map((node,index)=>({node,index,time:Number(node.dataset.chatCreated)||0})).sort((a,b)=>a.time-b.time||a.index-b.index).map(x=>x.node);
 ordered.forEach((node,index)=>{const current=log.children[index];if(current!==node)log.insertBefore(node,current||null);});
}
globalThis.WFGChatTimeline={reconcile,acceptNativeContext};
function r17ChatTurnMetadata(turn = {}) {
    const text = value => typeof value === 'string' ? value.trim().slice(0,200) : '';
    const actualModel = value => ['configured','simulation'].includes(text(value)) ? '' : text(value);
    const model = actualModel(turn.model) || actualModel(turn.route?.model);
    const profile = text(turn.profileName) || text(turn.route?.effectiveProfileName);
    const labels = [...new Set([profile,model].filter(Boolean))], details = [];
    const coverage = turn.coverage;
    const count = value => Number.isSafeInteger(value) && value >= 0;
    if (Array.isArray(coverage) && coverage.length) {
        const rows = coverage.filter(row => row && count(row.readElements));
        if (rows.length) {
            labels.push('上下文 ' + rows.length + ' 个网页 · ' + rows.reduce((n,row)=>n+row.readElements,0) + ' 个元素');
            details.push(...rows.map(row=>(text(row.title)||'网页')+'：读取 '+row.readElements+' 个元素'+(count(row.omitted)&&row.omitted?'，省略 '+row.omitted:'')).slice(0,6));
        }
    } else if (coverage && count(coverage.sentParagraphs) && count(coverage.totalParagraphs)) {
        labels.push('上下文 ' + coverage.sentParagraphs + '/' + coverage.totalParagraphs + ' 段');
        if (coverage.truncated === true) details.push('按问题选择相关章节，未发送全部正文');
    }
    return {label:labels.join(' · '),title:details.join('；')};
}

function history(form){
 const log=document.getElementById(form.id==='articleChatForm'?'articleChatMessages':'webHistory');if(!log||!state)return;
 const context=JSON.stringify(binding(state));
 if(log.dataset.wfgDocument!==context){for(const old of log.querySelectorAll('[data-wfg-turn]'))old.remove();liveProcess.clear();log.dataset.wfgDocument=context;}
 const ids=new Set((state.turns||[]).map(t=>t.turnId));
 for(const old of log.querySelectorAll('[data-wfg-turn]'))if(!ids.has(old.dataset.wfgTurn)){liveProcess.delete(old.dataset.wfgTurn);old.remove();}
 const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<100;
 let changed=false;
 for(const turn of state.turns||[]){
   const live=liveProcess.get(turn.turnId),signature=JSON.stringify([turn.question,turn.status,turn.answer,turn.error,turn.displayPlan,turn.displayVersion,turn.displayReview,turn.multiSources,turn.coverage,turn.model,turn.profileName,turn.route,live]);
   let card=[...log.querySelectorAll('[data-wfg-turn]')].find(n=>n.dataset.wfgTurn===turn.turnId);
   if(card){card.dataset.wfgMode=turn.interactionMode||((turn.displayPlan||turn.displayProposal)?'adjustment':'chat');}
   if(card?.dataset.signature===signature)continue;
   const folds=new Map([...card?.querySelectorAll('details')||[]].map(n=>[n.className,n.open]));
   const previousStatus=card?.dataset.status;
   if(!card){card=document.createElement('article');card.className='article-chat-turn';card.dataset.wfgTurn=turn.turnId;log.append(card);}
   card.replaceChildren();card.dataset.signature=signature;card.dataset.status=turn.status;card.dataset.chatCreated=String(Number(turn.createdAt)||Date.parse(turn.createdAt)||0);
   const q=document.createElement('div');q.className='article-chat-message is-user article-chat-question';const qc=document.createElement('div');qc.className='article-chat-message-content';qc.textContent=turn.question;qc.setAttribute('translate','no');q.append(qc);
   const a=document.createElement('div');a.className='article-chat-message is-assistant article-chat-answer';
   if(live?.process?.items.length){const panel=document.createElement('details');panel.className='article-chat-process-details';panel.open=turn.status==='pending';const sum=document.createElement('summary');sum.textContent=turn.status==='pending'?'正在处理':'处理过程';panel.append(sum);const entries=document.createElement('div');entries.className='article-chat-process-log';for(const item of live.process.items){const p=document.createElement('div');p.className='article-chat-process-entry';p.dataset.kind=item.kind;p.textContent=item.text;entries.append(p);}panel.append(entries);a.append(panel);}
   const text=document.createElement('div');text.className='article-chat-message-content';text.style.whiteSpace='pre-wrap';
   text.textContent=turn.status==='pending'?(live?.text||'等待模型响应'):(turn.answer||(['complete','completed'].includes(turn.status)?'':errorText(turn.error||turn.status)));a.append(text);appendPlan(a,turn.displayPlan||turn.displayProposal,turn);
   if(turn.status==='pending'&&live?.text){const label=document.createElement('small');label.className='article-chat-draft-label';label.textContent='正在生成 · 待核验';a.insertBefore(label,text);}
   for(const ref of turn.multiSources||[]){const b=btn('['+ref.citation+'] '+ref.title+' · '+String(ref.quote||'').slice(0,100),()=>call('LOCATE',{turnId:turn.turnId,citation:ref.citation}));b.className='article-chat-inline-citation';a.append(b);}
   if(turn.coverage?.length){const coverage=document.createElement('details');coverage.className='article-chat-source-details';const title=document.createElement('summary');title.textContent='来源 · '+turn.coverage.length;coverage.append(title);const body=document.createElement('div');body.textContent=turn.coverage.map(c=>c.title+'：读取 '+c.readElements+' 个元素'+(c.omitted?'，省略 '+c.omitted:'')).join('；');coverage.append(body);a.append(coverage);}
   const metadata=r17ChatTurnMetadata(turn);
   if(metadata.label){const footer=document.createElement('footer');footer.className='article-chat-turn-footer';const meta=document.createElement('span');meta.className='article-chat-message-meta';meta.textContent=metadata.label;meta.title=metadata.title;footer.append(meta);a.append(footer);}
   card.dataset.wfgMode=turn.interactionMode||((turn.displayPlan||turn.displayProposal)?'adjustment':'chat');
   card.append(q,a);[...card.querySelectorAll('details')].forEach(n=>{if(folds.has(n.className)&&!(n.className==='article-chat-process-details'&&previousStatus==='pending'&&turn.status!=='pending'))n.open=folds.get(n.className);});
   log.querySelector('.workspace-empty')?.remove();changed=true;
 }
 reconcile(log);if(changed&&nearBottom)requestAnimationFrame(()=>{log.scrollTop=log.scrollHeight;});
}
function render(){if(!state)return;if(!state.adjusting&&picking){picking=false;pickSequence++;}clearTimeout(outlineTimer);outlineTimer=setTimeout(()=>void refreshOutline().catch(()=>{}),60);for(const f of forms()){const u=f.querySelector('[data-wfg-ux]');if(!u)continue;const chips=u.querySelector('.wfg-ux-chips');chips.replaceChildren();for(const id of state.sourceIds){const c=chip(id===state.tabId?'当前页 · '+sourceLabel(id):state.referenceIds.includes(id)?'参考 · '+sourceLabel(id):sourceLabel(id),id===state.tabId?null:()=>call('SOURCES',{tabIds:state.sourceIds.filter(x=>x!==id),referenceIds:state.referenceIds.filter(x=>x!==id)}));if(id===state.tabId)c.dataset.current='';chips.append(c);}for(const [targetIndex,target] of state.targets.entries()){const text=(targetIndex+1)+' · '+target.sourceTitle+' · '+(target.attributes?.alt||target.displayText||target.text||target.tag).slice(0,55);const c=chip(text,()=>call('TARGETS',{targets:state.targets.filter(t=>t.id!==target.id)}),()=>call('LOCATE_TARGET',{id:target.id}));const l=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!!target.sameKind;check.onchange=()=>run(()=>call('TARGETS',{targets:state.targets.map(t=>t.id===target.id?{...t,sameKind:check.checked}:t)}));l.append(check,'作用同类');c.append(l);chips.append(c);}
const outlining=!!state.adjusting&&state.adjustmentMode==='outline';u.querySelector('[data-outline-mode]')?.setAttribute('aria-pressed',String(outlining));u.querySelector('[data-outline-reset]').hidden=!outlining;const outlineUndo=u.querySelector('[data-outline-undo]');outlineUndo.hidden=!outlining||!!state.plan||!state.canUndo;outlineUndo.disabled=state.busy;const active=!!state.adjusting;const pick=u.querySelector('[data-pick]');pick.setAttribute('aria-pressed',String(active));pick.title=active?'正在调整显示；点击退出并回到内容问答':'调整整页显示，或选择具体元素';pick.disabled=modeBusy;pick.hidden=typeof activePanelTabContext!=='undefined'&&!!activePanelTabContext?.pdfMode;u.querySelector('[data-exit-display]').hidden=!state.adjusting;input(f).placeholder=active?(outlining?'描述你想要的大纲…':'描述调整，或输入 / 选指令、@ 选元素、@@ 换网页'):defaultQuestionHint();const preview=u.querySelector('.wfg-ux-preview');preview.hidden=!state.plan;preview.querySelector('[data-heading]').textContent=outlining?(state.saved?'已保存大纲规则':'大纲预览'):state.saved?'已保存滤镜':'显示预览';preview.querySelector('[data-phase]').textContent=state.saved?'自动套用':state.preview?'尚未保存':'正在看原貌';preview.querySelector('[data-info]').textContent=(state.saved?'适用范围：':'保存后用于：')+(state.saved?state.scopeLabel:state.saveScopeLabel);preview.querySelector('[data-toggle]').textContent=state.preview?'看原貌':'看预览';preview.querySelector('[data-save]').disabled=!state.preview||state.saved||state.busy;preview.querySelector('[data-save]').hidden=state.saved||!!state.generalization;preview.querySelector('[data-save]').textContent='仅保存本页';preview.querySelector('[data-info]').hidden=!!state.generalization;preview.querySelector('[data-toggle]').setAttribute('aria-pressed',String(!state.preview));preview.querySelector('[data-undo]').disabled=!state.canUndo||state.busy;preview.querySelector('[data-disable]').hidden=!state.saved;preview.querySelector('[data-cancel]').hidden=state.saved;renderFilterControls(preview);renderGeneralization(u);u.querySelector('[data-stop]').hidden=!state.busy&&!picking;u.querySelector('[data-stop]').textContent=picking?'取消选择':'停止';const send=f.querySelector('[type=submit]');if(send&&!(typeof articleChatSubmitPending!=='undefined'&&articleChatSubmitPending))send.disabled=state.busy||busy||modeBusy;if(send){send.classList.toggle('wfg-send-running',!!state.busy||busy);send.setAttribute('aria-busy',String(!!state.busy||busy));}u.querySelector('.wfg-ux-status').textContent=state.busy?'':r17ChatNotice(/^(OUTLINE_|MODEL_|RESEARCH_|MULTI_|SOURCE_|PREVIEW_|COLOR_|DOCUMENT_CHANGED|SELECTION_STALE)/.test(state.notice||'')?errorText(state.notice):state.notice);globalThis.WFGComposer?.render(f,state);globalThis.WFGWorkflow?.render(f,state,picking);history(f);if(!u.querySelector(".wfg-ux-sources").hidden)list(f);}}
function list(form){
const box=form.querySelector('.wfg-ux-sources'),search=box.querySelector('input[type=search]'),rows=box.querySelector('[data-rows]');rows.replaceChildren();
for(const t of tabs.filter(t=>(t.title+' '+t.url).toLowerCase().includes(search.value.toLowerCase()))){
const row=document.createElement('div');row.className='wfg-ux-source-row';
const l=document.createElement('label'),c=document.createElement('input'),name=document.createElement('span');name.className='wfg-ux-source-title';name.textContent=t.title+(t.id===state?.tabId?'（当前页）':'');name.title=t.title+'\n'+t.url;
c.type='checkbox';c.dataset.sourceId=t.id;c.checked=state?.sourceIds.includes(t.id);c.disabled=t.id===state?.tabId;
c.onchange=()=>run(()=>call('SOURCES',{tabIds:c.checked?[...state.sourceIds,t.id]:state.sourceIds.filter(id=>id!==t.id),referenceIds:state.referenceIds}));l.append(c,name);row.append(l);
if(t.id!==state?.tabId&&state?.adjusting){const ref=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=state?.referenceIds.includes(t.id);check.title='将此网页作为风格参考';check.onchange=()=>run(()=>call('SOURCES',{tabIds:state.sourceIds.includes(t.id)?state.sourceIds:[...state.sourceIds,t.id],referenceIds:check.checked?[...state.referenceIds,t.id]:state.referenceIds.filter(id=>id!==t.id)}));ref.append(check,'参考风格');row.append(ref);}
rows.append(row);}
if(!rows.childElementCount){const empty=document.createElement('p');empty.className='wfg-ux-empty';empty.textContent='未找到匹配的网页';rows.append(empty);}
}
function createGeneralization(){
 const box=document.createElement('details');box.dataset.generalization='';box.className='wfg-generalization';box.setAttribute('aria-label','相似网页套用');
 const title=document.createElement('summary');title.textContent='套用到相似网页';
 const help=document.createElement('p');help.dataset.generalizationHelp='';help.textContent='先确认本页效果，再补充另一篇论文。两页都通过测试后，AI 才会生成适用范围。';
 const list=document.createElement('ul');list.dataset.generalizationSamples='';
 const add=btn('效果正确，选另一篇验证',async()=>{const next=await call('GENERALIZE_ADD');state=next;render();const valid=next.generalization?.samples.filter(s=>!s.stale).length||0;if(valid>=2)return call('GENERALIZE_GENERATE',{profileId:document.getElementById('articleChatProfile')?.value||''});globalThis.WFGWorkflow.openPageCommands(box.closest('form'));return next;});add.dataset.generalizationAdd='';
 const next=btn('选择另一网页测试',async()=>{const form=box.closest('form');globalThis.WFGWorkflow.openPageCommands(form);});next.dataset.generalizationNext='';
 const transfer=btn('沿用样例效果并预览',()=>call('GENERALIZE_PREVIEW'));transfer.dataset.generalizationTransfer='';
 const reuse=btn('沿用原要求',()=>{const i=input(box.closest('form'));i.value=state?.generalization?.request||'';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();});reuse.dataset.generalizationReuse='';
 const generate=btn('AI 比较并验证',()=>call('GENERALIZE_GENERATE',{profileId:document.getElementById('articleChatProfile')?.value||''}));generate.dataset.generalizationGenerate='';
 const result=document.createElement('div');result.dataset.generalizationResult='';result.setAttribute('aria-live','polite');
 const save=btn('确认范围并保存滤镜',()=>call('GENERALIZE_SAVE',{token:state?.generalization?.candidate?.token}));save.dataset.generalizationSave='';
 const cancel=btn('结束这组验证',()=>call('GENERALIZE_CANCEL'));cancel.dataset.generalizationCancel='';
 box.append(title,help,list,add,next,transfer,reuse,generate,result,save,cancel);return box;
}
function renderGeneralization(u){
 const box=u.querySelector('[data-generalization]'),d=state.generalization;
 box.hidden=!d&&(!state.plan||state.saved||state.adjustmentMode==='outline');
 if(state.plan&&!d)box.open=true;if(d&&box.dataset.draft!==d.id){box.open=true;box.dataset.draft=d.id;}
 const blocked=!!d?.busy||state.busy||picking;
 const current=d?.samples.find(s=>s.tabId===state.tabId),valid=d?.samples.filter(s=>!s.stale).length||0;
 box.querySelector('summary').textContent=d?.saved?'相似网页滤镜已保存':d?'跨页验证 · '+valid+' 个网页已确认':'套用到相似网页';
 box.dataset.phase=d?.saved?'saved':d?.candidate?'save':d?.busy?'generating':valid>=2?'ready':current?'choose':'confirm';
 box.querySelector('[data-generalization-help]').textContent=d?.saved?'以后打开适用范围内且结构匹配的论文，会自动套用。':d?.candidate?'两页验证已通过。在这里保存即可，无需返回第一篇。':d?.busy?'正在对比网页结构并逐页测试…':!valid?'本页效果满意后，再选一篇类似论文验证，即可自动套用到同类网页。':valid===1&&d.wholePage?(current?'选另一篇同站点论文，验证整页效果。':state.preview?'检查正文、图表和引用，满意后确认。':'预览同一组调整，检查这篇论文上的效果。'):valid===1?(current?'第 1 页已确认。下一步：选另一篇论文的对应区域。':state.preview?'第 2 页已预览相同效果。确认后直接生成通用滤镜，无需返回第一篇。':'第 2 页：选取相同区域，完成选取后会自动预览。无需返回第一篇。'):'样例已确认，可在当前页生成并保存通用滤镜。';
 const add=box.querySelector('[data-generalization-add]');add.hidden=!!d?.saved||!!d?.candidate||!!current&&!current.stale||!!d&&!state.plan;add.disabled=blocked||!state.preview||!state.plan||!state.sampleReady;add.textContent=current?.stale?'重新确认并验证':valid?'效果正确，生成通用滤镜':'效果正确，选另一篇验证';add.classList.add('wfg-flow-primary');
 const next=box.querySelector('[data-generalization-next]');next.hidden=!d||!!d.saved||!!d.candidate||!current;next.textContent=valid>=2?'再添加一篇（可选）':'选择第二篇论文';next.disabled=blocked;
 const canPreviewSample=!state.plan||!!(d?.wholePage&&state.saved&&state.automaticModuleView);
 const transfer=box.querySelector('[data-generalization-transfer]');transfer.hidden=!d?.canTransfer||!!current||!canPreviewSample;transfer.textContent=d?.wholePage?'预览本页整页效果':'沿用样例效果并预览';transfer.disabled=blocked||(!d?.wholePage&&!state.targets.length)||!canPreviewSample;transfer.title=d?.wholePage?'在这篇论文上核验对应区域，预览整页调整':state.plan?'先取消本页旧预览，再沿用样例效果':'将样例的相同字号、样式或隐藏效果用于当前所选区域';
 const reuse=box.querySelector('[data-generalization-reuse]');reuse.hidden=!d?.request||!!d.saved||!!current||(d.canTransfer&&!(d.wholePage&&canPreviewSample));reuse.disabled=blocked;
 const list=box.querySelector('[data-generalization-samples]');list.replaceChildren();
 for(const sample of d?.samples||[]){const li=document.createElement('li'),label=btn(sample.title,()=>switchPage(sample.tabId,false));label.title=sample.url;label.disabled=blocked||sample.tabId===state.tabId;const status=document.createElement('small');status.textContent=sample.stale?'已变化 · 请重测':sample.count+' 处已确认';status.dataset.stale=String(sample.stale);li.append(label,status);if(!d.saved){const remove=btn('移除',()=>call('GENERALIZE_REMOVE',{tabId:sample.tabId}));remove.setAttribute('aria-label','移除样例 '+sample.title);remove.disabled=blocked;li.append(remove);}list.append(li);}
 const generate=box.querySelector('[data-generalization-generate]');generate.hidden=!!d?.saved||!d||!!d.candidate||valid<2;generate.disabled=blocked||valid<2||d.samples.some(s=>s.stale);generate.textContent=d?.busy?'正在逐页核验…':'比较并验证';
 const result=box.querySelector('[data-generalization-result]');const signature=JSON.stringify([d?.error,d?.candidate,d?.saved]);
 if(result.dataset.signature!==signature){result.dataset.signature=signature;result.replaceChildren();const line=text=>{const p=document.createElement('p');p.textContent=text;result.append(p);};
 if(d?.error)line(errorText(d.error));
 if(d?.candidate){line((d.saved?'已保存，自动套用于：':'候选适用范围：')+d.candidate.scopeLabel);const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='查看适用范围与逐页验证';details.append(summary);const p=document.createElement('p');p.textContent='共同点：'+d.candidate.common+'\n差异：'+d.candidate.differences+'\n范围依据：'+d.candidate.scopeReason;p.style.whiteSpace='pre-wrap';details.append(p);for(const check of d.candidate.checks){const p=document.createElement('p');p.textContent='验证通过 · '+check.title+' · '+check.matches.join(' / ')+' 处命中';details.append(p);}result.append(details);if(d.candidate.replaces&&!d.saved)line('保存将停用 '+d.candidate.replaces+' 个覆盖样例页的旧规则，旧记录保留。');}}
 const save=box.querySelector('[data-generalization-save]');save.classList.add('wfg-flow-primary');save.hidden=!d?.candidate||!!d.saved;save.disabled=blocked;
 const cancel=box.querySelector('[data-generalization-cancel]');cancel.hidden=!d;cancel.disabled=!!d?.busy;cancel.textContent=d?.saved?'关闭验证结果':'结束这组验证';
}
function mount(form){if(mounted.has(form))return;mounted.add(form);const u=document.createElement('div');u.dataset.wfgUx='';const tools=document.createElement('div');tools.className='wfg-ux-tools';const sources=btn('添加网页',async()=>{tabs=await call('LIST');box.hidden=!box.hidden;list(form);if(!box.hidden)search.focus();});sources.dataset.addSources='';labelButton(sources,'添加网页','file-magnifying-glass');const pick=btn('调整显示',()=>{},'描述整页效果，也可以点选局部调整');pick.dataset.pick='';pick.setAttribute('aria-label','网页滤镜');pick.setAttribute('aria-pressed','false');labelButton(pick,'调整显示','sliders-horizontal');pick.onclick=()=>{if(modeBusy)return;modeBusy=true;render();void run(async()=>{const next=await call('MODE',{active:!state?.adjusting,mode:'display'});state=next;render();return next;}).finally(()=>{modeBusy=false;render();});};
const outlineMode=btn('调整大纲',()=>call('MODE',{active:!(state?.adjusting&&state.adjustmentMode==='outline'),mode:'outline'}),'提取非论文网页的条目、字段与层级');outlineMode.dataset.outlineMode='';labelButton(outlineMode,'调整大纲','list-tree');
const outlineReset=btn('恢复默认大纲',()=>call('RESET_OUTLINE'));outlineReset.dataset.outlineReset='';outlineReset.hidden=true;
const outlineUndo=btn('撤销大纲调整',()=>call('UNDO'));outlineUndo.dataset.outlineUndo='';outlineUndo.hidden=true;
const exitDisplay=btn('退出',()=>call('MODE',{active:false}),'返回普通问答，取消未保存的预览和元素选择');exitDisplay.dataset.exitDisplay='';exitDisplay.hidden=true;
const stop=btn('停止',()=>call(picking?'CANCEL_PICK':'CANCEL'));stop.dataset.stop='';stop.hidden=true;tools.append(sources,pick,outlineReset,outlineUndo,exitDisplay,stop);const chips=document.createElement('div');chips.className='wfg-ux-chips';const box=document.createElement('div');box.className='wfg-ux-sources';box.hidden=true;const search=document.createElement('input');search.type='search';search.placeholder='按网页标题搜索';search.setAttribute('aria-label','搜索已打开网页');search.oninput=()=>list(form);const rows=document.createElement('div');rows.dataset.rows='';const searchWrap=document.createElement('label');searchWrap.className='wfg-ux-search';searchWrap.append(icon('magnifying-glass'),search);const sourceHead=document.createElement('div');sourceHead.className='wfg-ux-source-head';sourceHead.append('选择要一起阅读的网页',btn('收起',()=>{box.hidden=true;}));box.append(sourceHead,searchWrap,rows);const preview=document.createElement('div');preview.className='wfg-ux-preview';preview.hidden=true;const head=document.createElement('div');head.className='wfg-ux-preview-head';const heading=document.createElement('strong');heading.dataset.heading='';const phase=document.createElement('small');phase.dataset.phase='';head.append(heading,phase);const info=document.createElement('p');info.className='wfg-ux-scope';info.dataset.info='';const primary=document.createElement('div');primary.className='wfg-ux-primary-actions';const secondary=document.createElement('div');secondary.className='wfg-ux-secondary-actions';preview.append(head,info,primary,secondary);const share=btn('分享滤镜',async()=>{const data=await call('EXPORT'),url=URL.createObjectURL(new Blob([data.raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Brevess-filter-'+data.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);message('已导出滤镜 JSON；通过原附件按钮导入，预览后保存。');});share.dataset.share='';labelButton(share,'分享','export');share.title='导出滤镜 JSON';secondary.append(share);for(const [text,key,command]of [['查看原貌','toggle','TOGGLE'],['撤销一步','undo','UNDO'],['取消预览','cancel','CANCEL'],['保存并自动套用','save','PREPARE_SAVE'],['停用滤镜','disable','DISABLE']]){const b=btn(text,()=>call(command));b.dataset[key]='';if(key==='save'){labelButton(b,text,'floppy-disk');primary.prepend(b);}else if(key==='toggle')primary.append(b);else {if(key==='undo')labelButton(b,text,'arrow-counter-clockwise');secondary.append(b);}}const confirmation=document.createElement('div');confirmation.dataset.filterConfirmation='';confirmation.className='wfg-filter-confirmation';confirmation.hidden=true;confirmation.setAttribute('role','group');confirmation.setAttribute('aria-label','确认保存滤镜');
const confirmationText=document.createElement('p');confirmationText.dataset.filterConfirmationText='';
const confirmSave=btn('确认保存',()=>call('SAVE',{confirmationToken:state?.saveConfirmation?.token}));confirmSave.dataset.filterConfirm='';
const declineSave=btn('仅本次预览',()=>call('CANCEL_SAVE'));declineSave.dataset.filterDecline='';
const scopeLabel=document.createElement('label');scopeLabel.textContent='适用网址';const scopeInput=document.createElement('input');scopeInput.type='url';scopeInput.readOnly=true;scopeInput.dataset.filterScope='';scopeInput.setAttribute('aria-label','适用网址前缀');scopeInput.oninput=()=>{confirmSave.disabled=scopeInput.value!==state?.saveConfirmation?.scopeUrl;};scopeLabel.append(scopeInput);const checkScope=btn('检查范围',()=>call('PREPARE_SAVE',{scopeUrl:scopeInput.value}));checkScope.dataset.filterScopeCheck='';checkScope.hidden=true;const similar=btn('套用到同类网页',()=>call('PREPARE_SAVE',{similar:true}));similar.dataset.similarSave='';
 primary.append(similar);confirmation.append(scopeLabel,checkScope,confirmationText,confirmSave,declineSave);preview.append(confirmation);
const status=document.createElement('p');status.className='wfg-ux-status';status.setAttribute('role','status');u.append(chips,tools,box,preview,createGeneralization(),status);form.prepend(u);globalThis.WFGComposer?.mount(form);globalThis.WFGWorkflow?.mount(form,u,{button:btn,input:()=>input(form),scripts:showSavedScripts,toggleReference:toggleDisplayReference,tabs:()=>tabs,refreshTabs:async()=>{tabs=await call('LIST');},pick:()=>run(()=>picking?call('FINISH_PICK'):beginPick()),switch:(id,pick)=>run(()=>switchPage(id,pick))});

let composing=false,justComposed=false;
input(form).addEventListener('compositionstart',()=>{composing=true;});
input(form).addEventListener('compositionend',()=>{composing=false;justComposed=true;setTimeout(()=>justComposed=false,0);});
form.addEventListener('keydown',event=>{if(event.target!==input(form)||event.key!=='Enter')return;if(composing||justComposed||event.isComposing||event.keyCode===229){event.stopImmediatePropagation();return;}if(event.shiftKey){event.stopImmediatePropagation();return;}const menu=document.getElementById('articleChatCommandMenu');if(menu&&!menu.hidden&&menu.getBoundingClientRect().height>0)return;if(!WFGUXContext.shouldSubmit(event))return;event.preventDefault();event.stopImmediatePropagation();if(!busy&&!state?.busy)form.requestSubmit();},true);

form.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();if(form.id==='articleChatForm'&&typeof activePanelTabContext!=='undefined'&&savedNativeContext(activePanelTabContext,currentWorkspaceSnapshot)){void (document.getElementById('sendArticleChat')?.dataset.mode==='cancel'?cancelArticleChat():submitArticleChat());return;}if(form.id==='articleChatForm'&&document.getElementById('sendArticleChat')?.dataset.mode==='cancel'){void run(()=>cancelArticleChat());return;}const text=input(form).value.trim();if(!text||busy||modeBusy)return;form.querySelector('.wfg-ux-sources').hidden=true;const submissionGeneration=navigationGeneration;busy=true;render();const attachments=form.id==='articleChatForm'&&typeof articleChatAttachments!=='undefined'?articleChatAttachments:[];void run(async()=>{try{if(state?.adjusting&&state.adjustmentMode!=='outline')await finishPendingPick();const contextScope=!globalThis.WFGWorkflow?.isDisplay(form)&&form.id==='articleChatForm'&&typeof articleChatContextScopePayload==='function'?articleChatContextScopePayload():{};const webSearch={mode:form.id==='articleChatForm'&&typeof articleChatWebSearchMode!=='undefined'?articleChatWebSearchMode:'off'};const route=explicitFilterSaveReply(text)?{kind:'display',webSearch:{mode:'off',enabled:false}}:WFGUXContext.route({contextScope,webSearch,...state,question:text});if(route.kind==='original'){if(form.id!=='articleChatForm'||typeof submitArticleChat!=='function'||typeof activePanelTabContext==='undefined'||activePanelTabContext.tabId!==state?.tabId)throw Error('ORIGINAL_CONTEXT_UNAVAILABLE');message('');await submitArticleChat();return null;}input(form).value='';input(form).dispatchEvent(new Event('input',{bubbles:true}));const result=await call('RUN',{question:text,attachments,contextScope,webSearch:route.webSearch,profileId:document.getElementById('articleChatProfile')?.value||''});if(form.id==='articleChatForm'&&typeof articleChatAttachments!=='undefined'&&articleChatAttachments===attachments){articleChatAttachments=[];if(typeof renderArticleChatAttachmentChips==='function')renderArticleChatAttachmentChips();}return result;}finally{if(submissionGeneration===navigationGeneration){busy=false;render();}}});},true);
form.addEventListener('change',event=>{const fileInput=event.target;if(fileInput.id!=='articleChatAttachmentFiles'||![...fileInput.files].some(f=>/\.json$/i.test(f.name)))return;event.stopImmediatePropagation();const files=[...fileInput.files];fileInput.value='';void run(async()=>{const other=[];for(const file of files){if(/\.json$/i.test(file.name)&&file.size<=64000){const raw=await file.text();let value;try{value=JSON.parse(raw);}catch{}if(value?.format==='brevess.reading-module'){state=await call('IMPORT_MODULE',{raw});render();continue;}if(value?.schemaVersion===2&&Array.isArray(value.operations)){state=await call('IMPORT',{raw});render();continue;}}other.push(file);}if(other.length&&typeof addArticleChatAttachmentFiles==='function')await addArticleChatAttachmentFiles(other);});},true);
const scope=form.querySelector('#webScope');if(scope){scope.hidden=true;form.querySelector('label[for=webScope]')?.setAttribute('hidden','');form.querySelector('#webScopeInfo')?.setAttribute('hidden','');}
}
async function refresh(){
 const sequence=++refreshSequence,generation=navigationGeneration;
 const current=()=>sequence===refreshSequence&&generation===navigationGeneration;
 try{
  for(const f of forms())mount(f);if(!forms().length)return;
  const windowId=(await chrome.windows.getCurrent()).id;if(!current())return;contextWindowId=windowId;
  const [target]=await chrome.tabs.query({active:true,windowId});if(!current())return;
  contextTarget=target?{tabId:target.id,navigationUrl:target.url||target.pendingUrl||''}:null;
  const saved=globalThis.SciLLM?.parseOfflineArticleReaderUrl?.(contextTarget?.navigationUrl,chrome.runtime.getURL(''));
  if(saved||trustedPdfReader(contextTarget?.navigationUrl)){
    state=null;contextPending=false;message('');
    for(const f of forms()){
      for(const n of f.querySelectorAll('[data-filter-workflow],.wfg-ux-preview,.wfg-ux-sources,[data-generalization],[data-add-sources]'))n.hidden=true;
      const u=f.querySelector('[data-wfg-ux]');if(u)u.dataset.filterEditing='false';
      globalThis.WFGComposer?.render(f,{adjusting:false,sourceIds:[]});
    }
    syncPdfDisplayControls();restoreNativeTimeline();return;
  }
  for(const f of forms())for(const n of f.querySelectorAll('[data-add-sources]'))n.hidden=false;
  const next=await call('STATE');if(!current())return;
  const [liveTarget]=await chrome.tabs.query({active:true,windowId});if(!current())return;
  if(!target||!liveTarget||next.tabId!==liveTarget.id||(next.navigationUrl||next.url)!==(liveTarget.url||liveTarget.pendingUrl)||liveTarget.id!==target.id)throw Error('PAGE_CHANGED');
  if(state&&!sameBinding(binding(state),binding(next)))clearTimeline();
  state=next;contextPending=false;render();if(state.adjusting&&focusedFilterKey!==state.documentKey){focusedFilterKey=state.documentKey;if(typeof switchWorkspaceView==='function')switchWorkspaceView('chat',{persist:false});}restoreNativeTimeline();if(pendingSelectTab===state.tabId){pendingSelectTab=null;if(state.generalization?.wholePage){if(!state.plan||(state.saved&&state.automaticModuleView))void call('GENERALIZE_PREVIEW').then(next=>{if(state?.tabId===next.tabId){state=next;render();}}).catch(e=>message(errorText(e.message)));}else void beginPick();}
  const listResult=await call('LIST');if(!current())return;tabs=listResult;render();
  if(!state.turns.length){const historyResult=await call('HISTORY');if(!current()||!sameBinding(binding(state),binding(historyResult)))return;state=historyResult;render();}
 }catch(e){if(!current())return;if(e.message==='PAGE_CHANGED'){invalidateContext();queueMicrotask(()=>void refresh());}else{contextPending=false;message('当前页面尚未就绪：'+e.message);restoreNativeTimeline();}}
}
chrome.runtime.onMessage.addListener((m,s)=>{
 if(m?.type==='WFG_UX_PROGRESS'&&s.id===chrome.runtime.id&&!contextPending&&sameBinding(binding(state),binding(m))&&state.busy){
   const turn=state.turns.find(t=>t.turnId===m.turnId);if(!turn||turn.status!=='pending')return;
   const prior=liveProcess.get(m.turnId)||{items:[],text:'',sequence:0};const event=m.event||{};
   if(event.type==='answer_preview')prior.text=String(event.text||'').slice(0,32768);
   else {const normalized=globalThis.SciLLM?.normalizeArticleChatProcess?.(event);
     if(normalized){const next=globalThis.SciLLM.reduceArticleChatProcess(prior.process,{...normalized,sequence:++prior.sequence},m.turnId);prior.process=next;}}
   liveProcess.set(m.turnId,prior);while(liveProcess.size>40)liveProcess.delete(liveProcess.keys().next().value);
   for(const form of forms())history(form);return;
 }
 if(m?.type==='WFG_UX_STATE'&&s.id===chrome.runtime.id&&!contextPending&&sameBinding(binding(state),binding(m.state))){state=m.state;render();}});
function syncPdfDisplayControls(){const pdf=typeof activePanelTabContext!=='undefined'&&!!(activePanelTabContext?.pdfMode||activePanelTabContext?.offlineMode);for(const n of document.querySelectorAll('[data-pick],[data-exit-display]')){if(pdf)n.hidden=true;else if(n.hasAttribute('data-pick'))n.hidden=!!state?.adjusting&&state.adjustmentMode!=='outline';}}
const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;syncPdfDisplayControls();for(const f of forms())if(!mounted.has(f))void refresh();if(state)for(const f of forms())history(f);},100);});observer.observe(document.documentElement,{childList:true,subtree:true});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh);else void refresh();
function observeActiveTab(tabId,windowId){
 if(contextWindowId!==null&&windowId!==contextWindowId||contextTarget?.tabId===tabId)return;
 contextTarget={tabId,navigationUrl:''};invalidateContext();void refresh();
}
chrome.tabs.onActivated.addListener(({tabId,windowId})=>observeActiveTab(tabId,windowId));chrome.tabs.onUpdated.addListener((id,c)=>{if(id===(state?.tabId??contextTarget?.tabId)&&(c.status==='loading'||c.url)){invalidateContext();void refresh();}else if(id===(state?.tabId??contextTarget?.tabId)&&c.status==='complete')void refresh();});
globalThis.BrevessUnifiedComposer={observeActiveTab,showSavedScripts,isEditing:()=>!!state?.adjusting||pendingSelectTab!==null,setFilterOriginal:async original=>{if(state?.plan&&state.preview===original)await call('TOGGLE');},inspectFilter:async()=>{const exported=await call('EXPORT');const exportedValue=JSON.parse(exported.raw),value=exportedValue.module||exportedValue,u=new URL(state.navigationUrl);return {raw:exported.raw,scope:value.scope?value.scope.origin+value.scope.path:u.origin+(value.match?.pathPrefixes?.[0]||u.pathname),basePlan:JSON.stringify(state.plan||null)};},saveFilter:async data=>{const next=await call('EDIT_FILTER',data);state=next;render();return next;},refresh,mount,getOutline:refreshOutline,get outline(){return outline;},locateOutline:ref=>call('LOCATE_OUTLINE',{ref}),version:2};
})();
