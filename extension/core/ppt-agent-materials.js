(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,function(){
  'use strict';
  const fail=code=>Object.assign(new Error(code),{code}),MAX_CHUNK=32768;
  const bytes=value=>typeof value==='string'?new Blob([value],{type:'text/plain'}):value instanceof Blob?value:value instanceof ArrayBuffer||ArrayBuffer.isView(value)?new Blob([value]):(()=>{throw fail('PPT_MATERIAL_DATA_INVALID');})();
  function createPptMaterialReader(options){
    let current=null;
    const id=()=>crypto.randomUUID();
    function check(args,ready=true){const row=current;if(!row||row.id!==args.sessionId)throw fail('PPT_SESSION_NOT_FOUND');if(row.status==='cancelled')throw fail('CANCELLED');if(Date.now()-row.createdAt>900000)throw fail('PPT_SESSION_EXPIRED');if(row.record){if(options.getRecord()!==row.record)throw fail('PPT_EXPORT_SOURCE_CHANGED');options.assertSource(row.record,true);}if(ready&&row.status!=='ready')throw fail(row.error||'PPT_MATERIAL_NOT_READY');return row;}
    const status=row=>({sessionId:row.id,status:row.status,...(row.error?{error:row.error}:{}),progress:row.record?.operation?.progress||options.getProgress?.(row.operationId)||{}});
    async function prepare(args={}){
      const request=JSON.stringify(args.customization||{});
      if(current&&Date.now()-current.createdAt>900000){options.cancel(current.operationId);current.status='cancelled';current.files=[];}
      if(current&&current.requestKey===args.requestKey&&current.status!=='cancelled'){if(current.request!==request)throw fail('PPT_REQUEST_KEY_CONFLICT');check({sessionId:current.id},false);return status(current);}
      if(typeof args.requestKey!=='string'||args.requestKey.length<8||args.requestKey.length>160)throw fail('PPT_REQUEST_KEY_REQUIRED');
      if(current&&['preparing','ready'].includes(current.status))throw fail('PPT_SESSION_BUSY');
      if(new TextEncoder().encode(request).length>16384)throw fail('PPT_CUSTOMIZATION_LIMIT');
      const row={id:id(),requestKey:args.requestKey,request,operationId:'ppt-agent-'+id(),createdAt:Date.now(),status:'preparing',record:null,files:[]};current=row;
      row.promise=Promise.resolve().then(()=>options.prepare({operationId:row.operationId,customization:args.customization})).then(async result=>{
        if(row.status==='cancelled')return;const record=options.getRecord();if(!result?.success||record?.operationId!==row.operationId)throw fail('PPT_PREPARATION_FAILED');row.record=record;check({sessionId:row.id},false);
        if(!Array.isArray(record.entries)||record.entries.length>1024)throw fail('PPT_MATERIAL_LIMIT');let total=0;const paths=new Set();
        for(const entry of record.entries){if(typeof entry.path!=='string'||!entry.path||entry.path.length>1024||entry.path.includes('\\')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||paths.has(entry.path))throw fail('PPT_MATERIAL_PATH_INVALID');paths.add(entry.path);const blob=bytes(entry.data);total+=blob.size;if(blob.size>67108864||total>268435456)throw fail('PPT_MATERIAL_LIMIT');
          const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());row.files.push({id:'file-'+row.files.length,path:entry.path,byteLength:blob.size,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),contentType:blob.type||(/\.png$/i.test(entry.path)?'image/png':/\.jpe?g$/i.test(entry.path)?'image/jpeg':'application/octet-stream'),blob});
        }
        check({sessionId:row.id},false);row.status='ready';
      }).catch(error=>{if(row.status!=='cancelled'){row.status='failed';row.error=error.code||'PPT_PREPARATION_FAILED';}});
      return status(row);
    }
    async function execute(name,args={}){
      if(name==='ppt.prepare')return prepare(args);
      if(name==='ppt.cancel'){const row=current;if(!row||row.id!==args.sessionId)throw fail('PPT_SESSION_NOT_FOUND');row.status='cancelled';options.cancel(row.operationId);row.files=[];return status(row);}
      const row=check(args,name!=='ppt.status');
      if(name==='ppt.status')return status(row);
      if(name==='ppt.get_manifest')return{...status(row),title:row.record.bundle.title,sourceUrl:row.record.bundle.url,figureCount:row.record.bundle.figures.length,missingImageFigureIds:row.record.bundle.missingImageFigureIds,customization:row.record.bundle.customization,includes:['图像与图注','解读与跨图逻辑','当前文献正文上下文','当前文献问答与人工标注'],files:row.files.map(({blob,...entry})=>entry),maxChunkBytes:MAX_CHUNK,materialOnly:true};
      if(name==='ppt.read_chunk'){const file=row.files.find(f=>f.id===args.fileId),offset=args.offset,length=args.length??MAX_CHUNK;if(!file)throw fail('PPT_FILE_NOT_FOUND');if(!Number.isSafeInteger(offset)||offset<0||offset>file.byteLength||!Number.isSafeInteger(length)||length<1||length>MAX_CHUNK)throw fail('PPT_CHUNK_RANGE');const part=new Uint8Array(await file.blob.slice(offset,offset+length).arrayBuffer());check(args);let binary='';for(const b of part)binary+=String.fromCharCode(b);return{sessionId:row.id,fileId:file.id,offset,nextOffset:offset+part.length,eof:offset+part.length===file.byteLength,encoding:'base64',data:btoa(binary),sha256:file.sha256,totalBytes:file.byteLength};}
      throw fail('PPT_TOOL_NOT_FOUND');
    }
    return{execute};
  }
  function createPptAgentAccess(options){
    let consent=null,closed=false;
    const canonical=v=>v&&typeof v==='object'?JSON.stringify(Object.keys(v).sort().map(k=>[k,v[k]])):JSON.stringify(v),same=(a,b)=>canonical(a)===canonical(b);
    function check(target){if(closed||!same(options.getTarget(),target)){consent=null;throw fail('DOCUMENT_CONTEXT_CHANGED');}}
    async function execute(name,args){check(args.target);const target=structuredClone(args.target);let readConsent=null;
      if(name==='ppt.read_chunk'){
        const manifest=await options.call('ppt.get_manifest',args);check(target);const key=JSON.stringify([canonical(target),args.sessionId,manifest.files.map(f=>[f.id,f.sha256])]);
        if(consent?.key!==key||consent.expiresAt<=Date.now()){const intent={key,approved:false,denied:false,expiresAt:Date.now()+900000};consent=intent;options.approval(manifest,approved=>{try{check(target);if(consent===intent){intent.approved=approved===true;intent.denied=!intent.approved;}}catch(_){}});}
        if(consent.denied)throw fail('PPT_MATERIAL_ACCESS_DENIED');if(!consent.approved||consent.expiresAt<=Date.now())throw fail('PENDING_HUMAN_ACTION');
        readConsent=consent;
      }
      const result=await options.call(name,args);check(target);
      if(readConsent&&(consent!==readConsent||!readConsent.approved||readConsent.expiresAt<=Date.now()))throw fail('PPT_MATERIAL_ACCESS_REVOKED');
      if(name==='ppt.cancel')consent=null;return result;
    }
    return{execute,revoke(){consent=null;},close(){consent=null;closed=true;}};
  }
  function showPptAgentApproval(document,manifest,decide){
    const dialog=document.createElement('dialog');dialog.className='workspace-figure-input-dialog';dialog.setAttribute('aria-label','确认向当前 Agent 提供 PPT 材料');const add=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;dialog.append(n);return n;};
    Object.assign(dialog.style,{margin:'auto',padding:'20px',width:'min(560px, calc(100vw - 32px))',maxHeight:'calc(100vh - 32px)',overflow:'auto',boxSizing:'border-box',font:'14px/1.6 system-ui'});
    add('h3','提供本篇 PPT 材料');add('p',manifest.title);add('p',`${manifest.figureCount} 张 Figure，${manifest.files.length} 个文件。包含：${manifest.includes.join('、')}。`);if(manifest.missingImageFigureIds.length)add('p','缺图：'+manifest.missingImageFigureIds.join('、'));add('p','允许当前 Agent 分块读取这些材料用于制作 PPT。此操作不会修改文献；不会自动上传到其他制作服务。');let done=false;const finish=value=>{if(done)return;done=true;dialog.close();dialog.remove();decide(value);};const yes=add('button','允许读取本篇材料'),no=add('button','取消');for(const button of [yes,no])Object.assign(button.style,{padding:'8px 12px',margin:'12px 8px 0 0',border:'1px solid #bdc9cd',borderRadius:'6px',background:'#fff',font:'inherit'});yes.dataset.pptAgentApprove='true';yes.onclick=()=>finish(true);no.onclick=()=>finish(false);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});document.body.append(dialog);dialog.showModal();
  }
  return{createPptMaterialReader,createPptAgentAccess,showPptAgentApproval};
});
