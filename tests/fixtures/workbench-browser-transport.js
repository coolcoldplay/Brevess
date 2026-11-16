// Isolated HTTP UI harness only: no extension privileges or real library access.
window.__qaErrors=[];
addEventListener('error',e=>__qaErrors.push(e.message));
addEventListener('unhandledrejection',e=>__qaErrors.push(String(e.reason)));
(()=>{
 const event={addListener(){},removeListener(){}};
 const store={async get(keys){const all=JSON.parse(localStorage.getItem('qa-chrome-storage')||'{}');if(keys==null)return all;if(typeof keys==='string')return {[keys]:all[keys]};if(Array.isArray(keys))return Object.fromEntries(keys.map(k=>[k,all[k]]));return {...keys,...all};},async set(value){localStorage.setItem('qa-chrome-storage',JSON.stringify({...await this.get(null),...value}));}};
 window.chrome={storage:{local:store,sync:store,onChanged:event},runtime:{getURL:path=>new URL('/'+path,location.href).href,onMessage:event,connect:()=>({onMessage:event,onDisconnect:event,postMessage(){},disconnect(){}}),sendMessage:async msg=>{
 if(msg.type==='LOCAL_READING_LIBRARY_QUERY')return {success:true,data:{items:[],pageCount:1}};
 if(msg.type==='RESEARCH_WORKBENCH_SYNC')return {success:true,data:{results:[],permission:'unavailable'}};
 if(msg.type==='RESEARCH_WORKBENCH_DIRECTORY_STATUS')return {success:true,data:{permission:'unavailable',pending:0,failed:0}};
 throw Error('QA transport does not implement '+msg.type);
 }}};
})();
