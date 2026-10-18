// Offline request/transaction simulator; not a browser IndexedDB acceptance test.
function fixture(){
  const stores=new Map(),openCalls=[];let tail=Promise.resolve(),fail='';
  const db={objectStoreNames:{contains:n=>stores.has(n)},createObjectStore(n){stores.set(n,new Map());},close(){},transaction(names){
    let release;const before=tail;tail=before.then(()=>new Promise(r=>release=r));let pending=0,done=false,staged;
    const ready=before.then(()=>{staged=new Map(names.map(n=>[n,new Map([...stores.get(n)].map(([k,v])=>[k,structuredClone(v)]))]));});
    const tx={abort(){if(done)return;done=true;queueMicrotask(()=>{tx.onabort?.();release();});},objectStore(n){
      const request=operation=>{pending++;const r={};ready.then(()=>queueMicrotask(()=>{if(!done)try{r.result=operation();r.onsuccess?.();}catch(e){r.error=e;tx.error=e;r.onerror?.();tx.abort();}finally{pending--;queueMicrotask(()=>{if(!pending&&!done){done=true;for(const [name,map]of staged)stores.set(name,map);tx.oncomplete?.();release();}});}}));return r;};
      return {get:key=>request(()=>staged.get(n).has(key)?structuredClone(staged.get(n).get(key)):undefined),getAllKeys:()=>request(()=>[...staged.get(n).keys()]),getAll:()=>request(()=>[...staged.get(n).values()].map(value=>structuredClone(value))),put:(v,k)=>request(()=>{if(fail===n){fail='';throw Error('injected storage write failure');}staged.get(n).set(k,structuredClone(v));return k;}),delete:k=>request(()=>staged.get(n).delete(k))};
    }};return tx;
  }};
  return {stores,openCalls,failNextPutFor:n=>fail=n,indexedDB:{open(name,version){openCalls.push({name,version});const r={};queueMicrotask(()=>{r.result=db;if(!stores.size)r.onupgradeneeded?.();r.onsuccess?.();});return r;}}};
}
module.exports={fixture};
