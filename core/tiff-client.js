(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.SciLLM=Object.assign(root.SciLLM||{},api);})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const TARGET='sci-offscreen-tiff',MAX=20*1024*1024;
const error=code=>Object.assign(new Error(code),{code});
function createTiffDecodeClient(chromeApi,ensureDocument){
 return async function decodeTiff(base64,signal){
  if(signal?.aborted)throw error('CANCELLED');
  if(typeof base64!=='string'||!base64.length||base64.length>4*Math.ceil(MAX/3))throw error('TIFF_BYTES');
  const requestId='tiff-'+crypto.randomUUID();
  return new Promise((resolve,reject)=>{let settled=false;
   const cancelRemote=()=>{try{Promise.resolve(chromeApi.runtime.sendMessage({target:TARGET,type:'TIFF_CANCEL',requestId})).catch(()=>{});}catch(_){/* Local cancellation remains authoritative. */}};
   const finish=(failure,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);failure?reject(failure):resolve(value);};
   const abort=()=>{cancelRemote();finish(error('CANCELLED'));};
   const timer=setTimeout(()=>{cancelRemote();finish(error('TIFF_DECODE_TIMEOUT'));},11000);
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return;}
   Promise.resolve().then(ensureDocument).then(()=>{
    if(settled||signal?.aborted)return;
    let pending;try{pending=chromeApi.runtime.sendMessage({target:TARGET,type:'TIFF_DECODE',requestId,base64});}
    catch(_){finish(error('TIFF_WORKER_UNAVAILABLE'));return;}
    Promise.resolve(pending).then(result=>{
     if(result?.requestId!==requestId||!result?.success)finish(error(result?.error?.code||'TIFF_DECODE_FAILED'));
     else finish(null,result);
    },()=>finish(error('TIFF_WORKER_UNAVAILABLE')));
   },()=>finish(error('TIFF_WORKER_UNAVAILABLE')));
  });
 };
}
function installTiffWorkerHost(chromeApi,WorkerClass=Worker,options={}){
 let active=null;
 chromeApi.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.target!==TARGET)return false;
  // Only the background extension context owns decode jobs; content scripts use
  // the existing scoped source-download route and cannot inject decoded results.
  if(sender?.id!==chromeApi.runtime.id||sender?.tab)return false;
  const id=String(message.requestId||'');if(!/^tiff-[a-f0-9-]{36}$/.test(id))return false;
  if(message.type==='TIFF_CANCEL'){
   if(active?.id===id)active.finish(error('CANCELLED'));return false;
  }
  if(message.type!=='TIFF_DECODE')return false;
  if(active){respond({requestId:id,success:false,error:{code:'TIFF_DECODE_BUSY'}});return false;}
  if(typeof message.base64!=='string'||message.base64.length>4*Math.ceil(MAX/3)||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(message.base64)){
   respond({requestId:id,success:false,error:{code:'TIFF_BYTES'}});return false;
  }
  let worker,timer,job;
  const finish=(failure,result)=>{
   if(active!==job)return;active=null;clearTimeout(timer);worker?.terminate();
   respond(failure?{requestId:id,success:false,error:{code:failure.code||'TIFF_DECODE_FAILED'}}:result);
  };
  active=job={id,finish};
  try{
   const binary=atob(message.base64);if(!binary.length||binary.length>MAX)throw error('TIFF_BYTES');
   const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
   worker=new WorkerClass(chromeApi.runtime.getURL('core/tiff-worker.js'));
   timer=setTimeout(()=>finish(error('TIFF_DECODE_TIMEOUT')),options.timeoutMs||10000);
   worker.onerror=()=>finish(error('TIFF_WORKER_FAILED'));
   worker.onmessage=event=>{
    const result=event.data;if(active!==job||result?.requestId!==id)return;
    if(!result.success){finish(error(result.error?.code||'TIFF_DECODE_FAILED'));return;}
    const png=new Uint8Array(result.png||[]);
    if(!png.length||png.length>MAX){finish(error('TIFF_PNG_BUDGET'));return;}
    let encoded='';for(let i=0;i<png.length;i+=16384)encoded+=String.fromCharCode(...png.subarray(i,i+16384));
    finish(null,{requestId:id,success:true,dataUrl:'data:image/png;base64,'+btoa(encoded),derivation:result.derivation});
   };
   worker.postMessage({requestId:id,bytes:bytes.buffer},[bytes.buffer]);
  }catch(failure){finish(failure);}
  return true;
 });
 return {cancel:()=>active?.finish(error('CANCELLED'))};
}
return {createTiffDecodeClient,installTiffWorkerHost};
});
