(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.SciLLM=Object.assign(root.SciLLM||{},api);})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
// PNG writes unassociated RGBA directly. Canvas' premultiplied backing store can
// change low-alpha colors, so it is used only later for existing model resizing.
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function pngChunk(type,data){const result=new Uint8Array(data.length+12),view=new DataView(result.buffer);view.setUint32(0,data.length);
 for(let i=0;i<4;i++)result[4+i]=type.charCodeAt(i);result.set(data,8);let crc=0xffffffff;
 for(let i=4;i<result.length-4;i++)crc=crcTable[(crc^result[i])&255]^(crc>>>8);view.setUint32(result.length-4,(crc^0xffffffff)>>>0);return result;}
async function encodeTiffRgbaPng(rgba,width,height,maxBytes=20*1024*1024){
 if(rgba.length!==width*height*4||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)
  throw Object.assign(new Error('TIFF_PNG_INPUT'),{code:'TIFF_PNG_INPUT'});
 if(typeof CompressionStream!=='function')throw Object.assign(new Error('TIFF_PNG_UNAVAILABLE'),{code:'TIFF_PNG_UNAVAILABLE'});
 let row=0;
 const scanlines=new ReadableStream({pull(controller){if(row===height){controller.close();return;}
  const scan=new Uint8Array(width*4+1);scan.set(rgba.subarray(row*width*4,(row+1)*width*4),1);row++;controller.enqueue(scan);}});
 const reader=scanlines.pipeThrough(new CompressionStream('deflate')).getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
   if(size+57>maxBytes)throw Object.assign(new Error('TIFF_PNG_BUDGET'),{code:'TIFF_PNG_BUDGET'});chunks.push(value);}
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const compressed=new Uint8Array(size);let offset=0;for(const part of chunks){compressed.set(part,offset);offset+=part.length;}
 const ihdr=new Uint8Array(13),header=new DataView(ihdr.buffer);header.setUint32(0,width);header.setUint32(4,height);ihdr[8]=8;ihdr[9]=6;
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',compressed),pngChunk('IEND',new Uint8Array())];
 const png=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));offset=0;for(const part of parts){png.set(part,offset);offset+=part.length;}return png;
}
return {encodeTiffRgbaPng};
});
