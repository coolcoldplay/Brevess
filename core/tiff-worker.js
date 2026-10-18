/* Extension-origin worker only; fixed local dependencies, no network and no eval. */
importScripts('../vendor/tiff/pako_inflate-1.0.11.min.js','../vendor/tiff/UTIF-3.1.0.js','tiff-decoder.js','tiff-png.js');
self.onmessage=async event=>{
 const {requestId,bytes}=event.data||{};
 try {
  const raw=new Uint8Array(bytes),decoded=SciLLM.decodeBoundedTiff(raw,UTIF,pako);
  const pngBytes=await SciLLM.encodeTiffRgbaPng(decoded.rgba,decoded.width,decoded.height);
  const png=pngBytes.buffer;
  const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
  const derivation={...decoded.metadata,originalWidth:decoded.metadata.width,originalHeight:decoded.metadata.height,width:decoded.width,height:decoded.height,pageIndex:0,
    originalSha256:await hash(raw),originalBytes:raw.byteLength,pngSha256:await hash(png),pngBytes:png.byteLength,
    rgbaSha256:await hash(decoded.rgba),conversion:'orientation-applied-unassociated-rgba8-to-png'};
  self.postMessage({requestId,success:true,png,derivation},[png]);
 }catch(error){self.postMessage({requestId,success:false,error:{code:/^TIFF_[A-Z_]+$/.test(error?.code||'')?error.code:'TIFF_DECODE_FAILED'}});}
};
