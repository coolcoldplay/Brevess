/* Optional catalog UI; metadata edits never change the original reading workspace. */
(() => {
  'use strict';
  const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={title:'标题',authors:'作者',journal:'期刊',publicationDate:'发表日期',addedAt:'添加日期',doi:'DOI',pmid:'PMID',legacyTags:'旧标签',attachments:'附件'};
  const fields=['title','authors','journal','publicationDate','doi','pmid'];
  const rt=()=>window.__workbenchRuntime;
  const run=fn=>Promise.resolve().then(fn).catch(error=>rt()?.toast(error.code==='LIBRARY_CATALOG_REVISION_CONFLICT'?'总库已被其他窗口修改，请刷新后重试。':error.message||error.code));
  const active=()=>rt()?.ui.libraryEntries.find(entry=>entry.id===rt().ui.librarySelected);
  const groups=()=>rt()?.ui.libraryGroups||[];
  const requestKey=()=>crypto.randomUUID();
  const scopeLabels={title:'标题',notes:'笔记',fulltext:'全文',abstract:'摘要',method:'方法',caption:'图注'};
  function addedDate(value){
    if(typeof value!=='string'||!value||!Number.isFinite(Date.parse(value)))return '';
    return new Intl.DateTimeFormat(window.SciLLM?.getInterfaceLanguage?.()==='en'?'en':'zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  }
  function coverageText(entry){
    const scopes=Object.keys(scopeLabels),covered=scopes.filter(scope=>entry.coverage?.[scope]).map(scope=>scopeLabels[scope]),missing=scopes.filter(scope=>!entry.coverage?.[scope]).map(scope=>scopeLabels[scope]);
    return `<p class="muted catalog-search-coverage">可检索内容：${covered.join('、')||'尚无已知覆盖'}${missing.length?'；未覆盖：'+missing.join('、'):''}。</p>`;
  }
  function legacyTagFilters(ui){
    const selected=ui.libraryLegacyTags||[],options=ui.libraryLegacyTagOptions||[];
    if(!selected.length&&!options.length)return '';
    return `<div class="catalog-legacy-filter"><label>来源旧标签 <select data-library-legacy-choice aria-label="添加来源旧标签筛选"><option value="">${options.length?'选择旧标签…':'暂无来源旧标签'}</option>${options.filter(tag=>!selected.includes(tag)).map(tag=>`<option value="${E(tag)}">${E(tag)}</option>`).join('')}</select></label><label>匹配方式 <select data-library-legacy-mode aria-label="旧标签匹配方式"><option value="any" ${ui.libraryLegacyTagMode!=='all'?'selected':''}>任一标签</option><option value="all" ${ui.libraryLegacyTagMode==='all'?'selected':''}>全部标签</option></select></label><button data-library-legacy-clear ${selected.length?'':'disabled'}>清除旧标签筛选</button><div class="actions" aria-label="当前来源旧标签筛选">${selected.map(tag=>`<button data-library-legacy-remove="${E(tag)}" aria-label="移除筛选标签 ${E(tag)}">${E(tag)} ×</button>`).join('')}</div><small class="muted">仅筛选原有来源标签；新标签组请使用上方“标签”检索。</small></div>`;
  }
  function changeLegacyTags(){rt().ui.libraryPage=1;run(rt().loadGlobalLibrary);}
  function searchEvidence(entry){
    const scopes=entry.hitScopes||[],snippets=entry.snippets||[];
    if(!scopes.length&&!snippets.length)return '';
    return `<details class="catalog-search-evidence" open><summary>查询命中</summary>${scopes.length?`<p>命中范围：${scopes.map(scope=>E(scopeLabels[scope]||scope)).join('、')}</p>`:''}${snippets.map(hit=>`<article><small>${E(scopeLabels[hit.scope]||hit.scope||'已保存内容')}${hit.sourceLabel?' · '+E(hit.sourceLabel):''}${hit.label?' · '+E(hit.label):''}</small><p data-i18n-ignore>${E(hit.text)}</p></article>`).join('')}</details>`;
  }
  async function execute(command,revision=rt().ui.catalogRevision){
    const result=await rt().catalogStore.execute({expectedRevision:revision,idempotencyKey:requestKey(),command});
    rt().ui.catalogRevision=result.revision;
    return result;
  }
  async function ensureEntry(entry,revision=rt().ui.catalogRevision){
    if(entry.entryId)return {entryId:entry.entryId,revision};
    if(entry.conflicts?.length)throw Error('该条目存在身份冲突，请先核对 DOI / PMID 来源。');
    const result=await execute({type:'entry.create',aliases:entry.aliases,addedAt:entry.addedAt??null},revision);
    rt().ui.librarySelected=result.targetId;
    return {entryId:result.targetId,revision:result.revision};
  }
  function table(entries,ui){
    const groupSelect=document.getElementById('library-query-group');if(groupSelect){const value=ui.libraryQueryGroup||'';groupSelect.innerHTML='<option value="">全部标签组</option>'+groups().filter(g=>!g.removedAt).map(g=>`<option value="${E(g.id)}">${E(g.name)}</option>`).join('');groupSelect.value=value;groupSelect.hidden=(ui.libraryQueryField||'all')!=='tags';}
    ui.catalogSelection ||= new Map();
    const available=new Map(groups().filter(g=>!g.removedAt).map(g=>[g.id,g]));
    const columns=(ui.libraryPreferences?.columns||['title','publicationDate','journal','addedAt']).filter(key=>labels[key]||available.has(key));
    if(!columns.includes('title'))columns.unshift('title');
    const cell=(entry,key)=>{
      if(available.has(key))return (entry.tagGroups?.find(group=>group.id===key)?.tags||[]).map(tag=>`<span class="catalog-tag">${E(tag.name)}</span>`).join('')||'<span class="muted">—</span>';
      if(key==='attachments')return String(entry.attachments?.length||0);
      if(key==='legacyTags')return E((entry.legacyTags||[]).join(' · '));
      const value=key==='addedAt'?addedDate(entry.addedAt):entry[key];
      return key==='title'?`<button class="catalog-title" type="button" title="${E(value||'未命名文献')}">${E(value||'未命名文献')}</button>${entry.removedAt?'<small>已移除</small>':''}`:`<span title="${E(value||'')}">${E(value||'—')}</span>`;
    };
    const exactNote=ui.libraryQueryOperator==='exact'&&['all','notes','fulltext','abstract','method','caption'].includes(ui.libraryQueryField||'all')?'<p class="muted catalog-search-coverage">正文等内容的精确匹配仅检查已取得的索引文本；旧来源仅提供包含检索，未覆盖内容不会作为精确命中。可改用“包含”继续检索。</p>':'';
    return `${legacyTagFilters(ui)}${exactNote}<div class="catalog-summary" role="status"><span>${ui.libraryMatchedCount??entries.length} / ${ui.libraryTotalCount??entries.length} 篇${ui.libraryIncludeRemoved?' · 含已移除条目':''}</span>${ui.catalogSelection.size?`<button type="button" data-catalog-batch-remove>移除选中（${ui.catalogSelection.size}）</button>`:''}</div><div class="catalog-table-scroll"><table class="catalog-table"><thead><tr><th class="catalog-pick"><input type="checkbox" data-catalog-select-all aria-label="选择本页全部条目" ${entries.length&&entries.every(e=>ui.catalogSelection.has(e.id))?'checked':''}></th>${columns.map(key=>`<th scope="col" aria-sort="${ui.catalogHeaderSort?.field===key?(ui.catalogHeaderSort.direction==='asc'?'ascending':'descending'):'none'}"><button type="button" data-catalog-sort="${E(key)}">${E(labels[key]||available.get(key)?.name)}${ui.catalogHeaderSort?.field===key?(ui.catalogHeaderSort.direction==='asc'?' ↑':' ↓'):''}</button></th>`).join('')}</tr></thead><tbody>${entries.map(entry=>`<tr data-library-entry="${E(entry.id)}" aria-selected="${entry.id===ui.librarySelected}" class="${entry.id===ui.librarySelected?'selected':''}"><td class="catalog-pick"><input type="checkbox" data-catalog-pick="${E(entry.id)}" aria-label="选择 ${E(entry.title)}" ${ui.catalogSelection.has(entry.id)?'checked':''}></td>${columns.map(key=>`<td class="catalog-col-${labels[key]?key:'tags'}" data-i18n-ignore>${cell(entry,key)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function detail(entry){
    const getURL=path=>window.chrome?.runtime?.getURL?.(path)||new URL('../'+path,location.href).href;
    const online=window.SciLLM.libraryOnlineUrl(entry.url)||(entry.doi?`https://doi.org/${encodeURIComponent(entry.doi)}`:'');
    const canonical=value=>{try{return new URL(value).href;}catch{return '';}};
    const primaryLinks=new Set([online,entry.pmid?'https://pubmed.ncbi.nlm.nih.gov/'+entry.pmid+'/':''].map(canonical).filter(Boolean));
    const sources=(entry.sourceDocuments||[]).map((source,index)=>{
      const description=window.SciLLM.describeLibrarySource(source,{getURL});
      return `<article class="catalog-source" data-catalog-source-index="${index}">${String(source.title||source.fileName||'').trim()===String(entry.title||'').trim()?'':`<strong>${E(source.title||source.fileName||'原文版本')}</strong>`}<p>${E(description.status)}</p><div class="actions">${source.contentType==='web'&&source.hasSavedWebContent&&/^workspace:[a-f0-9]{64}$/.test(source.workspaceId)?`<a class="btn" href="../web-reading-archive.html?workspace=${encodeURIComponent(source.workspaceId)}" target="_blank" rel="noopener noreferrer">已存网页内容 ↗</a>`:''}${description.links.filter(link=>!primaryLinks.has(canonical(link.url))).map(link=>`<a class="btn" href="${E(link.url)}" target="_blank" rel="noopener noreferrer">${E(link.label)} ↗</a>`).join('')}</div>${source.hasOfflineSnapshot&&source.workspaceId?`<button type="button" data-action-icon="none" data-reading-pack="${E(source.workspaceId)}" data-generation="${Number(source.workspaceGeneration)||1}">导出完整阅读包</button>`:''}<div data-library-source-controls></div></article>`;
    }).join('');
    const tags=groups().filter(group=>!group.removedAt).map(group=>`<label class="field"><span>${E(group.name)}</span><select data-catalog-tags="${E(group.id)}" ${group.mode==='multiple'?'multiple':''} ${entry.removedAt?'disabled':''} aria-label="${E(group.name)}">${group.mode==='single'?'<option value="">未标记</option>':''}${group.tags.filter(tag=>!tag.removedAt).map(tag=>`<option value="${E(tag.id)}" ${entry.tagIds.includes(tag.id)?'selected':''}>${E(tag.name)}</option>`).join('')}</select>${group.mode==='multiple'?'<small>可按 Ctrl / Command 多选</small>':''}</label>`).join('');
    return `<section class="catalog-detail-actions"><div data-library-source-editor></div>${searchEvidence(entry)}<div class="actions"><button data-catalog-action="edit">编辑资料</button><button data-catalog-action="${entry.removedAt?'restore':'remove'}">${entry.removedAt?'恢复条目':'移除条目'}</button>${online?`<a class="btn" href="${E(online)}" target="_blank" rel="noopener noreferrer">在线原文 ↗</a>`:''}</div><p class="muted">添加日期：${E(addedDate(entry.addedAt)||'旧记录未记载')}</p>${tags}<details class="catalog-coverage-details"><summary>检索覆盖情况</summary>${coverageText(entry)}</details><details open><summary>原文与附件</summary>${sources||'<p class="muted">没有原文版本，可添加 PDF / HTML 附件。</p>'}<div id="catalog-attachments"></div><button data-catalog-action="add-attachment" ${entry.removedAt?'disabled':''}>添加 PDF / HTML 附件</button></details></section>`;
  }
  function editDialog(entry){
    const runtime=rt(),revision=runtime.ui.catalogRevision;
    runtime.modal(entry?'编辑文献资料':'新增文献',`<form id="catalog-edit-form">${fields.map(key=>`<label class="field"><span>${labels[key]}</span><input name="${key}" value="${E(entry?.[key]??'')}" ${key==='title'?'required':''}></label>`).join('')}<p class="muted">清空字段会保留为空；旧来源和原文保持原样。</p><p data-catalog-error role="alert"></p><div class="modal-actions"><button type="submit">保存</button></div></form>`,dialog=>{
      dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const save=event.submitter;save.disabled=true;run(async()=>{
        try{
          const values=Object.fromEntries(new FormData(event.target));
          if(entry){const owner=await ensureEntry(entry,revision);await execute({type:'entry.update',entryId:owner.entryId,fields:values},owner.revision);}
          else {const aliases=window.BrevessLibraryCatalog.libraryCatalogIdentityAliases({...values,sourceId:'manual:'+crypto.randomUUID()});const result=await execute({type:'entry.create',aliases,fields:values},revision);runtime.ui.librarySelected=result.targetId;}
          dialog.close();await runtime.loadGlobalLibrary();
        }catch(error){dialog.querySelector('[data-catalog-error]').textContent=error.code||error.message;}finally{save.disabled=false;}
      });};
    });
  }
  function columnsDialog(){
    const runtime=rt(),revision=runtime.ui.catalogRevision,options=[...Object.entries(labels),...groups().filter(g=>!g.removedAt).map(g=>[g.id,g.name])],current=runtime.ui.libraryPreferences?.columns||[];
    runtime.modal('显示列',`<form id="catalog-columns">${options.map(([key,name])=>`<label class="catalog-check"><input type="checkbox" name="column" value="${E(key)}" ${current.includes(key)||key==='title'?'checked':''} ${key==='title'?'disabled':''}>${E(name)}</label>`).join('')}<div class="modal-actions"><button>保存显示列</button></div></form>`,dialog=>{
      dialog.querySelector('form').onsubmit=event=>{event.preventDefault();run(async()=>{const columns=['title',...new FormData(event.target).getAll('column').filter(key=>key!=='title')];await execute({type:'preferences.set',preferences:{columns}},revision);dialog.close();await runtime.loadGlobalLibrary();});};
    });
  }
  function groupsDialog(){
    const runtime=rt(),revision=runtime.ui.catalogRevision;
    runtime.modal('标签组与标签',`<div class="catalog-group-editor">${groups().map(group=>`<section data-catalog-group="${E(group.id)}"><div class="actions"><input data-group-name aria-label="标签组名称" value="${E(group.name)}"><select data-group-mode aria-label="标签选择方式"><option value="single" ${group.mode==='single'?'selected':''}>单选</option><option value="multiple" ${group.mode==='multiple'?'selected':''}>多选</option></select><button data-group-save>保存组</button><button data-group-toggle>${group.removedAt?'恢复组':'移除组'}</button></div>${group.tags.map(tag=>`<div class="actions" data-catalog-tag="${E(tag.id)}"><input data-tag-name aria-label="标签名称" value="${E(tag.name)}"><button data-tag-save>保存标签</button><button data-tag-toggle>${tag.removedAt?'恢复':'移除'}</button></div>`).join('')}<div class="actions"><input data-new-tag placeholder="新标签名称" aria-label="新标签名称"><button data-tag-add ${group.removedAt?'disabled':''}>添加标签</button></div></section>`).join('')}<section><input id="catalog-new-group" placeholder="新标签组名称" aria-label="新标签组名称"><button data-group-add>新增标签组</button></section><p data-catalog-error role="alert"></p></div>`,dialog=>{
      dialog.onclick=event=>{const button=event.target.closest('button');if(!button||button.hasAttribute('data-close'))return;const section=button.closest('[data-catalog-group]'),group=groups().find(g=>g.id===section?.dataset.catalogGroup),tag=group?.tags.find(t=>t.id===button.closest('[data-catalog-tag]')?.dataset.catalogTag);let command;
        if(button.hasAttribute('data-group-add'))command={type:'group.create',name:dialog.querySelector('#catalog-new-group').value,mode:'single'};
        if(button.hasAttribute('data-group-save'))command={type:'group.update',groupId:group.id,name:section.querySelector('[data-group-name]').value,mode:section.querySelector('[data-group-mode]').value};
        if(button.hasAttribute('data-group-toggle'))command={type:group.removedAt?'group.restore':'group.remove',groupId:group.id};
        if(button.hasAttribute('data-tag-add'))command={type:'tag.create',groupId:group.id,name:section.querySelector('[data-new-tag]').value};
        if(button.hasAttribute('data-tag-save'))command={type:'tag.update',groupId:group.id,tagId:tag.id,name:button.closest('[data-catalog-tag]').querySelector('[data-tag-name]').value};
        if(button.hasAttribute('data-tag-toggle'))command={type:tag.removedAt?'tag.restore':'tag.remove',groupId:group.id,tagId:tag.id};
        if(command){button.disabled=true;run(async()=>{try{await execute(command,revision);await runtime.loadGlobalLibrary();groupsDialog();}catch(error){dialog.querySelector('[data-catalog-error]').textContent=error.code||error.message;button.disabled=false;}});}
      };
    });
  }
  // Capture only catalog controls so row navigation cannot consume a checkbox click.
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-catalog-pick],[data-catalog-select-all],[data-catalog-sort],[data-catalog-batch-remove]');
    if(!target||!rt())return;
    event.stopImmediatePropagation();const runtime=rt(),ui=runtime.ui;ui.catalogSelection ||= new Map();
    if(target.hasAttribute('data-catalog-pick')){const id=target.dataset.catalogPick,entry=ui.libraryEntries.find(e=>e.id===id);if(target.checked&&entry)ui.catalogSelection.set(id,entry);else ui.catalogSelection.delete(id);runtime.renderLibraryView();}
    else if(target.hasAttribute('data-catalog-select-all')){for(const entry of ui.libraryEntries){if(target.checked)ui.catalogSelection.set(entry.id,entry);else ui.catalogSelection.delete(entry.id);}runtime.renderLibraryView();}
    else if(target.hasAttribute('data-catalog-sort')){const field=target.dataset.catalogSort;ui.catalogHeaderSort={field,direction:ui.catalogHeaderSort?.field===field&&ui.catalogHeaderSort.direction==='asc'?'desc':'asc'};ui.libraryPage=1;run(runtime.loadGlobalLibrary);}
    else if(!ui.catalogBatchBusy){const selected=[...ui.catalogSelection.values()];if(!selected.length||!confirm('从总库删除选中的 '+selected.length+' 个条目？原文和已有课题引用保留，可在“含已移除”中恢复。'))return;
      ui.catalogBatchBusy=true;target.disabled=true;run(async()=>{let completed=0;try{for(const entry of selected){const owner=await ensureEntry(entry);await execute({type:'entry.remove',entryId:owner.entryId},owner.revision);ui.catalogSelection.delete(entry.id);completed++;}runtime.toast('已删除 '+completed+' 个条目');}catch(error){runtime.toast('已删除 '+completed+' 个；其余保留。'+(error.code||error.message));}finally{ui.catalogBatchBusy=false;await runtime.loadGlobalLibrary();}});
    }
  },true);
  document.addEventListener('change',event=>{if(event.target.id==='library-view-sort'&&rt())rt().ui.catalogHeaderSort=null;},true);
  document.addEventListener('click',event=>{
    const clear=event.target.closest('[data-library-legacy-clear]'),remove=event.target.closest('[data-library-legacy-remove]');
    if(rt()&&(clear||remove)){rt().ui.libraryLegacyTags=clear?[]:(rt().ui.libraryLegacyTags||[]).filter(tag=>tag!==remove.dataset.libraryLegacyRemove);changeLegacyTags();return;}
    const button=event.target.closest('[data-catalog-action]');if(!button||!rt())return;
    const action=button.dataset.catalogAction,entry=active();
    if(action==='new')editDialog();
    else if(action==='edit'&&entry)editDialog(entry);
    else if(action==='columns')columnsDialog();
    else if(action==='groups')groupsDialog();
    else if(action==='removed'){rt().ui.libraryIncludeRemoved=!rt().ui.libraryIncludeRemoved;rt().ui.libraryPage=1;run(rt().loadGlobalLibrary);}
    else if(['remove','restore'].includes(action)&&entry){
      if(action==='remove'&&!confirm('从总库移除此条目？原文、缓存和已有课题引用会保留，可在“含已移除”中恢复。'))return;
      run(async()=>{const owner=await ensureEntry(entry);await execute({type:'entry.'+action,entryId:owner.entryId},owner.revision);await rt().loadGlobalLibrary();});
    }
    else window.dispatchEvent(new CustomEvent('brevess-catalog-action',{detail:{action,entry}}));
  });
  document.addEventListener('change',event=>{
    const legacyChoice=event.target.closest('[data-library-legacy-choice]'),legacyMode=event.target.closest('[data-library-legacy-mode]');
    if(rt()&&(legacyChoice||legacyMode)){
      if(legacyChoice){const tags=rt().ui.libraryLegacyTags||[];if(!legacyChoice.value||tags.includes(legacyChoice.value))return;rt().ui.libraryLegacyTags=[...tags,legacyChoice.value];}
      if(legacyMode)rt().ui.libraryLegacyTagMode=legacyMode.value==='all'?'all':'any';changeLegacyTags();return;
    }
    const select=event.target.closest('[data-catalog-tags]');if(select&&active()){
      const entry=active(),groupId=select.dataset.catalogTags,tagIds=[...select.selectedOptions].map(option=>option.value).filter(Boolean),revision=rt().ui.catalogRevision;select.disabled=true;
      run(async()=>{try{const owner=await ensureEntry(entry,revision);await execute({type:'entry.tags.set',entryId:owner.entryId,groupId,tagIds},owner.revision);await rt().loadGlobalLibrary();}finally{select.disabled=false;}});
    }
    if(['library-query-field','library-query-operator','library-query-group'].includes(event.target.id)){
      rt().ui.libraryQueryField=document.getElementById('library-query-field').value;rt().ui.libraryQueryOperator=document.getElementById('library-query-operator').value;rt().ui.libraryQueryGroup=document.getElementById('library-query-group').value;document.getElementById('library-query-group').hidden=rt().ui.libraryQueryField!=='tags';
    }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='library-view-query'){event.preventDefault();document.querySelector('[data-action="library-view-search"]')?.click();}});
  window.BrevessLibraryCatalogUI={table,detail,ensureEntry,execute};
})();
