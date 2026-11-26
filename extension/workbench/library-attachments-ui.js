(() => {
  'use strict';
  const rt=()=>window.__workbenchRuntime;
  const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let detailEpoch=0;
  const run=fn=>Promise.resolve().then(fn).catch(error=>rt()?.toast(error.code==='LIBRARY_CATALOG_REVISION_CONFLICT'?'资料已被其他窗口修改，请刷新后重试。':error.message||error.code));
  function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function request(extra={}){return {expectedRevision:rt().ui.catalogRevision,idempotencyKey:crypto.randomUUID(),...extra};}
  async function render(entry){
    const epoch=++detailEpoch,host=document.getElementById('catalog-attachments');if(!host||!rt()?.catalogActions)return;
    const catalog=await rt().catalogActions.read();if(epoch!==detailEpoch||!host.isConnected)return;
    const registered=catalog.entries.find(item=>item.id===entry.entryId)?.attachments||[];
    host.innerHTML=registered.map(attachment=>`<article class="catalog-source"><strong>${E(attachment.name)}</strong><p>${E(attachment.kind.toUpperCase())} · ${attachment.size===null?'大小未记录':Math.ceil(attachment.size/1024)+' KB'} · ${attachment.removedAt?'已移除':attachment.availability==='inventory-only'?'仅清单，需核验本机原件':attachment.availability==='available'?'本机已保存':'原件待核验'}</p><div class="actions" data-catalog-attachment="${E(attachment.id)}">${attachment.removedAt?'<button data-attachment-action="restore">恢复关联</button>':`<button data-attachment-action="open" ${attachment.availability==='inventory-only'?'disabled':''}>打开</button><button data-attachment-action="export" ${attachment.availability==='inventory-only'?'disabled':''}>导出原件</button><button data-attachment-action="verify">核验本机原件</button><button data-attachment-action="remove">移除关联</button>`}</div></article>`).join('');
    host.onclick=event=>{const button=event.target.closest('[data-attachment-action]');if(!button)return;const action=button.dataset.attachmentAction,attachmentId=button.closest('[data-catalog-attachment]').dataset.catalogAttachment,entryId=entry.entryId,options=request({entryId,attachmentId});button.disabled=true;
      run(async()=>{try{
        if(action==='open'){
          rt().modal('原文附件','<div id="catalog-preview"><p>正在核验附件…</p></div>');
          const container=document.getElementById('catalog-preview'),opened=await rt().catalogActions.openAttachment({entryId,attachmentId,container});
          container.querySelector('p')?.remove();
          if(opened.kind==='pdf'||opened.kind==='html-reader'){container.replaceChildren();const a=document.createElement('a');a.href=opened.url;a.target='_blank';a.rel='noopener';a.textContent=opened.kind==='pdf'?'在 PDF 阅读器打开 ↗':'在 HTML 阅读器打开 ↗';container.append(a);}
          else if(opened.kind==='download'){container.textContent='此附件请使用“导出原件”下载后打开。';}
        }else if(action==='export'){const result=await rt().catalogActions.exportAttachment({entryId,attachmentId});save(result.blob,result.name);}
        else {await rt().catalogActions[action==='verify'?'verifyAttachment':action==='restore'?'restoreAttachment':'removeAttachment'](options);await rt().loadGlobalLibrary();}
      }finally{button.disabled=false;}});
    };
  }
  if (typeof window.BroadcastChannel === 'function') {
    const updates = new BroadcastChannel('brevess-library-attachments');
    updates.onmessage = event => {
      if (event.data === 'saved' && rt()?.ui.library) run(rt().loadGlobalLibrary);
    };
  }
  window.addEventListener('brevess-catalog-detail',event=>run(()=>render(event.detail.entry)));
  window.addEventListener('brevess-catalog-action',event=>{
    const {action,entry}=event.detail;if(!rt()?.catalogActions)return;
    if(action==='add-attachment'&&entry){
      const revision=rt().ui.catalogRevision;
      rt().modal('添加原文附件','<label class="field"><span>选择 PDF 或 HTML 文件</span><input id="catalog-attachment-file" type="file" accept=".pdf,.html,.htm,application/pdf,text/html"></label><p class="muted">原件保存在本机。HTML 可在本机阅读器研读；移除关联不会删除原件。</p><p id="catalog-attachment-error" role="alert"></p><div class="modal-actions"><button id="catalog-attachment-save">添加</button></div>',dialog=>{
        dialog.querySelector('#catalog-attachment-save').onclick=()=>run(async()=>{
          const file=dialog.querySelector('input').files?.[0];if(!file)return;
          const button=dialog.querySelector('#catalog-attachment-save');button.disabled=true;
          try{const kind=/\.pdf$/i.test(file.name)?'pdf':/\.html?$/i.test(file.name)?'html':null;if(!kind)throw Error('请选择 PDF 或 HTML 文件。');
            const owner=await window.BrevessLibraryCatalogUI.ensureEntry(entry,revision);
            await rt().catalogActions.addAttachment({expectedRevision:owner.revision,idempotencyKey:crypto.randomUUID(),entryId:owner.entryId,blob:file,name:file.name,kind});dialog.close();await rt().loadGlobalLibrary();
          }catch(error){dialog.querySelector('#catalog-attachment-error').textContent=error.code||error.message;}finally{button.disabled=false;}
        });
      });
    }else if(action==='export-metadata')run(async()=>save(new Blob([await rt().catalogActions.exportMetadata()],{type:'application/json'}),'BREVESS-library-catalog-'+new Date().toISOString().slice(0,10)+'.json'));
    else if(action==='import-metadata'){
      const revision=rt().ui.catalogRevision;
      rt().modal('导入资料备份','<input id="catalog-metadata-file" type="file" accept=".json,application/json"><div id="catalog-import-preview"></div><p class="muted">此操作替换标签组、人工资料和附件清单，不包含原件字节。来源文库和课题引用保留。建议先导出当前备份。</p><p data-import-error role="alert"></p><button id="catalog-import-confirm" disabled>确认替换资料</button>',dialog=>{
        let serialized=null,selection=0,readySelection=0,readyFile=null,busy=false;
        const input=dialog.querySelector('input'),confirm=dialog.querySelector('#catalog-import-confirm'),previewHost=dialog.querySelector('#catalog-import-preview'),errorHost=dialog.querySelector('[data-import-error]');
        input.onchange=()=>{const token=++selection,file=input.files?.[0];serialized=null;readyFile=null;confirm.disabled=true;previewHost.textContent='';errorHost.textContent='';
          run(async()=>{try{if(!file)return;const content=await file.text();if(token!==selection||input.files?.[0]!==file)return;const preview=rt().catalogActions.previewMetadataImport(content);serialized=content;readySelection=token;readyFile=file;previewHost.textContent=`${file.name}：${preview.summary.papers} 篇人工资料，${preview.summary.groups} 个标签组，${preview.summary.attachments} 个附件清单。导入后附件须重新核验。`;confirm.disabled=false;}catch(error){if(token!==selection)return;serialized=null;errorHost.textContent=error.code||error.message;confirm.disabled=true;}});
        };
        confirm.onclick=()=>{if(busy||!serialized||readySelection!==selection||input.files?.[0]!==readyFile)return;busy=true;confirm.disabled=true;input.disabled=true;const content=serialized;
          run(async()=>{try{await rt().catalogActions.importMetadata({serialized:content,expectedRevision:revision,mode:'replace'});dialog.close();await rt().loadGlobalLibrary();}finally{busy=false;input.disabled=false;confirm.disabled=readySelection!==selection||!serialized;}});
        };
      });
    }
  });
})();
