(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM||(root.SciLLM={}),api);})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function cloneFigureSourceData(value){
  const seen=new Set();
  function copy(input,depth){
   if(depth>96)throw Object.assign(new Error('FIGURE_SOURCE_SNAPSHOT_INVALID'),{code:'FIGURE_SOURCE_SNAPSHOT_INVALID'});
   if(input===null||typeof input!=='object')return typeof input==='function'||typeof input==='symbol'?undefined:input;
   if(typeof input.nodeType==='number'||seen.has(input))throw Object.assign(new Error('FIGURE_SOURCE_SNAPSHOT_INVALID'),{code:'FIGURE_SOURCE_SNAPSHOT_INVALID'});
   seen.add(input);let result;
   if(Array.isArray(input)){
    result=new Array(input.length);
    for(let index=0;index<input.length;index++)if(Object.prototype.hasOwnProperty.call(input,index))result[index]=copy(input[index],depth+1);
   }else result=Object.fromEntries(Object.keys(input).map(key=>[key,copy(input[key],depth+1)]));
   seen.delete(input);return Object.freeze(result);
  }
  return copy(value,0);
 }
 function createFigureCanonicalSourceLease(input){
  if(!input||!input.operationId||!Number.isSafeInteger(input.epoch)||input.epoch<1||!input.contentDocumentIdentity||!input.navigationIdentity||
   !Number.isSafeInteger(input.workspaceLifecycle)||!Number.isSafeInteger(input.structureSequence)||input.structureSequence!==input.manualPreparedSequence||
   !input.documentId||!input.documentHash||input.canonicalSnapshot?.documentHash!==input.documentHash||!input.sourceOwnerIdentity||!input.workspaceId||!Number.isSafeInteger(input.workspaceGeneration)||input.workspaceGeneration<1)
   throw Object.assign(new Error('正文尚未稳定，请刷新文献后重新解图。'),{code:'FIGURE_SOURCE_ADMISSION_UNSTABLE'});
  return cloneFigureSourceData(input);
 }
 function validFigureSourceOwner(value){
  return Boolean(value&&['operationId','contentDocumentIdentity','navigationIdentity'].every(key=>typeof value[key]==='string'&&value[key].trim())&&
   ['epoch','workspaceLifecycle'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0));
 }
 function validFigureSourceLeaseIdentity(value){
  return Boolean(validFigureSourceOwner(value)&&['documentId','documentHash','sourceOwnerIdentity','workspaceId'].every(key=>typeof value[key]==='string'&&value[key].trim())&&
   Number.isSafeInteger(value.workspaceGeneration)&&value.workspaceGeneration>=1&&typeof value.workspaceContentHash==='string');
 }
 function figureSourceLeaseIdentityMatches(lease,current){
  return Boolean(validFigureSourceLeaseIdentity(lease)&&validFigureSourceLeaseIdentity(current)&&['operationId','epoch','contentDocumentIdentity','navigationIdentity','workspaceLifecycle','documentId','documentHash','sourceOwnerIdentity','workspaceId','workspaceGeneration','workspaceContentHash'].every(key=>lease[key]===current[key]));
 }
 function isExactFigureTerminalReceipt(receipt,expected){
  const task=receipt?.task;
  const actual={operationId:task?.operationId,epoch:task?.epoch,workspaceLifecycle:task?.workspaceLifecycle,contentDocumentIdentity:receipt?.contentDocumentIdentity,navigationIdentity:receipt?.navigationIdentity};
  return Boolean(validFigureSourceOwner(actual)&&validFigureSourceOwner(expected)&&receipt?.receiptOnly===true&&task?.terminal===true&&task.module==='figures'&&task.documentId===expected.contentDocumentIdentity&&
   ['operationId','epoch','workspaceLifecycle'].every(key=>task[key]===expected[key])&&
   receipt.contentDocumentIdentity===expected.contentDocumentIdentity&&receipt.navigationIdentity===expected.navigationIdentity&&
   ['completed','partial','failed','stopped'].includes(task.status));
 }
 return{cloneFigureSourceData,createFigureCanonicalSourceLease,figureSourceLeaseIdentityMatches,isExactFigureTerminalReceipt};
});
