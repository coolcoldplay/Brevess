(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.Workbench ||= {}, api);
})(globalThis, () => {
  'use strict';
  const groupId = 'group:document-type';
  const fault = (message, field) => Object.assign(new Error(message), {code:'WORKBENCH_AGENT_INVALID_ARGUMENT', details:{category:'argument', field, correction:message}});
  const object = (properties, required = []) => ({type:'object', properties, required, additionalProperties:false});
  const reference = {type:'string', minLength:1, maxLength:32};
  const page = {type:'integer', minimum:1};
  const definitions = [
    {name:'list_document_types', description:'分页列出论文及当前文献类型，返回本次任务可用的 ref、标签 ID、摘要线索以及目录版本。先读一页，只填写该页有依据的空白类型。', inputSchema:object({page})},
    {name:'fill_document_types', description:'按上一页的 ref、tagId 一次提交多篇论文，用户预览后原子写入。已有类型保留，无法判定的论文略过。', inputSchema:object({
      revision:{type:'integer',minimum:0}, assignments:{type:'array',minItems:1,maxItems:40,items:object({ref:reference,tagId:{type:'string'}},['ref','tagId'])}
    },['revision','assignments'])}
  ];
  function createLibraryTypeTools(reader) {
    let pages = new Map();
    function reset(){pages = new Map();}
    async function list(args) {
      if (Object.keys(args).some(k=>k!=='page') || !Number.isSafeInteger(args.page ?? 1) || (args.page ?? 1)<1) throw fault('页码从 1 开始。','page');
      const result = await reader.query({scope:'literature',page:args.page||1,pageSize:30,sort:{field:'title',direction:'asc'},includeRadarRead:true});
      const types = result.groups.find(g=>g.id===groupId&&!g.removedAt)?.tags.filter(t=>!t.removedAt).map(({id,name})=>({id,name})) || [];
      const items = result.items.map((row,index)=>{
        const ref='p'+result.page+'r'+(index+1);
        const current=(row.tagGroups||[]).find(g=>g.id===groupId)?.tags||[];
        pages.set(ref,{row,current,revision:result.catalogRevision,types});
        const abstract=(row.abstract||row.searchText?.abstract?.flat?.(2)?.join(' ')||row.snippets?.map(s=>s.text||'').join(' ')||'').slice(0,700);
        return {ref,title:row.title,current:current.map(t=>t.name),...(row.journal?{journal:row.journal}:{}),...(abstract?{abstract}:{})};
      });
      return {revision:result.catalogRevision,page:result.page,pageCount:result.pageCount,matchedCount:result.matchedCount,types,items};
    }
    function prepare(args) {
      if (!Number.isSafeInteger(args.revision)||!Array.isArray(args.assignments)||!args.assignments.length||args.assignments.length>40) throw fault('使用上一页返回的 revision 和 1 至 40 个 assignments。','assignments');
      const rows=[],preview=[],seen=new Set();
      for(const item of args.assignments){
        const candidate=pages.get(item?.ref);
        if(!candidate||candidate.revision!==args.revision||seen.has(item.ref))throw fault('使用当前页的唯一 ref 和目录版本。','assignments');
        const {row,current,types}=candidate,tag=types.find(t=>t.id===item.tagId);
        if(current.length||!tag||!row.aliases?.length||row.conflicts?.length)throw fault('仅使用上一页返回的标签，排除已有类型或身份冲突的论文。','assignments');
        seen.add(item.ref);
        rows.push({aliases:row.aliases,tagId:tag.id,...(row.addedAt?{addedAt:row.addedAt}:{})});
        preview.push({title:row.title,type:tag.name});
      }
      return {request:{expectedRevision:args.revision,idempotencyKey:crypto.randomUUID(),command:{type:'entry.types.fill',rows}},preview};
    }
    return {list,prepare,reset};
  }
  function compactLibraryResult(data){
    const {items,groups,preferences,legacyTagOptions,...rest}=data;
    return {...rest,groups:(groups||[]).filter(g=>!g.removedAt).map(g=>({id:g.id,name:g.name,tags:g.tags.filter(t=>!t.removedAt).map(t=>({id:t.id,name:t.name}))})),
      items:(items||[]).map(row=>({id:row.stableId,entryId:row.entryId,title:row.title,contentType:row.contentType,journal:row.journal,
        doi:row.doi,publicationDate:row.publicationDate,tags:row.tagIds,aliases:row.aliases?.slice(0,4),snippets:row.snippets?.slice(0,3)}))};
  }
  return {createLibraryTypeTools,libraryTypeDefinitions:definitions,compactLibraryResult};
});
