(function(g,factory){const api=factory(g);if(typeof module==='object')module.exports=api;g.WFGComposer=api;})(globalThis,function(g){
'use strict';
const LEVEL_LABELS={auto:'自动',minimal:'最少',low:'低',medium:'中',high:'高',xhigh:'更高',max:'最高',ultra:'极高',enabled:'开启'};
function reasoningState(settings,selectedProfileId,api){
 const policy=settings?.taskPolicies?.article_chat||{},profileId=selectedProfileId||(policy.mode==='profile'?policy.profileId:settings?.globalProfileId),profile=settings?.profiles?.[profileId];
 if(!profile||typeof api?.getProviderReasoningCapabilities!=='function')return {supported:false,label:'思考',reason:'请先配置支持思考的模型',options:[],profileId:profileId||''};
 const config={...profile.config};config.model=api.taskModelForProfile?.(policy,profile,profileId)||config.model;
 const capability=api.getProviderReasoningCapabilities(profile.providerId,config);
 if(capability?.supported!==true)return {supported:false,label:'思考',reason:'当前模型不支持调节思考',options:[],profileId};
 const normalized=api.normalizeReasoningForProvider(profile.providerId,config,{enabled:policy.reasoningEnabled===true,effort:policy.reasoningEffort||'auto'});
 const canDisable=api.reasoningCanDisable?.(profile.providerId,config,capability)===true;
 const levels=capability.mode==='toggle'?['enabled']:(capability.levels||[]).filter(x=>!['none','disabled','off'].includes(x));
 const options=[...(canDisable?[{value:'off',label:'关闭',enabled:false,effort:'auto'}]:[]),...levels.map(level=>({value:level,label:LEVEL_LABELS[level]||level,enabled:true,effort:level}))];
 const value=normalized.enabled?normalized.effort:canDisable?'off':(levels.includes('auto')?'auto':capability.defaultLevel),label=normalized.enabled?'思考 · '+(LEVEL_LABELS[normalized.effort]||normalized.effort):'思考';
 return {supported:true,label,options,value,profileId,providerId:profile.providerId,config,normalized,canDisable};
}
const views=new WeakMap(),activeViews=new Set();let wrapped=false,nativeNetworkSync=null;
function icon(name){
 const paths={
  brain:'M6.6 15.5c-2.5.3-4.2-1.1-4.2-3.4 0-2 1-3.6 2.5-4.3.8-2.1 2.9-3.2 5-2.9 2-1.4 4.7-1.1 6.4.3 3.3.4 5.4 3.2 5.4 6.2 0 2.4-1.2 4.1-3.2 4.8l.7 3.3h-2.6l-1.8-3.9c-1.6.2-2.9 1.3-4.7 1.3-1.5 0-2.7-.5-3.5-1.4Z M6.6 13c.7-2 2.4-3 4.4-3 .3-1.4 1-2.3 2.2-3 M13 13.4c2.3-1.6 4.6-1.9 6.4-1.5',
  globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z'
 };
 if(paths[name]){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');path.setAttribute('d',paths[name]);svg.append(path);return svg;}
 const i=document.createElement('i');i.className='ph ph-'+name;i.setAttribute('aria-hidden','true');return i;}
function control(text,name){const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';if(name)b.append(icon(name));const span=document.createElement('span');span.textContent=text;b.append(span);return b;}
function node(tag,cls){const n=document.createElement(tag);n.className=cls;return n;}
function settings(){return typeof llmSettingsState!=='undefined'?llmSettingsState?.settings:null;}
function announce(v,message){const status=v.form.querySelector('.wfg-ux-status');if(status)status.textContent=message;}
function close(v,focus=false){if(!v.open)return;const {button,popup}=v.open;popup.hidden=true;button.setAttribute('aria-expanded','false');v.open=null;if(focus)button.focus();}
function open(v,button,popup,focus=true){if(v.open?.popup===popup){close(v,true);return;}close(v);popup.hidden=false;button.setAttribute('aria-expanded','true');v.open={button,popup};if(focus)popup.querySelector('[role^="menuitem"]:not(:disabled)')?.focus();}
function menuKeys(v,popup,event){const items=[...popup.querySelectorAll('[role^="menuitem"]:not(:disabled)')],at=items.indexOf(document.activeElement);let index=null;if((event.key==='Enter'||event.key===' ')&&items.includes(document.activeElement)){event.preventDefault();event.stopPropagation();document.activeElement.click();return;}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(v,true);return;}if(event.key==='ArrowDown')index=(at+1)%items.length;if(event.key==='ArrowUp')index=(at-1+items.length)%items.length;if(event.key==='Home')index=0;if(event.key==='End')index=items.length-1;if(index!==null){event.preventDefault();event.stopPropagation();items[index]?.focus();}if(event.key==='Tab')close(v,true);}
function decorateFiles(v){const host=v.form.querySelector('#articleChatAttachments'),files=typeof articleChatAttachments!=='undefined'?articleChatAttachments:[];if(!host)return;for(const [i,chip]of [...host.children].entries()){if(chip.hasAttribute('data-composer-file'))continue;const file=files[i],name=chip.firstElementChild;if(!file||!name)continue;chip.dataset.composerFile='';const body=node('span','wfg-file-body'),kind=String(file.mediaType||file.mimeType||file.type||'').toLowerCase(),isImage=kind.startsWith('image/')||String(file.dataUrl||'').startsWith('data:image/');let art;if(isImage&&/^data:image\/(png|jpeg|webp);base64,/i.test(file.dataUrl||'')){art=document.createElement('img');art.src=file.dataUrl;art.alt='';}else art=icon(/\.pdf$/i.test(file.name)?'file-magnifying-glass':isImage?'image':'file-magnifying-glass');art.classList.add('wfg-file-art');body.append(name);const size=node('small','wfg-file-size'),bytes=Number(file.byteLength)||0,ext=String(file.name||'').split('.').at(-1).toUpperCase();size.textContent=(ext.length<=8?ext:'文件')+(bytes?' · '+(bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(bytes/1024))+' KB'):'');body.append(size);chip.prepend(art,body);}}
function networkState(settings,selectedProfileId,api,sourceCount=1){
 const policy=settings?.taskPolicies?.article_chat||{},id=selectedProfileId||(policy.mode==='profile'?policy.profileId:settings?.globalProfileId),profile=settings?.profiles?.[id];
 const config={...profile?.config};config.model=api?.taskModelForProfile?.(policy,profile,id)||config.model;
 const capability=api?.getTaskWebSearchCapabilities?.(profile?.providerId,config,'article_chat')||{supported:false,modes:[]};
 return sourceCount>1?{supported:false,modes:[]}:capability;
}
function updateNetwork(v){const b=v.network;if(!b)return;
 const capability=networkState(settings(),v.profile?.value||'',g.SciLLM,v.state?.sourceIds?.length||1);
 b.hidden=v.state?.adjusting===true;b.disabled=!capability.supported||b.hidden;
 if(v.networkSlot)v.networkSlot.hidden=b.hidden;
 if(b.disabled&&v.open?.popup===v.networkMenu)close(v);
 if(typeof articleChatWebSearchMode==='undefined')return;
 if(!capability.modes.includes(articleChatWebSearchMode)){articleChatWebSearchMode='off';articleChatWebSearchEnabled=false;}
 const mode=articleChatWebSearchMode,on=mode!=='off',label={off:'关闭',on:'开启',deep:'深度检索',auto:'按需'}[mode]||'关闭';
 const description=capability.supported?'联网：'+label+'；点击选择模式':'联网已关闭；当前模型或问答范围不支持联网';
 b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',description);b.dataset.searchMode=mode;
 b.title=description;
 if(!v.networkMenu)return;
 v.networkMenu.replaceChildren();
 for(const value of capability.modes){
  const item=control({off:'关闭 · 仅当前材料',on:'联网 · 搜索与读取链接',deep:'深度检索 · 多步查证',auto:'按需联网'}[value]||value);item.setAttribute('role','menuitemradio');item.setAttribute('aria-checked',String(value===mode));item.dataset.networkMode=value;
  item.addEventListener('click',()=>{articleChatWebSearchCustomized=true;articleChatWebSearchMode=value;articleChatWebSearchEnabled=['on','deep'].includes(value);close(v,true);if(typeof syncArticleChatWebSearchToggle==='function')syncArticleChatWebSearchToggle();});v.networkMenu.append(item);
 }
}
// Refresh once per connection, without delaying page reading or sending text.
const capabilityRequests=new Map();
function refreshModelCapabilities(v){
 const data=settings(),policy=data?.taskPolicies?.article_chat||{},id=v.profile?.value||(policy.mode==='profile'?policy.profileId:data?.globalProfileId),profile=data?.profiles?.[id];
 if(!profile||typeof sendLlmMessage!=='function'||!g.SciLLM.modelCapabilityScope)return;
 const scope=g.SciLLM.modelCapabilityScope(profile.providerId,profile.config),key=id+'|'+scope;
 const cached=profile.config?.modelCapabilityCatalog;
 if(cached?.scope===scope&&Date.now()-cached.fetchedAt<86400000||Date.now()-(capabilityRequests.get(key)||0)<300000)return;
 capabilityRequests.set(key,Date.now());
 void sendLlmMessage({type:'LLM_LIST_MODELS',profileId:id,cacheCapabilities:true}).then(result=>{
  const current=settings()?.profiles?.[id];
  if(!result.modelCapabilityCatalog||!current||g.SciLLM.modelCapabilityScope(current.providerId,current.config)!==scope)return;
  current.config.modelCapabilityCatalog=result.modelCapabilityCatalog;
  refreshReasoning(v);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);
 }).catch(()=>{});
}
function refreshReasoning(v){const d=reasoningState(settings(),v.profile?.value||'',g.SciLLM);v.reasoning=d;v.thinking.hidden=!d.supported||v.state?.adjusting===true;if(v.thinkingSlot)v.thinkingSlot.hidden=v.thinking.hidden;if(v.thinking.hidden&&v.open?.popup===v.thinkingMenu)close(v);v.thinking.disabled=!d.supported||v.saving||v.state?.busy===true;v.thinking.setAttribute('aria-pressed',String(d.normalized?.enabled===true));v.thinking.title=d.supported?'思考：'+(d.options.find(x=>x.value===d.value)?.label||'跟随模型')+'；点击调整':d.reason;v.thinking.dataset.effort=d.value||'';v.thinking.setAttribute('aria-label',d.supported?'思考深度：'+(d.options.find(x=>x.value===d.value)?.label||d.label):d.reason);
 const previouslyFocused=document.activeElement?.dataset?.thinkingLevel;v.thinkingMenu.replaceChildren();for(const option of d.options){const b=control(option.label);b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(option.value===d.value));b.dataset.thinkingLevel=option.value;b.disabled=!!v.saving;b.addEventListener('click',()=>void saveReasoning(v,option));v.thinkingMenu.append(b);}if(v.open?.popup===v.thinkingMenu&&previouslyFocused)v.thinkingMenu.querySelector('[data-thinking-level="'+previouslyFocused+'"]')?.focus();
}
async function saveReasoning(v,option){if(v.saving||!v.reasoning?.supported)return;if(option.value===v.reasoning.value){close(v,true);return;}const menuHadFocus=v.thinkingMenu.contains(document.activeElement),selectedProfileId=v.profile?.value||'',initialSettings=settings(),expected=g.SciLLM.normalizeReasoningForProvider(v.reasoning.providerId,v.reasoning.config,{enabled:option.enabled,effort:option.effort});v.saving=true;refreshReasoning(v);try{
 if(typeof sendLlmMessage!=='function')throw Error('当前组件无法保存思考设置');
 const result=await sendLlmMessage({type:'LLM_UPDATE_PROFILE_ROUTING',articleChatReasoning:{enabled:option.enabled,effort:option.effort,profileId:selectedProfileId}}),p=result?.settings?.taskPolicies?.article_chat;
 if(!p||p.reasoningEnabled!==expected.enabled||p.reasoningEffort!==expected.effort)throw Error('当前后台尚未支持此思考设置，原设置已保留');
 if(settings()!==initialSettings||(v.profile?.value||'')!==selectedProfileId)return;
 if(typeof llmSettingsState!=='undefined')llmSettingsState=result;close(v,true);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);
 }catch(e){announce(v,e.message||'思考设置未保存，请重试');}finally{v.saving=false;refreshReasoning(v);if(menuHadFocus&&!v.thinking.hidden&&(v.profile?.value||'')===selectedProfileId&&document.activeElement===document.body){if(v.open?.popup===v.thinkingMenu)v.thinkingMenu.querySelector('[data-thinking-level="'+option.value+'"]')?.focus();else v.thinking.focus();}}}
