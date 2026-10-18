(function(root,factory){const api=factory(root.SciLLM||{});if(typeof module==='object'&&module.exports)module.exports=api;root.SciLLM=Object.assign(root.SciLLM||{},api);})(typeof globalThis==='undefined'?this:globalThis,function(shared){
'use strict';const MAX=20*1024*1024;
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function readBoundedTiffSourceBody(response,signal,limit=MAX){
 if(signal?.aborted)fail('CANCELLED');
 const declared=response.headers?.get('content-length');
 if(declared && (!/^\d+$/.test(declared)||Number(declared)>limit)){await response.body?.cancel?.();fail('TIFF_BYTES');}
 const reader=response.body?.getReader?.();if(!reader)fail('TIFF_STREAM_REQUIRED');
 const chunks=[];let total=0;
 const cancel=()=>{Promise.resolve(reader.cancel()).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{for(;;){if(signal?.aborted)fail('CANCELLED');const next=await reader.read();if(signal?.aborted)fail('CANCELLED');if(next.done)break;
   total+=next.value.byteLength;if(total>limit)fail('TIFF_BYTES');chunks.push(next.value);}
  if(!total)fail('TIFF_BYTES');const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
 }catch(error){cancel();throw error;}finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
}
function createTiffSourceService({fetchOriginal,cache,decode,cryptoRef=crypto}){
 const sha=async bytes=>Array.from(new Uint8Array(await cryptoRef.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 const unpack=dataUrl=>{if(typeof dataUrl!=='string'||dataUrl.length>4*Math.ceil(MAX/3)+64)fail('TIFF_BYTES');
  const raw=dataUrl.split(',')[1];if(!raw||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))fail('TIFF_BYTES');
  const binary=atob(raw);if(!binary.length||binary.length>MAX)fail('TIFF_BYTES');return Uint8Array.from(binary,c=>c.charCodeAt(0));};
 const pack=bytes=>{let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(raw);};
 return async function fetchTiff(message,options={}){
  const binding=shared.normalizeNativeTiffBinding(message.tiffBinding),signal=options.signal;
  const check=()=>{if(signal?.aborted)fail('CANCELLED');};check();
  const raw=await fetchOriginal({...message,url:binding.sourceUrl,tiffOnly:true},options);check();
  if(!['image/tiff','image/tif'].includes(raw.contentType))fail('TIFF_MIME');
  const original=unpack(raw.dataUrl);shared.inspectBoundedTiff(original);
  const originalSha256=await sha(original);check();
  const cacheKey='https://brevess-tiff-cache.invalid/'+originalSha256+'/'+shared.TIFF_DECODER_VERSION+'/page-0.png';
  let result=null,derivedCacheHit=false;
  if(['read-only','read-write'].includes(message.cacheMode)){
   const cached=await cache.get(cacheKey).catch(()=>null);check();
   const d=cached?.tiffDerivation,b=cached?.bytes;
   if(d?.originalSha256===originalSha256&&d.decoderVersion===shared.TIFF_DECODER_VERSION&&d.pageIndex===0&&
     b?.length>0&&b.length<=MAX&&await sha(b)===d.pngSha256){
    result={dataUrl:'data:image/png;base64,'+pack(b),derivation:d};derivedCacheHit=true;
   }
  }
  if(!result){result=await decode(pack(original),signal);check();
   const d=result?.derivation,png=unpack(result?.dataUrl);
   if(d?.originalSha256!==originalSha256||d.decoderVersion!==shared.TIFF_DECODER_VERSION||d.pageIndex!==0||
     d.originalBytes!==original.length||d.pngBytes!==png.length||await sha(png)!==d.pngSha256)fail('TIFF_DERIVATION_MISMATCH');
   if(message.cacheMode==='read-write')await cache.put({cacheKey,sourceUrl:binding.sourceUrl,contentType:'image/png',bytes:png,tiffDerivation:d}).catch(()=>null);
  }
  check();return {dataUrl:result.dataUrl,contentType:'image/png',sourceUrl:binding.sourceUrl,
   derivation:{...result.derivation,binding,originalSourceUrl:binding.sourceUrl,finalSourceUrl:raw.sourceUrl,
     originalContentType:raw.contentType,originalHttpStatus:raw.httpStatus || null,originalCacheHit:raw.cacheHit===true,derivedCacheHit}};
 };
}
return {readBoundedTiffSourceBody,createTiffSourceService};
});
