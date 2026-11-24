// Only Figure geometry is cached. The key addresses the raster and caption
// evidence, so a new image or legend starts a new detection.
const WebPanelIndex = (() => {
  const limit = 6 * 1024 * 1024, maxEntries = 96;
  function transaction(mode, work) {
    return new Promise((resolve,reject) => {
      const req=indexedDB.open('brevess-web-panel-geometry-v1',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('geometry',{keyPath:'key'}).createIndex('time','time');
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        const db=req.result, tx=db.transaction('geometry',mode);
        let result;
        tx.oncomplete=()=>{db.close();resolve(result);};
        tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};
        work(tx.objectStore('geometry'),value=>{result=value;});
      };
    });
  }
  function read(key) {
    return transaction('readonly',(store,done)=>{
      const request=store.get(key);
      request.onsuccess=()=>done(request.result?.panels);
    }).catch(()=>undefined);
  }
  async function save(key,panels) {
    const bytes=JSON.stringify(panels).length * 2;
    if (bytes > limit/4) return;
    // The newest geometry wins a slot. Concurrent workers share the same
    // IndexedDB write transaction for insertion and eviction.
    await transaction('readwrite',store=>{
      store.put({key,panels,bytes,time:Date.now()});
      let count=0,used=0;
      const rows=store.index('time').openCursor(null,'prev');
      rows.onsuccess=()=>{
        const cursor=rows.result;
        if (!cursor) return;
        const size=cursor.value.bytes;
        if (count>=maxEntries || used+size>limit) cursor.delete();
        else {count++;used+=size;}
        cursor.continue();
      };
    }).catch(()=>{});
  }
  return {read,save};
})();
