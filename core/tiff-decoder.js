(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.SciLLM=Object.assign(root.SciLLM||{},api);})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const TIFF_DECODER_VERSION='utif-3.1.0-pako-1.0.11-brevess-2';
const TIFF_LIMITS=Object.freeze({bytes:20*1024*1024,edge:8192,pixels:16000000,workingBytes:256*1024*1024,tags:512,values:4096,strips:4096,timeoutMs:10000});
const fail=code=>{throw Object.assign(new Error(code),{code});};
function inspectBoundedTiff(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 if(bytes.length<8||bytes.length>TIFF_LIMITS.bytes)fail('TIFF_BYTES');
 const little=bytes[0]===73&&bytes[1]===73;
 if(!little&&!(bytes[0]===77&&bytes[1]===77))fail('TIFF_MAGIC');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const range=(o,n)=>{if(!Number.isSafeInteger(o)||!Number.isSafeInteger(n)||o<0||n<0||o+n>bytes.length)fail('TIFF_BOUNDS');};
 const u16=o=>{range(o,2);return view.getUint16(o,little);},u32=o=>{range(o,4);return view.getUint32(o,little);};
 if(u16(2)!==42)fail('TIFF_UNSUPPORTED_BIGTIFF');
 const offset=u32(4);if(offset<8)fail('TIFF_BOUNDS');const count=u16(offset);
 if(!count||count>TIFF_LIMITS.tags)fail('TIFF_TAG_LIMIT');range(offset,2+count*12+4);
 // Reject all additional IFDs, including thumbnails/masks: no silent page loss.
 if(u32(offset+2+count*12))fail('TIFF_MULTIPAGE_UNSUPPORTED');
 const tags={},types={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,13:4};
 const numeric=new Set([254,255,256,257,258,259,262,266,273,274,277,278,279,284,297,317,320,338,339]);
 for(let i=0;i<count;i++){
  const p=offset+2+i*12,tag=u16(p),type=u16(p+2),n=u32(p+4);
  if(Object.hasOwn(tags,tag))fail('TIFF_DUPLICATE_TAG');
  if(!types[type]||!n||n>TIFF_LIMITS.values)fail('TIFF_TAG_LIMIT');
  const length=n*types[type],at=length<=4?p+8:u32(p+8);range(at,length);
  if([330,34665,34853,40965].includes(tag)||type===13)fail('TIFF_NESTED_IFD_UNSUPPORTED');
  if([322,323,324,325].includes(tag))fail('TIFF_UNSUPPORTED_TILES');
  // Color profiles/transfer functions need an explicitly tested color-management path.
  if([301,318,319,34675,50706,33421,33422].includes(tag))fail('TIFF_UNSUPPORTED_COLOR');
  tags[tag]=null;
  if(numeric.has(tag)){if(![1,3,4].includes(type))fail('TIFF_TAG_TYPE');
   tags[tag]=Array.from({length:n},(_,j)=>type===1?bytes[at+j]:type===3?u16(at+j*2):u32(at+j*4));}
 }
 const one=(tag,fallback)=>{const a=tags[tag];if(a===undefined&&fallback!==undefined)return fallback;if(!a||a.length!==1)fail('TIFF_TAG_REQUIRED');return a[0];};
 const width=one(256),height=one(257),pixels=width*height;
 if(!width||!height||width>TIFF_LIMITS.edge||height>TIFF_LIMITS.edge||pixels>TIFF_LIMITS.pixels)fail('TIFF_DIMENSIONS');
 if(bytes.length*6+pixels*24+32*1024*1024>TIFF_LIMITS.workingBytes)fail('TIFF_WORKING_BUDGET');
 const compression=one(259,1),photometric=one(262),samples=one(277,1),orientation=one(274,1),predictor=one(317,1);
 if(![1,5,8,32773].includes(compression))fail('TIFF_UNSUPPORTED_COMPRESSION');
 if(one(284,1)!==1||one(266,1)!==1)fail('TIFF_UNSUPPORTED_LAYOUT');
 if(orientation<1||orientation>8)fail('TIFF_UNSUPPORTED_ORIENTATION');
 if(one(254,0)!==0||(tags[255]&&one(255)!==1))fail('TIFF_UNSUPPORTED_SUBFILE');
 if(tags[297]&&(tags[297].length!==2||tags[297][0]!==0||tags[297][1]!==1))fail('TIFF_MULTIPAGE_UNSUPPORTED');
 const bits=tags[258]||[1];if(bits.length!==samples||!bits.every(x=>x===bits[0]))fail('TIFF_UNSUPPORTED_BITS');
 if(tags[339]&&(tags[339].length!==samples||!tags[339].every(x=>x===1)))fail('TIFF_UNSUPPORTED_SAMPLE');
 const extraSamples=tags[338]?one(338):0;
 if(!([0,1].includes(photometric)&&samples===1&&[1,8].includes(bits[0])||photometric===2&&[3,4].includes(samples)&&bits[0]===8||photometric===3&&samples===1&&bits[0]===8))fail('TIFF_UNSUPPORTED_COLOR');
 if(samples===4?extraSamples!==2:tags[338]!==undefined)fail('TIFF_UNSUPPORTED_ALPHA');
 if(photometric===3&&(!tags[320]||tags[320].length!==768))fail('TIFF_PALETTE');
 if(![1,2].includes(predictor)||predictor===2&&bits[0]!==8)fail('TIFF_UNSUPPORTED_PREDICTOR');
 const rowsPerStrip=one(278,height),offsets=tags[273],counts=tags[279];
 if(!rowsPerStrip||rowsPerStrip>height||!offsets||!counts||offsets.length!==Math.ceil(height/rowsPerStrip)||offsets.length!==counts.length||offsets.length>TIFF_LIMITS.strips)fail('TIFF_STRIPS');
 const rowBytes=Math.ceil(width*samples*bits[0]/8),occupied=[];
 offsets.forEach((o,i)=>{if(!counts[i])fail('TIFF_STRIPS');range(o,counts[i]);occupied.push([o,o+counts[i]]);if(compression===1&&counts[i]!==rowBytes*Math.min(rowsPerStrip,height-i*rowsPerStrip))fail('TIFF_STRIP_LENGTH');});
 occupied.sort((a,b)=>a[0]-b[0]);for(let i=1;i<occupied.length;i++)if(occupied[i][0]<occupied[i-1][1])fail('TIFF_STRIP_OVERLAP');
 return {width,height,compression,photometric,samples,bits:bits[0],orientation,predictor,extraSamples,rowsPerStrip,rowBytes,offsets,counts,tags,byteOrder:little?'II':'MM',ifdCount:1};
}
// UTIF's LZW routine has no input bound. Validate every code and exact output first.
function validateTiffLzw(bytes,expected){
 const lengths=new Uint16Array(4096);for(let i=0;i<256;i++)lengths[i]=1;
 let bit=0,bits=9,next=258,old=-1,out=0,arena=1032,first=true;
 const read=()=>{if(bit+bits>bytes.length*8)fail('TIFF_LZW_TRUNCATED');let v=0;for(let i=0;i<bits;i++,bit++)v=v*2+((bytes[bit>>3]>>(7-(bit&7)))&1);return v;};
 for(;;){
  // Some TIFF writers emit EOI at the preceding width exactly at a dictionary
  // transition. Accept only that terminal code after the exact pixel count.
  if(out===expected && next+1===(1<<(bits-1)) && bit+bits-1<=bytes.length*8){
   let tail=0;for(let k=0;k<bits-1;k++)tail=tail*2+((bytes[(bit+k)>>3]>>(7-((bit+k)&7)))&1);
   if(tail===257){const normalized=new Uint8Array(Math.ceil((bit+bits)/8));normalized.set(bytes.subarray(0,normalized.length));
    for(let k=0;k<bits;k++){const at=bit+k,mask=1<<(7-(at&7));normalized[at>>3]=(normalized[at>>3]&~mask)|(((257>>(bits-1-k))&1)?mask:0);}return normalized;}
  }
  const code=read(),initial=first;if(initial&&code!==256)fail('TIFF_LZW_CLEAR');first=false;
  if(code===257){if(out!==expected)fail('TIFF_STRIP_LENGTH');return bytes;}
  if(code===256){
   // Fixed UTIF consumes the next code as a literal, so another CLEAR here
   // would be emitted as byte 0 rather than resetting the dictionary again.
   if(!initial&&old<0)fail('TIFF_LZW_CLEAR');
   bits=9;next=258;old=-1;arena=1032;continue;
  }
  if(old<0&&code>255||code>next||code===next&&old<0)fail('TIFF_LZW_CODE');
  const size=code===next?lengths[old]+1:lengths[code];if(!size||out+size>expected)fail('TIFF_DECOMPRESS_BUDGET');out+=size;
  if(old>=0){if(next>=4094)fail('TIFF_LZW_DICTIONARY');lengths[next++]=lengths[old]+1;arena+=(lengths[next-1]+3)&~3;if(arena>2000000)fail('TIFF_LZW_DICTIONARY');if(next+1===(1<<bits))bits++;}old=code;
 }
}
function inflateTiffStrip(bytes,expected,pako){
 const out=new Uint8Array(expected);let offset=0;
 const stream=new pako.Inflate({windowBits:15,chunkSize:Math.min(16384,expected+1)});
 stream.onData=chunk=>{if(offset+chunk.length>expected)fail('TIFF_DECOMPRESS_BUDGET');out.set(chunk,offset);offset+=chunk.length;};
 stream.push(bytes,true);if(stream.err||!stream.ended||offset!==expected||stream.strm.avail_in!==0)fail('TIFF_DEFLATE_INVALID');return out;
}
function decodeBoundedTiff(input,UTIF,pako){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input),m=inspectBoundedTiff(bytes),decoded=new Uint8Array(m.rowBytes*m.height);
 let lzwTerminalNormalizations=0;
 m.offsets.forEach((offset,i)=>{const expected=m.rowBytes*Math.min(m.rowsPerStrip,m.height-i*m.rowsPerStrip),at=i*m.rowsPerStrip*m.rowBytes,strip=bytes.subarray(offset,offset+m.counts[i]);
  if(m.compression===1)decoded.set(strip,at);
  if(m.compression===5){const bounded=validateTiffLzw(strip,expected);if(bounded!==strip)lzwTerminalNormalizations++;const out=new Uint8Array(expected);UTIF.decode._decodeLZW(bounded,0,out,0);decoded.set(out,at);}
  if(m.compression===8)decoded.set(inflateTiffStrip(strip,expected,pako),at);
  if(m.compression===32773){let p=0,q=at;while(p<strip.length){const n=strip[p++];if(n===128)continue;const size=n<128?n+1:257-n;if(q+size>at+expected)fail('TIFF_DECOMPRESS_BUDGET');
   if(n<128){if(p+size>strip.length)fail('TIFF_PACKBITS_INVALID');decoded.set(strip.subarray(p,p+size),q);p+=size;}else{if(p>=strip.length)fail('TIFF_PACKBITS_INVALID');decoded.fill(strip[p++],q,q+size);}q+=size;}if(q!==at+expected)fail('TIFF_STRIP_LENGTH');}
 });
 if(m.predictor===2)for(let y=0;y<m.height;y++){const row=y*m.rowBytes;for(let x=m.samples;x<m.rowBytes;x++)decoded[row+x]=(decoded[row+x]+decoded[row+x-m.samples])&255;}
 const rgba=UTIF.toRGBA8({width:m.width,height:m.height,data:decoded,t262:[m.photometric],t258:Array(m.samples).fill(m.bits),t320:m.tags[320]});
 const swaps=m.orientation>=5,width=swaps?m.height:m.width,height=swaps?m.width:m.height;let oriented=rgba;
 if(m.orientation!==1){oriented=new Uint8Array(rgba.length);for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){
  let ox=x,oy=y;switch(m.orientation){case 2:ox=m.width-1-x;break;case 3:ox=m.width-1-x;oy=m.height-1-y;break;case 4:oy=m.height-1-y;break;case 5:ox=y;oy=x;break;case 6:ox=m.height-1-y;oy=x;break;case 7:ox=m.height-1-y;oy=m.width-1-x;break;case 8:ox=y;oy=m.width-1-x;break;}
  const src=(y*m.width+x)*4,dst=(oy*width+ox)*4;oriented.set(rgba.subarray(src,src+4),dst);}}
 const {tags,offsets,counts,...metadata}=m;return {rgba:oriented,width,height,metadata:{...metadata,lzwTerminalNormalizations,decoderVersion:TIFF_DECODER_VERSION}};
}
return {TIFF_DECODER_VERSION,TIFF_LIMITS,inspectBoundedTiff,decodeBoundedTiff,validateTiffLzw,inflateTiffStrip};
});
