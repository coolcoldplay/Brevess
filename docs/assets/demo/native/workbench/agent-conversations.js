/* Local workbench chat history. Transcripts and indexes are separate so listing
 * previous chats never needs to load their messages or raw tool results. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.Workbench||={},api);})(globalThis,()=>{
  'use strict';
  const result=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  function createAgentConversations(factory=globalThis.indexedDB) {
    let opening;
    async function db(){if(!opening){const req=factory.open('brevess-workbench-conversations',1);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('active');db.createObjectStore('threads',{keyPath:'id'}).createIndex('scope','scope');db.createObjectStore('turns',{keyPath:'id'}).createIndex('thread','thread');};opening=result(req).catch(e=>{opening=null;throw e;});}return opening;}
    async function transaction(names,mode,fn){const tx=(await db()).transaction(names,mode);const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error('会话保存失败'));});try{const value=await fn(name=>tx.objectStore(name));await done;return value;}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}}
    const scopeError=()=>Error('会话不属于当前课题');
    async function list(scope){return transaction(['active','threads'],'readonly',async s=>({current:await result(s('active').get(scope))||null,items:(await result(s('threads').index('scope').getAll(scope))).filter(t=>t.count).sort((a,b)=>b.updated-a.updated)}));}
    async function select(scope,id){return transaction(['active','threads'],'readwrite',async s=>{if(id){if((await result(s('threads').get(id)))?.scope!==scope)throw scopeError();}await result(s('active').put(id||null,scope));return id||null;});}
    async function read(scope,id){if(!id)return [];return transaction(['threads','turns'],'readonly',async s=>{if((await result(s('threads').get(id)))?.scope!==scope)throw scopeError();return (await result(s('turns').index('thread').getAll(id))).sort((a,b)=>a.order-b.order);});}
    async function begin(scope,id,task,providerId,model){return transaction(['active','threads','turns'],'readwrite',async s=>{
      let thread=id?await result(s('threads').get(id)):null;if(id&&thread?.scope!==scope)throw scopeError();
      const at=Date.now();thread ||= {id:crypto.randomUUID(),scope,created:at,count:0,title:task.slice(0,90)};
      const turn={id:crypto.randomUUID(),thread:thread.id,task,order:++thread.count,created:at,providerId,model,events:[],status:'pending'};
      thread.updated=at;await result(s('threads').put(thread));await result(s('turns').add(turn));await result(s('active').put(thread.id,scope));return turn;
    });}
    async function finish(turn,events,status){return transaction(['turns'],'readwrite',async s=>{const old=await result(s('turns').get(turn.id));if(old?.thread!==turn.thread)throw scopeError();await result(s('turns').put({...old,events,status}));});}
    return {list,read,select,begin,finish};
  }
  function agentConversationContext(turns,budget=28000){const out=[];for(const t of [...turns].reverse()){
    const answer=t.events.filter(e=>e.type==='message').map(e=>e.text).join('\n');if(!answer)continue;
    const item={question:t.task.slice(0,5000),answer:answer.slice(0,12000),status:t.status};const cost=JSON.stringify(item).length;if(cost>budget)break;budget-=cost;out.unshift(item);
  }return out;}
  return {createAgentConversations,agentConversationContext};
});
