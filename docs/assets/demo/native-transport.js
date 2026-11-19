/* Isolated website adapter. Does not connect to the installed extension. */
(() => {
  'use strict';
  try{document.documentElement.lang=parent.document.documentElement.lang||'zh-CN';}catch{}
  if(document.documentElement.style)document.documentElement.style.overscrollBehaviorY='contain';
  const events=()=>({addListener(){},removeListener(){},hasListener(){return false;}});
  const tablePage=location.pathname.endsWith('/table-viewer.html');
  const actionPage=location.pathname.endsWith('/action-popup.html');
  const tableKey='brevess.tableView.'+location.hash.slice(1);
  const values={sciLlmSettingsV2:{language:document.documentElement.lang},...(tablePage&&parent!==window?{[tableKey]:parent.__bvTableSnapshots?.[tableKey]}:{})};
  if(tablePage){delete parent.__bvTableSnapshots?.[tableKey];window.close=()=>parent.postMessage({source:'brevess-native-demo',type:'close-table'},location.origin);}
  const store={get:async keys=>keys==null?{...values}:typeof keys==='string'?{[keys]:values[keys]}:Array.isArray(keys)?Object.fromEntries(keys.map(k=>[k,values[k]])):{...keys,...values},set:async x=>{Object.assign(values,x);},remove:async keys=>{for(const k of [].concat(keys))delete values[k];}};
  const base=new URL(location.pathname.includes('/workbench/')||location.pathname.includes('/literature-radar/')?'../':'./',location.href);
  const endpoint={onMessage:events(),onDisconnect:events(),postMessage(){},disconnect(){}};
  window.__websiteDemo={errors:[],messages:[],base,send:(type,data={})=>parent.postMessage({source:'brevess-native-demo',type,...data},location.origin)};
  if(actionPage)window.close=()=>__websiteDemo.send('close-tools');
  document.addEventListener('pointerdown',()=>{let view=parent;while(view!==window){try{view.postMessage({source:'brevess-native-demo',type:'pointerdown'},location.origin);if(view===view.parent)break;view=view.parent;}catch{break;}}},true);
  addEventListener('error',e=>__websiteDemo.errors.push(e.message));addEventListener('unhandledrejection',e=>__websiteDemo.errors.push(String(e.reason?.stack||e.reason)));
  const call=async m=>{
    __websiteDemo.messages.push(m.type||m.action);
    if(__websiteDemo.messages.length>100)__websiteDemo.messages.shift();
    if(window.__websiteDemo.handleMessage)return __websiteDemo.handleMessage(m);
    return {success:true,data:{items:[],entries:[],pageCount:1,results:[],permission:'unavailable'}};
  };
  const runtimeCall=(m,callback)=>{const pending=call(m);if(callback){pending.then(callback,error=>callback({success:false,error:{message:error.message}}));return;}return pending;};
  window.chrome={storage:{local:store,sync:store,session:store,onChanged:events()},i18n:{getMessage:k=>k,getUILanguage:()=>document.documentElement.lang||'zh-CN'},runtime:{id:'brevess-website-demo',getURL:p=>new URL(p,base).href,getManifest:()=>({name:'BREVESS',version:'1.0.2'}),onMessage:events(),onConnect:events(),connect:()=>endpoint,sendMessage:runtimeCall,openOptionsPage:()=>__websiteDemo.send('install')},tabs:{query:async()=>[{id:1,url:window.BV_DEMO_DATA?.source||'https://www.nature.com/articles/s41586-021-03819-2',title:window.BV_DEMO_DATA?.title||'Highly accurate protein structure prediction with AlphaFold',active:true}],get:async()=>({id:1,url:window.BV_DEMO_DATA?.source||'https://www.nature.com/articles/s41586-021-03819-2'}),onActivated:events(),onUpdated:events(),onRemoved:events(),sendMessage:async(id,m)=>call(m),create:async options=>{__websiteDemo.send(options?.url?.includes('/workbench/index.html')?'workbench':'install');return {id:1};}},windows:{create:async options=>{const u=new URL(options.url);if(u.origin===location.origin&&u.pathname.endsWith('/table-viewer.html')){const key='brevess.tableView.'+u.hash.slice(1);__websiteDemo.send('table',{url:u.href,key,value:values[key]});delete values[key];return {id:1};}__websiteDemo.send('install');return {id:1};},getCurrent:async()=>({id:1}),onFocusChanged:events()},permissions:{contains:async()=>false},sidePanel:{setOptions:async()=>{}},scripting:{executeScript:async()=>[]}};
  // Account setup and local-file imports need extension privileges. Keep those
  // routes explicit instead of opening a half-configured website copy.
  const installOnly=new Set(['external-agent','agent','upload','import','import-share','library-import','sync']);
  document.addEventListener('click',e=>{
    const b=e.target.closest('button,a'), action=b?.dataset.action;
    const link=b?.tagName==='A'&&/\/(?:options|history|pdf-reader)\.html/.test(b.getAttribute('href')||'');
    if(installOnly.has(action)||link){e.preventDefault();e.stopImmediatePropagation();__websiteDemo.send('install');}
  },true);
  addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('dialog[open]'))__websiteDemo.send('escape');});
  // The production popup's connection/bootstrap is replaced; its renderers and UI code remain unchanged.
  const add=document.addEventListener.bind(document);
  document.addEventListener=function(type,listener,options){if(type==='DOMContentLoaded'&&document.currentScript?.src.endsWith('/popup.js'))return;return add(type,listener,options);};
})();
