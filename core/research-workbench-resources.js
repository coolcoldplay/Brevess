(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('./research-workbench-model.js'):root.SciLLM);if(common)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,function(s){
  'use strict';
  const PATHS=new Set(['figures/inventory.json','figures/workspace-draft.json','figures/supplemental/index.json','article/structure.json','pdf/document.json','pdf/figures/manifest.json','mechanism/canvas.json']);
  function sourceIdentity(source){if(!source||typeof source.workspaceId!=='string'||!source.workspaceId||!Number.isSafeInteger(source.workspaceGeneration)||source.workspaceGeneration<1)throw s.wbError('WORKBENCH_SOURCE_IDENTITY_REQUIRED');return {workspaceId:source.workspaceId,workspaceGeneration:source.workspaceGeneration};}
  function assetToken(asset){return {relativePath:asset.relativePath,revision:asset.revision,contentHash:asset.contentHash,...(asset.writeToken?{writeToken:s.wbClone(asset.writeToken)}:{})};}
  function inventoryToken(data){return s.wbJson({workspaceGeneration:data.workspaceGeneration,assets:(data.assets || []).map(assetToken).sort((a,b)=>a.relativePath.localeCompare(b.relativePath))});}
  function validRef(ref){sourceIdentity(ref);if(typeof ref.relativePath!=='string'||!ref.relativePath||typeof ref.resourceId!=='string'||!ref.resourceId||!Number.isSafeInteger(ref.revision)||ref.revision<0||typeof ref.contentHash!=='string'||!ref.contentHash)throw s.wbError('WORKBENCH_SOURCE_REFERENCE_REQUIRED');return ref;}
  function createResearchWorkbenchResourceAdapter({call}={}) {
    if(typeof call!=='function')throw s.wbError('WORKBENCH_RESOURCE_BRIDGE_UNAVAILABLE');
    async function invoke(message){const result=await call(message);if(result?.success===false)throw s.wbError(result.error?.code || 'WORKBENCH_SOURCE_UNAVAILABLE');return result?.success===true?result.data:result;}
    async function readWorkspace(source){const identity=sourceIdentity(source);const before=await invoke({type:'ARTICLE_WORKSPACE_LIST_ASSETS',...identity});
      if(before.workspaceGeneration!==identity.workspaceGeneration)throw s.wbError('WORKBENCH_SOURCE_VERSION_CHANGED');
      const assets=[];for(const listed of before.assets || []){
        if(!PATHS.has(listed.relativePath)&&!/^figures\/supplemental\/[^/]+\.json$/.test(listed.relativePath))continue;
        const data=await invoke({type:'ARTICLE_WORKSPACE_GET_ASSET',...identity,relativePath:listed.relativePath});
        if(!data.found||data.workspaceGeneration!==identity.workspaceGeneration||s.wbJson(assetToken(data.asset))!==s.wbJson(assetToken(listed)))throw s.wbError('WORKBENCH_SOURCE_VERSION_CHANGED');
        assets.push({...s.wbClone(data.asset),source:{...identity,...assetToken(data.asset)}});
      }
      const after=await invoke({type:'ARTICLE_WORKSPACE_LIST_ASSETS',...identity});if(inventoryToken(before)!==inventoryToken(after))throw s.wbError('WORKBENCH_SOURCE_VERSION_CHANGED');
      // Public routes already project drafts. Preserve manual values and provenance verbatim.
      return {...identity,assets};
    }
    async function validateReference(ref){validRef(ref);const snapshot=await readWorkspace(ref);for(const binding of [ref,...(ref.bindings || [])]){sourceIdentity(binding);const asset=snapshot.assets.find(a=>a.relativePath===binding.relativePath);if(binding.workspaceId!==ref.workspaceId||binding.workspaceGeneration!==ref.workspaceGeneration||!asset||s.wbJson(assetToken(asset))!==s.wbJson(assetToken(binding)))throw s.wbError('WORKBENCH_SOURCE_VERSION_CHANGED');}return snapshot.assets.find(a=>a.relativePath===ref.relativePath);}
    async function ownedImageContents(ref,primary){
      const candidates=[primary];for(const binding of ref.bindings || [])if(binding.relativePath!==primary.relativePath)candidates.push(await validateReference({...binding,resourceId:ref.resourceId}));
      const id=ref.resourceId.split('::')[0];return candidates.flatMap(asset=>{
        const content=asset.content;if(!content||typeof content!=='object')return [];
        if(content.id===id||content.figureId===id)return [content];
        if(Array.isArray(content.figures))return content.figures.filter(f=>String(f.figureId || f.id)===id);
        if(content.figures&&Object.hasOwn(content.figures,id))return [content.figures[id]];
        return [];
      });
    }
    return {
      async queryLibrary(query={}){const data=await invoke({type:'LOCAL_READING_LIBRARY_QUERY',kind:'articles',query:query.query || '',scope:query.scope || 'all',page:query.page || 1,pageSize:query.pageSize || 12,tags:query.tags || [],tagMode:query.tagMode || 'any'});return s.wbClone(data);},
      selectSourceDocument(article,workspaceId){const source=article.sourceDocuments?.find(d=>d.workspaceId===workspaceId);if(!source)throw s.wbError('WORKBENCH_SOURCE_DOCUMENT_REQUIRED');sourceIdentity(source);return s.wbClone(source);},
      readWorkspace,validateReference,
      projectResources(snapshot,projection=s){
        const inventory=snapshot.assets.find(a=>a.relativePath==='figures/inventory.json');const draftAsset=snapshot.assets.find(a=>a.relativePath==='figures/workspace-draft.json');const draft=draftAsset?.content || null;
        const resources=[],historicalResources=[];const add=(asset,type,id,data,extra={})=>{const ref=validRef({...sourceIdentity(snapshot),...assetToken(asset),resourceId:id,...(extra.bindings?{bindings:s.wbClone(extra.bindings)}:{})});const row={id:`${snapshot.workspaceId}@${snapshot.workspaceGeneration}:${asset.relativePath}:${id}`,type,source:ref,data:s.wbClone(data),...extra};(extra.sourceMismatch?historicalResources:resources).push(row);return row;};
        const structure=snapshot.assets.find(a=>a.relativePath==='article/structure.json');if(structure){add(structure,'paper','article',structure.content);for(const paragraph of structure.content.paragraphs || []){const id=paragraph.paragraphId || paragraph.id;if(id)add(structure,'paragraph',String(id),paragraph);}}
        if(inventory){if(typeof projection.createFigureWorkspaceView!=='function')throw s.wbError('WORKBENCH_SOURCE_PROJECTION_UNAVAILABLE');const context=projection.prepareFigureWorkspaceViewContext?.(draft);
          for(const figure of inventory.content.figures || []){const view=projection.createFigureWorkspaceView({figure,modelResult:figure.analysis || null,draft,context});const figureId=String(view.figureId);const asset=draftAsset || inventory;
            const row=add(asset,'figure',figureId,view,{figureId,sourceMismatch:figure.sourceMismatch===true,sourceSnapshot:s.wbClone({inventory:figure,draft:draft?.figures?.[figureId] || null}),bindings:[{...sourceIdentity(snapshot),...assetToken(inventory)},...(draftAsset?[{...sourceIdentity(snapshot),...assetToken(draftAsset)}]:[])]});
            for(const panel of view.panels || [])add(asset,'panel',`${figureId}::panel:${panel.panelId}`,panel,{figureId,panelId:panel.panelId,parentResourceId:row.id,sourceMismatch:figure.sourceMismatch===true,bindings:row.bindings});
            for(const block of view.evidenceBlocks || [])add(asset,'block',`${figureId}::${block.id}`,block,{figureId,blockId:block.id,parentResourceId:row.id,sourceMismatch:figure.sourceMismatch===true,bindings:row.bindings});
            for(const panel of view.historicalPanels || [])add(asset,'panel',`${figureId}::historical-panel:${panel.panelId}`,panel,{figureId,panelId:panel.panelId,sourceMismatch:true});
            for(const block of view.historicalEvidenceBlocks || [])add(asset,'block',`${figureId}::historical:${block.id}`,block,{figureId,blockId:block.id,sourceMismatch:true});
          }
        }
        if(draftAsset&&typeof projection.createMechanismCanvasView==='function'){
          const panelMap=panels=>Array.isArray(panels)?Object.fromEntries(panels.map(panel=>[panel.panelId,s.wbClone(panel)])):s.wbClone(panels || {});
          const canvasFigure=row=>{
            const value=s.wbClone(row.data);value.panels=panelMap(value.panels);
            if(value.manualEvidenceArchive)value.manualEvidenceArchive=value.manualEvidenceArchive.map(entry=>({...entry,panels:panelMap(entry.panels)}));
            return value;
          };
          const figures=Object.fromEntries(resources.filter(r=>r.type==='figure').map(r=>[r.figureId,canvasFigure(r)]));
          const projectedDraft={...s.wbClone(draft),figures};
          // Source availability is a projection fact. Never change the saved chain or
          // rebind a legacy reference to a different currently visible Panel.
          const unavailable=new Map();
          for(const edge of projectedDraft.mechanismChain?.edges || [])for(const [index,reference]of (edge.panelEvidence || []).entries()){
            const current=figures[reference.figureId];const reason=!current?'figure_unavailable':!Object.hasOwn(current.panels,reference.panelId)?'panel_unavailable':reference.unresolved===true?'previously_unresolved':null;
            if(!reason)continue;reference.unresolved=true;
            unavailable.set(`${edge.id}\u0000${index}`,reason);
            const judgment=projectedDraft.mechanismChain.drawing?.legacyEvidence?.find(item=>item.edgeId===edge.id&&item.figureId===reference.figureId&&item.panelId===reference.panelId);
            if(judgment)judgment.needsReview=true;
          }
          const bindings=inventory?[{...sourceIdentity(snapshot),...assetToken(inventory)},{...sourceIdentity(snapshot),...assetToken(draftAsset)}]:[{...sourceIdentity(snapshot),...assetToken(draftAsset)}];
          const fragment=projection.createMechanismCanvasView(projectedDraft,{figures});
          if(typeof projection.mechanismCanvasArchive==='function')fragment.evidenceArchive=projection.mechanismCanvasArchive([...resources,...historicalResources].filter(r=>r.type==='figure').map(canvasFigure));
          for(const edge of fragment.edges)for(const evidence of edge.evidence){
            const reason=evidence.legacy&&unavailable.get(`${edge.id}\u0000${evidence.index}`);if(!reason)continue;
            evidence.needsReview=true;evidence.unresolved=true;evidence.unresolvedReason=reason;
            // Unresolved text references keep their own inline judgments. Empty
            // Figure/Panel keys cannot identify a shared classification record.
            if(!evidence.figureId||!evidence.panelIds[0])continue;
            // Preserve derived review state in the exported fragment snapshot too,
            // including legacy references that previously had no classification row.
            fragment.snapshot.drawing ||= s.wbClone(fragment.drawing);
            for(const drawing of [fragment.drawing,fragment.snapshot.drawing]){
              if(!drawing)continue;drawing.legacyEvidence ||= [];
              const judgment=drawing.legacyEvidence.find(item=>item.edgeId===edge.id&&item.figureId===evidence.figureId&&item.panelId===evidence.panelIds[0]);
              if(judgment)judgment.needsReview=true;
              else drawing.legacyEvidence.push({edgeId:edge.id,figureId:evidence.figureId,panelId:evidence.panelIds[0],types:s.wbClone(evidence.types),needsReview:true});
            }
          }
          add(draftAsset,'fragment','mechanism-canvas',fragment,{bindings,sourceSnapshot:s.wbClone(draft)});
        }
        return {resources,historicalResources};
      },
      createReference(snapshot,relativePath,resourceId){const asset=snapshot.assets.find(a=>a.relativePath===relativePath);if(!asset)throw s.wbError('WORKBENCH_SOURCE_UNAVAILABLE');return validRef({...sourceIdentity(snapshot),...assetToken(asset),resourceId});},
      async readImage({source,relativePath,mimeType,sha256}){
        const sourceAsset=await validateReference(source);
        if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw s.wbError('WORKBENCH_SOURCE_IMAGE_HASH_REQUIRED');
        const bindings=[];function collect(value){if(!value||typeof value!=='object')return;const path=value.workspacePath||value.imageAssetPath;const hash=value.sha256||value.imageSha256;if(path&&hash)bindings.push({path,hash});for(const child of Object.values(value))if(child&&typeof child==='object')collect(child);}for(const content of await ownedImageContents(source,sourceAsset))collect(content);
        if(!bindings.some(b=>b.path===relativePath&&b.hash===sha256))throw s.wbError('WORKBENCH_SOURCE_IMAGE_BINDING_MISMATCH');
        const data=await invoke({type:'ARTICLE_WORKSPACE_GET_BINARY_ASSET',workspaceId:source.workspaceId,workspaceGeneration:source.workspaceGeneration,relativePath,mimeType});
        if(!data.found)return {availability:'unavailable',reason:'LOCAL_IMAGE_UNAVAILABLE',source:s.wbClone(source)};
        let bytes;if(data.bytes)bytes=await s.wbBytes(data.bytes);else {const match=/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data.dataUrl || '');if(!match)throw s.wbError('WORKBENCH_SOURCE_IMAGE_INVALID');bytes=Uint8Array.from(atob(match[1]),n=>n.charCodeAt(0));}
        if(data.sha256!==sha256||await s.wbSha256(bytes)!==sha256)throw s.wbError('WORKBENCH_SOURCE_IMAGE_HASH_MISMATCH');await validateReference(source);return {availability:'local',bytes,sha256,mimeType,source:s.wbClone(source)};
      },
      async readInlineImage({source,dataUrl,sha256}){
        const asset=await validateReference(source);if(typeof dataUrl!=='string'||!/^data:image\/(?:png|jpeg|webp|svg\+xml);/i.test(dataUrl))return {availability:'unavailable',reason:'LOCAL_IMAGE_UNAVAILABLE'};
        let bound=false;function find(value){if(value===dataUrl)bound=true;else if(value&&typeof value==='object')for(const child of Object.values(value))find(child);}for(const content of await ownedImageContents(source,asset))find(content);if(!bound)throw s.wbError('WORKBENCH_SOURCE_IMAGE_BINDING_MISMATCH');
        const match=/^data:([^;,]+)(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);if(!match)throw s.wbError('WORKBENCH_SOURCE_IMAGE_INVALID');const bytes=match[2]?Uint8Array.from(atob(match[3]),n=>n.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(match[3]));const actual=await s.wbSha256(bytes);if(sha256&&actual!==sha256)throw s.wbError('WORKBENCH_SOURCE_IMAGE_HASH_MISMATCH');await validateReference(source);return {availability:'local',bytes,sha256:actual,mimeType:match[1],source:s.wbClone(source)};
      },
      async locateSource({projectId,source,target,expectedNavigationIdentity,expectedDocumentIdentity}){
        s.wbId(projectId);await validateReference(source);if(!expectedNavigationIdentity||!expectedDocumentIdentity||!target)throw s.wbError('WORKBENCH_LOCATE_IDENTITY_REQUIRED');
        const receipt=await invoke({type:'RESEARCH_WORKBENCH_LOCATE_SOURCE',projectId,source,target,expectedNavigationIdentity,expectedDocumentIdentity});
        if(receipt?.ready!==true||receipt.focused!==true||s.wbJson(receipt.target)!==s.wbJson(target)||s.wbJson(receipt.documentIdentity)!==s.wbJson(expectedDocumentIdentity)||s.wbJson(receipt.navigationIdentity)!==s.wbJson(expectedNavigationIdentity)||!['figure','page','paragraph','panel'].includes(receipt.precision))throw s.wbError('WORKBENCH_LOCATE_RECEIPT_MISMATCH');
        return s.wbClone(receipt);
      }
    };
  }
  return {createResearchWorkbenchResourceAdapter};
});
