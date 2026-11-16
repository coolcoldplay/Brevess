(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('../core/library-catalog-model.js'):root.BrevessLibraryCatalog,common?require('./global-library.js'):root.BrevessWorkbenchLibrary);if(common)module.exports=api;Object.assign(root.BrevessWorkbenchLibrary||={},api);})(globalThis,function(catalogModel,legacy){
  'use strict';
  const fail=code=>Object.assign(new Error(code),{code});
  const key=(prefix,value)=>value?prefix+encodeURIComponent(String(value)):'';
  const localId=paper=>key('local:',paper.paperId||paper.id||paper.workspaceId);
  const textScopes=new Set(['notes','fulltext','abstract','method','caption']);
  const authors=value=>Array.isArray(value)?value.map(author=>typeof author==='string'?author:author?.literal||author?.name||author?.fullName||author?.displayName||author?.collectiveName||'').filter(Boolean).join(', '):String(value||'');
  function sourceRecord(paper,kind){
    const inventoryOnly=kind==='import',sourceId=kind==='local'?localId(paper):kind==='radar'?key('radar:',paper.radarId+':'+paper.id):key('import:',paper.stableId||paper.id);
    const addedAt=Object.hasOwn(paper,'addedAt')?paper.addedAt:kind==='local'&&typeof paper.createdAt==='string'&&Number.isFinite(Date.parse(paper.createdAt))?new Date(paper.createdAt).toISOString():null;
    return {...paper,sourceId,sourceKind:kind,inventoryOnly,authors:authors(paper.authors),addedAt,
      sourceDocuments:(paper.sourceDocuments||[]).map(source=>({...source,...(inventoryOnly?{inventoryOnly:true}:{})}))};
  }
  function decorateRow(row){
    const sources={local:row.sourceRecords.some(source=>source.sourceKind==='local'&&!source.inventoryOnly),radar:row.sourceRecords.some(source=>source.sourceKind==='radar')};
    const localDocuments=row.sourceRecords.filter(source=>source.sourceKind==='local'&&!source.inventoryOnly).flatMap(source=>source.sourceDocuments||[]).filter(source=>!source.inventoryOnly);
    const localAttachments=(row.attachments||[]).filter(attachment=>!attachment.removedAt&&attachment.availability==='available'&&attachment.locator?.type!=='external');
    const hasLocalAttachment=localAttachments.length>0;
    let status=sources.local&&localDocuments.some(source=>source.hasOfflineSnapshot===true)?legacy.localStatus({sourceDocuments:localDocuments}):'missing';
    if(status==='missing'&&hasLocalAttachment)status=localAttachments.some(attachment=>attachment.kind==='pdf')?'complete':'unknown';
    return {...row,contentType:localDocuments.some(d=>d.contentType==='web')?'web':'literature',id:row.viewId,stableId:row.aliases.find(alias=>alias.startsWith('doi:'))||row.aliases.find(alias=>alias.startsWith('pmid:'))||row.viewId,
      tags:row.legacyTags,sources,radarRead:sources.radar,sourceKind:sources.local&&sources.radar?'mixed':sources.radar?'radar':'local',status,
      availability:sources.local||hasLocalAttachment?'local':'metadata-only',hasLocalAttachment,inventoryOnly:row.inventoryOnly&&!hasLocalAttachment,
      url:row.sourceRecords.find(source=>source.url)?.url||'',abstract:row.searchText.abstract.join('\n'),year:String(row.publicationDate||'').slice(0,4)};
  }
  function inScope(row,scope){
    if(!scope||scope==='all')return true;
    const entry=decorateRow(row);
    if(scope==='local')return entry.availability==='local';if(scope==='radar')return entry.sources.radar;
    if(scope==='literature'||scope==='web')return entry.contentType===scope;
    if(scope==='metadata-only')return entry.availability==='metadata-only';
    if(['complete','partial','unknown','missing'].includes(scope))return entry.status===scope;
    throw fail('LIBRARY_CATALOG_SCOPE_INVALID');
  }
  function createCatalogLibraryReader({adapter,radarStore,importStore,catalogStore}={}){
    if(!adapter?.queryLibrary||!catalogModel?.queryLibraryCatalog)throw fail('LIBRARY_CATALOG_READER_UNAVAILABLE');
    async function scanLocal(query='',scope='all',filters={}){
      const rows=[];let pages=1;
      for(let page=1;page<=pages;page++){
        const result=await adapter.queryLibrary({query,scope,page,pageSize:100,...filters});
        pages=Math.max(1,Number(result.pageCount||result.pages)||1);
        if(!Number.isSafeInteger(pages)||pages>1000)throw fail('LIBRARY_CATALOG_SOURCE_LIMIT');
        rows.push(...(result.items||[]));
      }
      return rows;
    }
    async function snapshot({includeRadarRead=true}={}){
      const [local,imported,catalog]=await Promise.all([scanLocal(),importStore?.readAll?.()||[],catalogStore?.read?.()||catalogModel.createEmptyLibraryCatalog()]);
      const warnings=[];let radar=[];
      if(includeRadarRead&&radarStore)try{radar=legacy.radarReadPapers(await radarStore.read());}catch(error){warnings.push({code:'RADAR_LIBRARY_UNAVAILABLE',message:error.code||error.message});}
      const records=[...local.map(paper=>sourceRecord(paper,'local')),...radar.map(paper=>sourceRecord(paper,'radar')),...imported.map(paper=>sourceRecord(paper,'import'))];
      return {records,catalog,warnings};
    }
    async function query(options={}){
      if(options.scope&&!['all','literature','web','local','radar','metadata-only','complete','partial','missing','unknown'].includes(options.scope))throw fail('LIBRARY_CATALOG_SCOPE_INVALID');
      if(options.tags!==undefined&&(!Array.isArray(options.tags)||options.tags.some(tag=>typeof tag!=='string'))||options.tagMode&&!['any','all'].includes(options.tagMode))throw fail('LIBRARY_CATALOG_QUERY_INVALID');
      const {records,catalog,warnings}=await snapshot(options),conditions=options.conditions?structuredClone(options.conditions):[];
      const queryText=String(options.query||'').trim(),field=options.field||'all',operator=options.operator||'contains';
      if(queryText)conditions.push({field,operator,value:queryText,...(options.groupId?{groupId:options.groupId}:{})});
      // Validate before issuing any auxiliary content query. External matches never
      // become fake document text, and all filtering stays before pagination.
      catalogModel.queryLibraryCatalog(records,{catalog,conditions,page:1,pageSize:1});
      const tagFilters=options.tags?.length?{tags:options.tags,tagMode:options.tagMode||'any'}:{};
      const taggedLocalIds=options.tags?.length?new Set((await scanLocal('','all',tagFilters)).map(localId)):null;
      const matchesLegacyTags=row=>!taggedLocalIds||row.sourceRecords.some(source=>source.sourceKind==='local'?taggedLocalIds.has(source.sourceId):
        options.tagMode==='all'?options.tags.every(tag=>source.legacyTags.includes(tag)):options.tags.some(tag=>source.legacyTags.includes(tag)));
      const external=new Map(),contentHits=new Map();
      for(const condition of conditions){
        if(condition.operator!=='contains'||!(condition.field==='all'||textScopes.has(condition.field)))continue;
        const hits=await scanLocal(condition.value,condition.field==='all'?'all':condition.field,tagFilters);
        external.set(condition,new Set(hits.map(localId).filter(Boolean)));
        for(const hit of hits){const id=localId(hit);if(id)contentHits.set(id,hit);}
      }
      const result=catalogModel.queryLibraryCatalog(records,{catalog,conditions,match:options.match||'all',
        sort:options.sort||catalog.preferences.sort,page:Math.max(1,Math.floor(Number(options.page)||1)),pageSize:Math.max(1,Math.min(100,Math.floor(Number(options.pageSize)||40))),includeRemoved:options.includeRemoved===true,
        includeRow:row=>inScope(row,options.scope)&&matchesLegacyTags(row),
        evaluateCondition:(row,condition,defaultMatch)=>{
          const hits=external.get(condition),sourceMatch=hits&&row.sourceRecords.some(source=>hits.has(source.sourceId));
          return defaultMatch||Boolean(sourceMatch);
        }});
      const allRows=catalogModel.buildLibraryCatalogRows(records,catalog).rows.filter(row=>options.includeRemoved===true||!row.removedAt);
      const legacyTagOptions=[...new Set(allRows.flatMap(row=>row.legacyTags))].sort((a,b)=>a.localeCompare(b));
      const scopeCounts=Object.fromEntries(['all','literature','web','local','radar','metadata-only','partial','missing'].map(scope=>[scope,allRows.filter(row=>inScope(row,scope)).length]));
      const sourceCoverage=new Map(records.filter(record=>record.sourceKind==='local'&&!record.inventoryOnly).map(record=>[record.sourceId,record.coverage||{}]));
      const items=result.items.map(row=>{
        const entry=decorateRow(row),hits=row.sourceRecords.map(source=>contentHits.get(source.sourceId)).filter(Boolean);
        const coverage=Object.fromEntries(['title',...textScopes].map(scope=>[scope,
          (scope==='title'?Boolean(row.title):row.searchText[scope]?.some(Boolean))||row.sourceRecords.some(source=>sourceCoverage.get(source.sourceId)?.[scope]===true)]));
        return {...entry,coverage,hitScopes:[...new Set(hits.flatMap(hit=>hit.hitScopes||[]))],snippets:hits.flatMap(hit=>hit.snippets||[]).slice(0,12)};
      });
      return {...result,items,scopeCounts,legacyTagOptions,counts:{...result.counts,inventoryOnly:allRows.filter(row=>decorateRow(row).inventoryOnly).length},catalogRevision:catalog.revision,groups:catalog.groups,preferences:catalog.preferences,warnings:[...warnings,...result.warnings]};
    }
    return {query,snapshot};
  }
  return {createCatalogLibraryReader,libraryCatalogSourceRecord:sourceRecord,decorateLibraryCatalogRow:decorateRow};
});