function wrapNative(){if(wrapped)return;wrapped=true;if(typeof syncArticleChatWebSearchToggle==='function'){nativeNetworkSync=syncArticleChatWebSearchToggle;syncArticleChatWebSearchToggle=function(...args){const result=nativeNetworkSync(...args);for(const v of activeViews)updateNetwork(v);return result;};}if(typeof renderArticleChatAttachmentChips==='function'){const original=renderArticleChatAttachmentChips;renderArticleChatAttachmentChips=function(...args){const result=original(...args);for(const v of activeViews)decorateFiles(v);return result;};}}
function mount(form){if(form.id!=='articleChatForm'||views.has(form))return;const u=form.querySelector('[data-wfg-ux]'),inputRow=form.querySelector('.article-chat-input-row'),profile=form.querySelector('#articleChatProfile'),add=form.querySelector('#addArticleChatAttachment'),network=form.querySelector('#articleChatWebSearch'),send=form.querySelector('#sendArticleChat');if(!u||!inputRow||!profile||!add||!network||!send)return;
 const v={form,u,profile,add,network,send,state:null,saving:false,open:null};views.set(form,v);activeViews.add(v);wrapNative();form.dataset.wfgComposer='';
 const header=node('div','wfg-composer-header'),deck=node('div','wfg-composer-deck'),toolbar=node('div','wfg-composer-toolbar'),left=node('div','wfg-composer-actions'),right=node('div','wfg-composer-actions wfg-composer-send'),tools=u.querySelector('.wfg-ux-tools'),sources=u.querySelector('[data-add-sources]'),picker=profile.closest('.article-chat-model-picker');
 for(const selector of ['#articleChatContextScopes','#articleChatAttachments','.wfg-ux-chips']){const n=form.querySelector(selector);if(n)deck.append(n);}const box=u.querySelector('.wfg-ux-sources'),preview=u.querySelector('.wfg-ux-preview'),status=u.querySelector('.wfg-ux-status');
 const thinking=control('','brain');thinking.querySelector('span')?.remove();thinking.dataset.thinking='';thinking.setAttribute('aria-haspopup','menu');thinking.setAttribute('aria-expanded','false');v.thinking=thinking;
 const attachmentMenu=node('div','wfg-composer-menu'),thinkingMenu=node('div','wfg-composer-menu wfg-thinking-menu');attachmentMenu.dataset.composerAttachmentsMenu='';attachmentMenu.setAttribute('role','menu');attachmentMenu.setAttribute('aria-label','添加附件或网页');thinkingMenu.setAttribute('role','menu');thinkingMenu.setAttribute('aria-label','思考深度');for(const m of [attachmentMenu,thinkingMenu]){m.hidden=true;m.setAttribute('data-sidebar-focus-escape-priority','');m.addEventListener('keydown',e=>menuKeys(v,m,e));}v.attachmentMenu=attachmentMenu;v.thinkingMenu=thinkingMenu;
 const local=control('本地文件','upload');local.dataset.composerLocal='';local.setAttribute('role','menuitem');local.addEventListener('click',()=>{close(v);form.querySelector('#articleChatAttachmentFiles')?.click();});sources.setAttribute('role','menuitem');sources.replaceChildren(icon('compass'),document.createTextNode('其他网页'));sources.addEventListener('click',()=>close(v));attachmentMenu.append(local,sources);
 const attachmentSlot=node('div','wfg-composer-menu-anchor'),thinkingSlot=node('div','wfg-composer-menu-anchor');attachmentSlot.append(add,attachmentMenu);thinkingSlot.append(thinking,thinkingMenu);v.thinkingSlot=thinkingSlot;add.setAttribute('aria-label','添加附件或网页');add.title='添加本地文件或其他网页';add.setAttribute('aria-haspopup','menu');add.setAttribute('aria-expanded','false');
 add.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();if(!add.disabled)open(v,add,attachmentMenu);},true);thinking.addEventListener('click',()=>{refreshReasoning(v);if(!thinking.disabled)open(v,thinking,thinkingMenu);});for(const [button,menu]of [[add,attachmentMenu],[thinking,thinkingMenu]])button.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!button.disabled){e.preventDefault();if(v.open?.popup!==menu)open(v,button,menu);else menu.querySelector('[role^="menuitem"]')?.focus();}});
 network.replaceChildren(icon('globe'));
 const networkMenu=node('div','wfg-composer-menu wfg-network-menu'),networkSlot=node('div','wfg-composer-menu-anchor');networkMenu.hidden=true;networkMenu.setAttribute('role','menu');networkMenu.setAttribute('aria-label','联网模式');networkMenu.setAttribute('data-sidebar-focus-escape-priority','');networkMenu.addEventListener('keydown',e=>menuKeys(v,networkMenu,e));v.networkMenu=networkMenu;v.networkSlot=networkSlot;networkSlot.append(network,networkMenu);network.setAttribute('aria-haspopup','menu');network.setAttribute('aria-expanded','false');
 network.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();if(network.disabled)return;updateNetwork(v);open(v,network,networkMenu);},true);network.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!network.disabled){e.preventDefault();updateNetwork(v);open(v,network,networkMenu);}});
 const oldControls=form.querySelector('.article-chat-submit-controls');left.append(thinkingSlot,networkSlot,tools);right.append(picker,attachmentSlot,send);toolbar.append(left,right);oldControls?.remove();const help=form.querySelector('#articleChatSearchOption');if(help)help.classList.add('visually-hidden');const generalization=u.querySelector('[data-generalization]');u.replaceChildren(deck,box,preview,...(generalization?[generalization]:[]),inputRow,toolbar,status);box.setAttribute('data-sidebar-focus-escape-priority','');box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();box.hidden=true;add.focus();}});
 form.addEventListener('change',e=>{if(e.target===profile){close(v);refreshReasoning(v);updateNetwork(v);refreshModelCapabilities(v);}});document.addEventListener('pointerdown',e=>{if(v.open&&!v.open.popup.contains(e.target)&&!v.open.button.contains(e.target))close(v);});form.addEventListener('submit',()=>close(v),true);
 g.BrevessChatAgentControls?.mountComposer(right);
 decorateFiles(v);refreshReasoning(v);refreshModelCapabilities(v);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);
 const initialSettings=settings();if(typeof sendLlmMessage==='function')void sendLlmMessage({type:'LLM_GET_SETTINGS'}).then(result=>{if(settings()!==initialSettings||v.saving)return;if(typeof llmSettingsState!=='undefined')llmSettingsState=result;refreshReasoning(v);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);}).catch(()=>{});
}
function render(form,state){const v=views.get(form);if(!v)return;v.state=state;refreshReasoning(v);refreshModelCapabilities(v);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);decorateFiles(v);}
return {reasoningState,networkState,mount,render};
});
