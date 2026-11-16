(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,()=>{
  'use strict';
  const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
  function createSinglePassNoteReview({cacheStore,reviewTools,now=Date.now}){
    let claimTail=Promise.resolve();
    const inFlight=new Map();
    const stageFlights=new Map();
    const sourceRecipeVersion=()=>String(reviewTools.LITERATURE_NOTE_SOURCE_LEDGER_REVISION ?? 1);
    const reviewRecipeVersion=()=>String(reviewTools.LITERATURE_NOTE_REVIEW_PROMPT_REVISION ?? 1);
    const serial=fn=>{const next=claimTail.then(fn);claimTail=next.catch(()=>{});return next;};
    const draftResult=input=>Array.isArray(input.fields)
      ?{values:Object.fromEntries(input.fields.map(field=>[field.id,field.value])),
        sources:Object.fromEntries(input.fields.map(field=>[field.id,[...field.sources]]))}
      :{value:input.value,sources:[...input.sources]};
    function fallback(input,errorCode,cacheHit=false){return {...draftResult(input),review:{
      version:reviewTools.LITERATURE_NOTE_FINDINGS_REVIEW_VERSION,status:'unavailable',errorCode,changedCount:0,uncertainCount:0,cacheHit}};}
    function stageError(code,stageId){return Object.assign(new Error(code),{code,reviewStage:stageId});}
    async function isReviewCurrent(review){
      if(!review||!(Number(review.version)>=3)||review.status==='unavailable')return true;
      if(review.stages?.sourceRecipeVersion!==sourceRecipeVersion())return false;
      if(review.stages?.reviewRecipeVersion!==reviewRecipeVersion())return false;
      const key=review.stages?.sourceStageKey,epoch=review.stages?.sourceStageEpoch;
      if(!key||!epoch)return false;
      const source=(await cacheStore.getMany([key])).get(key);
      const ownPartialDispute=review.status==='partial'&&review.stages?.sourceDisputeToken&&
        review.stages.sourceDisputeToken===source?.disputeToken;
      return source?.status==='terminal'&&Boolean(source.result)&&source.epoch===epoch&&
        (source.integrity!=='disputed'||Boolean(ownPartialDispute));
    }
    async function disputeSource(metric,assertCurrent){
      if(!metric?.key||!metric?.epoch)return;
      return serial(async()=>{
        await assertCurrent();
        const source=(await cacheStore.getMany([metric.key])).get(metric.key);
        if(source?.epoch===metric.epoch){
          const disputeToken=crypto.randomUUID();
          await cacheStore.setMany([{...source,integrity:'disputed',disputeToken,
            errorCode:'NOTE_REVIEW_SOURCE_DISPUTED'}]);
          return disputeToken;
        }
      });
    }
    async function executeStage({input,binding,stageId,compile,validate,assertCurrent,metrics,refreshValidated=false}){
      const key='literature-note-review:stage:'+await digest(binding);
      const running=stageFlights.get(key);
      if(running){
        try{const joined=await running;await assertCurrent();
          metrics.push({stageId,key,epoch:joined.epoch,cacheHit:false,shared:true});return joined.result;
        }catch(error){
          await assertCurrent();
          // A still-current caller did not cancel another owner's source job.
          // Preserve its draft and require an explicit retry, with no new call.
          if(['CANCELLED','STALE_OPERATION','OPERATION_CANCELLED'].includes(error?.code)){
            throw stageError('NOTE_REVIEW_SHARED_SOURCE_INTERRUPTED',stageId);
          }
          throw error;
        }
      }
      const promise=(async()=>{
        let epoch;
        const prior=await serial(async()=>{
          await assertCurrent();
          const row=(await cacheStore.getMany([key])).get(key);
          if(row){
            if(row.binding!==binding)throw stageError('NOTE_REVIEW_STAGE_BINDING',stageId);
            const explicitlyRecheck=input.forceRefresh===true&&(refreshValidated||row.integrity==='disputed'||
              row.result?.units?.some(unit=>unit.status==='uncertain'));
            if(row.status==='terminal'&&row.result&&row.integrity!=='disputed'&&!explicitlyRecheck)
              return {result:row.result,epoch:row.epoch,cacheHit:true};
            // An interrupted native request is not automatically safe to repeat.
            if(input.forceRefresh!==true)throw stageError(row.errorCode||'NOTE_REVIEW_RESULT_UNKNOWN',stageId);
          }
          epoch=crypto.randomUUID();
          await cacheStore.setMany([{key,epoch,kind:'literature-note-review-stage',stageId,binding,
            ownerOperation:String(input.operationKey),status:'claimed',createdAt:now()}]);
          return null;
        });
        await assertCurrent();
        if(prior){
          const result=await validate(structuredClone(prior.result));
          await assertCurrent();
          metrics.push({stageId,key,epoch:prior.epoch,cacheHit:true});
          await input.onStage?.({stageId,status:'cached'});
          return {result,epoch:prior.epoch};
        }
        try{
          const prompt=await compile();
          await assertCurrent();
          await input.onStage?.({stageId,status:'running'});
          await assertCurrent();
          const response=await input.request(prompt,{stageId});
          await assertCurrent();
          const result=await validate(response);
          await assertCurrent();
          // Cache the accepted wire shape, not derived host witnesses/keys.
          // Revalidation regenerates that metadata against the bound source.
          await serial(async()=>{await assertCurrent();await cacheStore.setMany([{key,epoch,kind:'literature-note-review-stage',stageId,binding,
            ownerOperation:String(input.operationKey),status:'terminal',createdAt:now(),result:structuredClone(response)}]);});
          await assertCurrent();
          metrics.push({stageId,key,epoch,cacheHit:false});
          await input.onStage?.({stageId,status:'completed'});
          return {result,epoch};
        }catch(error){
          await assertCurrent();
          if(['CANCELLED','STALE_OPERATION','OPERATION_CANCELLED'].includes(error?.code))throw error;
          const errorCode=String(error?.code||'NOTE_REVIEW_UNAVAILABLE');
          await serial(async()=>{await assertCurrent();await cacheStore.setMany([{key,epoch,kind:'literature-note-review-stage',stageId,binding,
            ownerOperation:String(input.operationKey),status:'terminal',createdAt:now(),errorCode}]);});
          throw stageError(errorCode,stageId);
        }
      })();
      stageFlights.set(key,promise);
      try{return (await promise).result;}finally{if(stageFlights.get(key)===promise)stageFlights.delete(key);}
    }
    async function runPlannedReview(input,binding,assertCurrent,retryScope=null){
      const metrics=[];
      const recipeVersion=sourceRecipeVersion();
      const required=['compileLiteratureNoteSourceLedger','validateLiteratureNoteSourceLedger',
        'compileLiteratureNoteReviewPlan','validateLiteratureNoteReviewChunk','applyLiteratureNoteReview'];
      if(required.some(name=>typeof reviewTools[name]!=='function'))throw stageError('NOTE_REVIEW_PROTOCOL_UNAVAILABLE','source-ledger');
      const sourceBinding=JSON.stringify({version:reviewTools.LITERATURE_NOTE_FINDINGS_REVIEW_VERSION,
        sourceRecipeVersion:recipeVersion,
        identity:input.sourceIdentity||input.identity,documentHash:input.document.documentHash,
        evidenceSignature:input.document.signature,evidence:await digest(String(input.document.stableText||'')),
        outputLanguage:input.outputLanguage||'zh-CN'});
      try{
        // The extraction request is deliberately draft-blind and shared across fields.
        const sourceLedger=await executeStage({input,binding:sourceBinding,stageId:'source-ledger',assertCurrent,metrics,
          refreshValidated:retryScope?.sourceLedger===true,
          compile:()=>reviewTools.compileLiteratureNoteSourceLedger({document:input.document,outputLanguage:input.outputLanguage}),
          validate:ledger=>reviewTools.validateLiteratureNoteSourceLedger({document:input.document,ledger})});
        const plan=reviewTools.compileLiteratureNoteReviewPlan({fields:input.fields,document:input.document,
          sourceLedger,outputLanguage:input.outputLanguage});
        if(!Array.isArray(plan?.chunks)||!plan.chunks.length||plan.chunks.length>256||
            plan.chunks.some(chunk=>typeof chunk.chunkId!=='string'||!chunk.chunkId)||
            new Set(plan.chunks.map(chunk=>chunk.chunkId)).size!==plan.chunks.length){
          throw stageError('NOTE_REVIEW_PLAN_INVALID','review-plan');
        }
        const sourceReference={sourceStageKey:metrics[0].key,sourceStageEpoch:metrics[0].epoch,sourceRecipeVersion:recipeVersion,
          reviewRecipeVersion:reviewRecipeVersion()};
        const planBinding=await digest(JSON.stringify({binding,sourceLedger,plan,sourceReference}));
        const recoveryScope=dependencies=>{
          const known=new Set(plan.chunks.map(chunk=>chunk.chunkId));
          const validIds=Array.isArray(dependencies?.chunkIds)&&dependencies.chunkIds.length>0&&
            dependencies.chunkIds.every(id=>typeof id==='string'&&known.has(id));
          return dependencies?.requiresLedgerRebuild===false&&validIds
            ?{sourceLedger:false,chunkIds:[...new Set(dependencies.chunkIds)]}
            :{sourceLedger:true,chunkIds:[...known]};
        };
        await input.onStage?.({stageId:'review-plan',status:'planned',chunkCount:plan.chunks.length,maxRequests:1+plan.chunks.length});
        const reviews=[];
        for(let index=0;index<plan.chunks.length;index++){
          const chunk=plan.chunks[index];
          await assertCurrent();
          const review=await executeStage({input,binding:JSON.stringify({planBinding,chunkId:chunk.chunkId}),
            stageId:'chunk:'+chunk.chunkId,assertCurrent,metrics,compile:()=>chunk,
            refreshValidated:retryScope?.sourceLedger===true||retryScope?.chunkIds?.includes(chunk.chunkId),
            validate:review=>reviewTools.validateLiteratureNoteReviewChunk({fields:input.fields,document:input.document,
              sourceLedger,plan,chunkId:chunk.chunkId,review})});
          reviews.push(review);
        }
        let applied;
        if(!await isReviewCurrent({version:3,status:'completed',stages:sourceReference})){
          throw stageError('NOTE_REVIEW_SOURCE_CACHE_CHANGED','source-ledger');
        }
        try{
          applied=reviewTools.applyLiteratureNoteReview({fields:input.fields,document:input.document,sourceLedger,reviews});
        }catch(error){
          // Locally valid chunks may conflict globally. Keep their evidence,
          // but let an explicit new action refresh the rejected dependencies.
          error.reviewRetryScope=recoveryScope(error?.reviewDependencies);
          if(error.reviewRetryScope.sourceLedger)await disputeSource(metrics[0],assertCurrent);
          throw error;
        }
        const unresolvedDependencies=applied.reviewDependencies?recoveryScope(applied.reviewDependencies):null;
        const sourceDisputeToken=unresolvedDependencies?.sourceLedger
          ?await disputeSource(metrics[0],assertCurrent):null;
        return {applied,stageSummary:{plannedRequests:1+plan.chunks.length,completedStages:metrics.length,
          cachedStages:metrics.filter(item=>item.cacheHit).length,sharedStages:metrics.filter(item=>item.shared).length,
          sourceLedgerCacheHit:metrics[0]?.cacheHit===true,...sourceReference,
          ...(sourceDisputeToken?{sourceDisputeToken}:{}),
          ...(unresolvedDependencies?{retryScope:unresolvedDependencies}:{})}};
      }catch(error){
        const failure=error instanceof Error?error:stageError('NOTE_REVIEW_UNAVAILABLE','review-validation');
        failure.reviewStageSummary={completedStages:metrics.length,cachedStages:metrics.filter(item=>item.cacheHit).length,
          failedStage:failure.reviewStage||'review-validation',
          ...(failure.reviewRetryScope?{retryScope:failure.reviewRetryScope}:{})};
        throw failure;
      }
    }
    async function run(input){
      const assertCurrent=input.assertCurrent||(()=>{});
      await assertCurrent();
      const version=reviewTools.LITERATURE_NOTE_FINDINGS_REVIEW_VERSION;
      const binding=JSON.stringify({version,...(Number(version)>=3?{reviewRecipeVersion:reviewRecipeVersion()}:{}),identity:input.identity,sourceIdentity:input.sourceIdentity,documentHash:input.document.documentHash,
        evidenceSignature:input.document.signature,evidence:await digest(String(input.document.stableText||'')),
        outputLanguage:input.outputLanguage||'zh-CN',value:input.value,sources:input.sources,fields:input.fields});
      const contentKey='literature-note-review:content:'+await digest(binding);
      const operationKey='literature-note-review:operation:'+await digest(String(input.operationKey));
      const pending=inFlight.get(operationKey);
      if(pending)return pending.binding===binding?pending.promise:fallback(input,'NOTE_REVIEW_OPERATION_USED');
      const promise=(async()=>{
        let retryScope=null;
        const prior=await serial(async()=>{
          await assertCurrent();
          const rows=await cacheStore.getMany([operationKey,contentKey]);
          const operation=rows.get(operationKey),content=rows.get(contentKey);
          if(operation){
            if(operation.binding!==binding)return fallback(input,'NOTE_REVIEW_OPERATION_USED',true);
            if(operation.result&&!await isReviewCurrent(operation.result.review))return fallback(input,'NOTE_REVIEW_SOURCE_CACHE_CHANGED',true);
            return operation.status==='terminal'&&operation.result
              ?{...structuredClone(operation.result),review:{...operation.result.review,cacheHit:true}}
              :fallback(input,'NOTE_REVIEW_RESULT_UNKNOWN',true);
          }
          if(content&&input.forceRefresh!==true){
            const result=content.binding===binding&&content.status==='terminal'&&content.result
              ?await isReviewCurrent(content.result.review)
                ?{...structuredClone(content.result),review:{...content.result.review,cacheHit:true}}
                :fallback(input,'NOTE_REVIEW_SOURCE_CACHE_CHANGED',true)
              :fallback(input,'NOTE_REVIEW_RESULT_UNKNOWN',true);
            // Reusing content also consumes this action's unique review slot.
            await cacheStore.setMany([{key:operationKey,kind:'literature-note-review',binding,status:'terminal',createdAt:now(),result}]);
            return result;
          }
          if(input.forceRefresh===true&&content?.binding===binding&&content?.result?.review?.stages?.retryScope){
            retryScope=structuredClone(content.result.review.stages.retryScope);
          }
          await cacheStore.setMany([operationKey,contentKey].map(key=>({key,kind:'literature-note-review',binding,status:'claimed',createdAt:now()})));
          return null;
        });
        await assertCurrent();
        if(prior)return prior;
        let result;
        try{
          const multiple=Array.isArray(input.fields);
          let applied,stageSummary;
          if(multiple&&Number(version)>=3){
            ({applied,stageSummary}=await runPlannedReview(input,binding,assertCurrent,retryScope));
          }else{
          const prompt=multiple
            ?reviewTools.compileLiteratureNoteReview({fields:input.fields,document:input.document,outputLanguage:input.outputLanguage})
            :reviewTools.compileLiteratureNoteFindingsReview({value:input.value,document:input.document,outputLanguage:input.outputLanguage});
          await assertCurrent();
          // Exactly one request. The caller must also disable adapter retries.
          const response=await input.request(prompt);
          await assertCurrent();
          applied=multiple
            ?reviewTools.applyLiteratureNoteReview({fields:input.fields,document:input.document,review:response})
            :reviewTools.applyLiteratureNoteFindingsReview({value:input.value,sources:input.sources,document:input.document,review:response});
          }
          try{await input.validate?.(applied);}
          catch(error){
            if(stageSummary)error.reviewStageSummary={...stageSummary,failedStage:'final-validation',
              retryScope:{sourceLedger:true,chunkIds:[]}};
            throw error;
          }
          await assertCurrent();
          result={...(multiple?{values:applied.values,sources:applied.sources}:{value:applied.value,sources:applied.sources}),review:{version,
            status:applied.uncertainCount?'partial':'completed',changedCount:applied.changedCount||0,
            uncertainCount:applied.uncertainCount||0,reviewedUnitCount:applied.reviewedUnitCount||0,
            reviewedFieldCount:applied.reviewedFieldCount||0,...(stageSummary?{stages:stageSummary}:{}),cacheHit:false}};
        }catch(error){
          // A cancelled/stale caller must never receive a candidate for the new view.
          await assertCurrent();
          if(['CANCELLED','STALE_OPERATION','OPERATION_CANCELLED'].includes(error?.code))throw error;
          result=fallback(input,String(error?.code||'NOTE_REVIEW_UNAVAILABLE'));
          if(error.reviewStageSummary)result.review.stages=error.reviewStageSummary;
        }
        await assertCurrent();
        await serial(async()=>{
          await assertCurrent();
          // Validation can yield while another draft disputes the shared ledger.
          // Recheck inside the same queue used by source claims/disputes before
          // committing a review. A legitimate partial owns its exact dispute token.
          if(!await isReviewCurrent(result.review))result=fallback(input,'NOTE_REVIEW_SOURCE_CACHE_CHANGED');
          await assertCurrent();
          await cacheStore.setMany([operationKey,contentKey].map(key=>({key,kind:'literature-note-review',binding,status:'terminal',createdAt:now(),result})));
        });
        await assertCurrent();
        return result;
      })();
      inFlight.set(operationKey,{binding,promise});
      try{return await promise;}finally{if(inFlight.get(operationKey)?.promise===promise)inFlight.delete(operationKey);}
    }
    return {run,isReviewCurrent};
  }
  return {createSinglePassNoteReview};
});
