(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./local-snapshot.js') : root.BrevessLocalSnapshot);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessLocalSnapshotBrowser = api;
})(globalThis, function (codec) {
  'use strict';
  const JOURNAL = 'brevessLocalSnapshotRecoveryV1';
  const DETACHED_AUTH = 'brevessLocalSnapshotDetachedAuthorizationV1';
  const PAIRING_KEYS = ['brevess-mcp-bridge-v1','brevess-mcp-client-id-v1'];
  // A newer known schema may require a newer application even on an empty target.
  // Unknown databases are preserved; they are never interpreted as known data.
  const KNOWN_VERSIONS = Object.freeze({
    'sci-logic-highlighter-user-data':4, 'brevess-research-workbench':1,
    'brevess-library-catalog-v1':1, 'brevess-library-attachments-v1':1,
    'brevess-original-pdf-sources-v1':1, 'brevess-literature-radar-v1':1,
    'brevess-workbench-library-transfer-v1':1, 'sci-logic-highlighter-corpus':1,
    'sci-logic-highlighter':1, 'brevess-supplemental-pdf-imports-v1':1
  });
  const fail = code => { throw Object.assign(new Error(code), {code}); };
  const req = r => new Promise((resolve,reject) => {r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const done = tx => new Promise((resolve,reject) => {tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('SNAPSHOT_TRANSACTION_ABORTED'));tx.onerror=()=>{};});
  const sorted = names => Array.from(names).sort();
  function describe(store) {
    return {name:store.name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes:sorted(store.indexNames).map(n=>{
      const i=store.index(n);return {name:n,keyPath:i.keyPath,unique:i.unique,multiEntry:i.multiEntry};
    })};
  }
  async function open(indexedDB, name, version, stores) {
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(name,version);let rejected=false;
      r.onblocked=()=>{rejected=true;reject(Error('SNAPSHOT_DATABASE_BLOCKED'));};
      r.onerror=()=>reject(r.error);
      r.onupgradeneeded=event=>{
        if(event.oldVersion!==0 || !stores){r.transaction.abort();return;}
        for(const def of stores){
          const store=r.result.createObjectStore(def.name,{keyPath:def.keyPath,autoIncrement:def.autoIncrement});
          for(const i of def.indexes)store.createIndex(i.name,i.keyPath,{unique:i.unique,multiEntry:i.multiEntry});
        }
      };
      r.onsuccess=()=>{if(rejected){r.result.close();return;}r.result.onversionchange=()=>r.result.close();resolve(r.result);};
    });
  }
  async function readDB(indexedDB,name,version) {
    const db=await open(indexedDB,name,version);
    try{
      const names=sorted(db.objectStoreNames);if(!names.length)return {name,version,stores:[]};
      const tx=db.transaction(names,'readonly'), finished=done(tx);
      const stores=await Promise.all(names.map(async n=>{
        const st=tx.objectStore(n),keys=req(st.getAllKeys()),values=req(st.getAll());
        return {...describe(st),entries:(await keys).map((key,i)=>({key,index:i})),values:await values};
      }));
      await finished;
      return {name,version:db.version,stores:stores.map(({values,...st})=>({...st,entries:st.entries.map(({key,index})=>({key,value:values[index]}))}))};
    }finally{db.close();}
  }
  function createBrowserAdapter({indexedDB=globalThis.indexedDB,chromeApi=globalThis.chrome,webStorage=globalThis.localStorage,prefix=''}={}) {
    const lockName='brevess-local-snapshot-operation-v1';
    const logical=n=>n.slice(prefix.length),actual=n=>prefix+n;
    let capabilities=[];
    async function capture() {
      if(!indexedDB?.databases)fail('SNAPSHOT_DATABASE_ENUMERATION_UNAVAILABLE');
      const list=(await indexedDB.databases()).filter(d=>d.name&&d.name.startsWith(prefix)).sort((a,b)=>a.name.localeCompare(b.name));
      const databases=[];capabilities=[];
      for(const d of list){
        const row=await readDB(indexedDB,d.name,d.version);row.name=logical(row.name);
        // The one known capability slot is not user content. Preserve its
        // surrounding metadata; cross-origin permission must be re-established.
        if(row.name==='sci-logic-highlighter-user-data')for(const entry of row.stores.find(s=>s.name==='directoryHandles')?.entries||[]){
          const handle=entry.value?.handle;
          if(handle&&typeof FileSystemHandle!=='undefined'&&handle instanceof FileSystemHandle){
            capabilities.push({database:row.name,store:'directoryHandles',key:entry.key,name:handle.name,kind:handle.kind,reconnectRequired:true});
            entry.value={...entry.value,handle:null};
          }
        }
        databases.push(row);
      }
      const storage={};
      for(const area of ['local','sync']) {
        storage[area]=await chromeApi.storage[area].get(null);
        // Recovery bookkeeping is operational state, never the user snapshot itself.
        if(area==='local')delete storage[area][JOURNAL];
      }
      const localStorage=Object.create(null);
      for(let i=0;i<webStorage.length;i++){const key=webStorage.key(i);localStorage[key]=webStorage.getItem(key);}
      return {databases,storage,localStorage};
    }
    async function exportSnapshot() {
      const first=await capture(), firstCapabilities=capabilities, second=await capture();
      if(await codec.fingerprint(first)!==await codec.fingerprint(second))fail('SNAPSHOT_SOURCE_CHANGED_CLOSE_OTHER_WINDOWS');
      if(await codec.fingerprint(firstCapabilities)!==await codec.fingerprint(capabilities))fail('SNAPSHOT_SOURCE_CHANGED_CLOSE_OTHER_WINDOWS');
      return codec.create(first,{scope:'browser-origin',externalDirectoriesIncluded:false,sessionAuthorizationIncluded:false,directoryCapabilities:firstCapabilities,sourceExtensionId:chromeApi.runtime?.id||null});
    }
    async function journal(){return (await chromeApi.storage.local.get(JOURNAL))[JOURNAL]||null;}
    const saveJournal=value=>chromeApi.storage.local.set({[JOURNAL]:value});
    async function prepareRestore(snapshot) {
      const content=await codec.read(snapshot);await checkSchema(content);
      // Keep pairing history in the encrypted archive and an inert local slot.
      // Never reactivate another browser/profile's bearer token or client ID.
      const local=content.storage.local,authorization=Object.create(null);
      for(const key of PAIRING_KEYS)if(Object.hasOwn(local,key)){authorization[key]=local[key];delete local[key];}
      if(Object.keys(authorization).length){
        const previous=Object.hasOwn(local,DETACHED_AUTH)?local[DETACHED_AUTH]:{version:1,records:[]};
        if(!previous||previous.version!==1||!Array.isArray(previous.records))fail('SNAPSHOT_AUTHORIZATION_ARCHIVE_UNSUPPORTED');
        local[DETACHED_AUTH]={...previous,records:[...previous.records,{snapshot:snapshot.sha256,sourceExtensionId:snapshot.metadata?.sourceExtensionId||null,authorization}]};
      }
      return content;
    }
    async function checkSchema(content) {
      if(!content||!Array.isArray(content.databases)||!content.storage?.local||!content.storage?.sync||!content.localStorage)fail('SNAPSHOT_CONTENT_INVALID');
      const names=new Set();
      for(const d of content.databases){
        if(typeof d.name!=='string'||!d.name||names.has(d.name)||!Number.isSafeInteger(d.version)||d.version<1||!Array.isArray(d.stores))fail('SNAPSHOT_SCHEMA_INVALID');names.add(d.name);
        if(Object.hasOwn(KNOWN_VERSIONS,d.name)&&d.version>KNOWN_VERSIONS[d.name])fail('SNAPSHOT_NEWER_DATABASE_UNSUPPORTED');
        const stores=new Set();
        for(const s of d.stores){
          if(stores.has(s.name)||typeof s.name!=='string'||!Array.isArray(s.entries)||!Array.isArray(s.indexes)||s.autoIncrement)fail('SNAPSHOT_SCHEMA_UNSUPPORTED');stores.add(s.name);
          const inline=(value,path)=>path===''?value:path.split('.').reduce((v,k)=>v?.[k],value);
          try{const keys=s.entries.map(e=>e.key).sort((a,b)=>indexedDB.cmp(a,b));for(let i=1;i<keys.length;i++)if(indexedDB.cmp(keys[i-1],keys[i])===0)fail('SNAPSHOT_RECORD_KEY_INVALID');}catch{fail('SNAPSHOT_RECORD_KEY_INVALID');}
          for(const e of s.entries){try{
              indexedDB.cmp(e.key,e.key);
              if(s.keyPath!==null){const key=Array.isArray(s.keyPath)?s.keyPath.map(p=>inline(e.value,p)):inline(e.value,s.keyPath);if(indexedDB.cmp(key,e.key)!==0)fail('SNAPSHOT_RECORD_KEY_INVALID');}
            }catch{fail('SNAPSHOT_RECORD_KEY_INVALID');}
          }
        }
      }
      if(Object.hasOwn(content.storage.local,JOURNAL))fail('SNAPSHOT_RESERVED_KEY');
    }
    async function compareExisting(content) {
      const available=await indexedDB.databases();
      for(const extra of available.filter(x=>x.name?.startsWith(prefix)&&!content.databases.some(d=>actual(d.name)===x.name))){
        const value=await readDB(indexedDB,extra.name,extra.version);
        if(value.stores.some(s=>s.entries.length))fail('SNAPSHOT_TARGET_CONFLICT');
      }
      for(const d of content.databases){
        const exists=available.find(x=>x.name===actual(d.name));if(!exists)continue;
        if(exists.version!==d.version)fail('SNAPSHOT_DATABASE_VERSION_CONFLICT');
        const current=await readDB(indexedDB,exists.name,exists.version);
        if(await codec.fingerprint(current.stores.map(({entries,...s})=>s))!==await codec.fingerprint(d.stores.map(({entries,...s})=>s)))fail('SNAPSHOT_DATABASE_SCHEMA_CONFLICT');
        for(const st of current.stores){
          const incoming=d.stores.find(s=>s.name===st.name);
          for(const e of st.entries){const match=incoming.entries.find(x=>indexedDB.cmp(x.key,e.key)===0);if(!match||await codec.fingerprint(match.value)!==await codec.fingerprint(e.value))fail('SNAPSHOT_TARGET_CONFLICT');}
        }
      }
      for(const area of ['local','sync']){
        const current=await chromeApi.storage[area].get(null);
        for(const [k,v] of Object.entries(current)){
          if(area==='local'&&k===JOURNAL)continue;
          if(!Object.hasOwn(content.storage[area],k)||await codec.fingerprint(content.storage[area][k])!==await codec.fingerprint(v))fail('SNAPSHOT_TARGET_CONFLICT');
        }
      }
      for(let i=0;i<webStorage.length;i++){const k=webStorage.key(i);if(content.localStorage[k]!==webStorage.getItem(k))fail('SNAPSHOT_TARGET_CONFLICT');}
    }
    // Hold the real IDB transaction while asynchronous binary hashes are compared.
    // All inserts/removals are checked inside the same readwrite transaction.
    async function atomicDatabase(d, operation) {
      const db=await open(indexedDB,actual(d.name),d.version,d.stores);
      if(!d.stores.length){db.close();return;}
      const tx=db.transaction(d.stores.map(s=>s.name),'readwrite'),finished=done(tx);finished.catch(()=>{});
      let active=true;const pending=[];
      const dispatch=fn=>new Promise((resolve,reject)=>{if(!active){reject(Error('SNAPSHOT_TRANSACTION_INACTIVE'));return;}pending.push({reject,run(){try{req(fn()).then(resolve,reject);}catch(e){reject(e);}}});});
      finished.catch(error=>{active=false;for(const task of pending.splice(0))task.reject(error);});
      const pulse=()=>{if(!active)return;try{const r=tx.objectStore(d.stores[0].name).count();r.onsuccess=()=>{for(const work of pending.splice(0))work.run();pulse();};}catch{}};pulse();
      try{await Promise.race([operation(tx,dispatch),finished]);active=false;await finished;}catch(e){active=false;try{tx.abort();}catch{}await finished.catch(()=>{});throw e;}finally{db.close();}
    }
    async function resume(snapshot,{afterDatabase,afterStorage,allowBrowserSync=false}={}) {
      const content=await prepareRestore(snapshot);
      if(Object.keys(content.storage.sync).length&&!allowBrowserSync)fail('SNAPSHOT_BROWSER_SYNC_CONSENT_REQUIRED');
      const id=snapshot.sha256;
      let j=await journal();
      if(j&&j.snapshot!==id)fail('SNAPSHOT_RECOVERY_PENDING');
      await compareExisting(content);
      if(!j){j={version:1,snapshot:id,state:'restoring',createdAt:new Date().toISOString(),prepared:[],completed:[]};await saveJournal(j);}
      for(const d of content.databases){
        // Prepare receipt BEFORE writing: a crash after commit is recoverable.
        let planned=j.prepared.find(x=>x.name===d.name);
        if(!planned){
          const exists=(await indexedDB.databases()).find(x=>x.name===actual(d.name));
          const before=exists?await readDB(indexedDB,exists.name,exists.version):{stores:[]};
          const additions=[];
          for(const st of d.stores)for(const e of st.entries){const previous=before.stores.find(s=>s.name===st.name)?.entries||[];if(!previous.some(x=>indexedDB.cmp(x.key,e.key)===0))additions.push({store:st.name,key:await codec.encode(e.key)});}
          planned={name:d.name,additions};j.prepared.push(planned);await saveJournal(j);
        }
        await atomicDatabase(d,async (tx,dispatch)=>{
          for(const st of d.stores){const store=tx.objectStore(st.name);
            for(const e of st.entries){
              const count=await dispatch(()=>store.count(e.key));
              if(count){if(await codec.fingerprint(await dispatch(()=>store.get(e.key)))!==await codec.fingerprint(e.value))fail('SNAPSHOT_TARGET_CONFLICT');}
              else if(store.keyPath===null)await dispatch(()=>store.add(e.value,e.key));else await dispatch(()=>store.add(e.value));
            }
          }
        });
        if(!j.completed.includes(d.name))j.completed.push(d.name);await saveJournal(j);
        await afterDatabase?.(d.name);
      }
      // Storage areas have no cross-area transaction. Preflight + readback + the
      // durable journal make interruption detectable and resumption idempotent.
      // This path requires an empty/identical destination and never replaces data.
      await compareExisting(content);
      j.state='restoring-storage';await saveJournal(j);
      for(const area of ['local','sync']) {
        const current=await chromeApi.storage[area].get(null), additions=Object.create(null);
        for(const [k,v] of Object.entries(content.storage[area]))if(!Object.hasOwn(current,k))additions[k]=v;
        if(Object.keys(additions).length)await chromeApi.storage[area].set(additions);
        await afterStorage?.(area);
      }
      for(const [k,v] of Object.entries(content.localStorage))if(webStorage.getItem(k)===null)webStorage.setItem(k,v);
      const actualContent=await capture();
      // Exact full-snapshot readback, including database/store definitions.
      if(await codec.fingerprint(actualContent)!==await codec.fingerprint(content))fail('SNAPSHOT_READBACK_MISMATCH');
      j.state='verified';await saveJournal(j);
      await chromeApi.storage.local.remove(JOURNAL);
      return {verified:true,snapshot:id};
    }
    async function restore(snapshot,options={}) {
      // Caller must use an isolated destination with all readers/tasks closed.
      // Existing data is never overwritten, including defaults with different values.
      if(globalThis.navigator?.locks?.request)return navigator.locks.request(lockName,()=>resume(snapshot,options));
      return resume(snapshot,options);
    }
    async function rollbackUnlocked(snapshot) {
      const content=await codec.read(snapshot);await checkSchema(content);const j=await journal();
      if(!j||j.snapshot!==snapshot.sha256)fail('SNAPSHOT_RECOVERY_NOT_FOUND');
      if(j.state==='restoring-storage'||j.state==='verified')fail('SNAPSHOT_RECOVERY_RESUME_REQUIRED');
      // Roll back only entries proven unchanged, not an entire database or library.
      for(const p of [...j.prepared].reverse()){
        const d=content.databases.find(x=>x.name===p.name);await atomicDatabase(d,async (tx,dispatch)=>{
          for(const item of p.additions){const store=tx.objectStore(item.store),key=await codec.decode(item.key);
            if(!await dispatch(()=>store.count(key)))continue;
            const expected=d.stores.find(s=>s.name===item.store).entries.find(e=>indexedDB.cmp(e.key,key)===0);
            if(await codec.fingerprint(await dispatch(()=>store.get(key)))!==await codec.fingerprint(expected.value))fail('SNAPSHOT_ROLLBACK_CHANGED_DATA');
          }
          for(const item of p.additions){const key=await codec.decode(item.key);await dispatch(()=>tx.objectStore(item.store).delete(key));}
        });
      }
      // Storage may already have committed: do not remove possible user edits.
      // An interrupted storage step is completed by resume, not destructive rollback.
      await chromeApi.storage.local.remove(JOURNAL);
      return {rolledBackDatabaseAdditions:true,emptyDatabaseSchemasRetained:true};
    }
    async function rollback(snapshot) {
      if(globalThis.navigator?.locks?.request)return navigator.locks.request(lockName,()=>rollbackUnlocked(snapshot));
      return rollbackUnlocked(snapshot);
    }
    return {capture,exportSnapshot,restore,rollback,journal,readDB:(name,version)=>readDB(indexedDB,actual(name),version)};
  }
  return {JOURNAL,DETACHED_AUTH,createBrowserAdapter};
});
