const PanelOutput = (() => {
  const {clamp,makeCanvas}=PanelEngine;
  function nativeBox(model,box) {
    const sx=model.source.width/model.w, sy=model.source.height/model.h;
    return [Math.floor(box[0]*sx),Math.floor(box[1]*sy),Math.ceil(box[2]*sx),Math.ceil(box[3]*sy)];
  }
  function bounds(model,id,pad,rough=false) {
    const item=model.items[id], source=model.source;
    let [l,t,r,b]=item.shape?item.shape.box:nativeBox(model,rough?item.rough:item.box);
    for(const v of item.additions||[]) {l=Math.min(l,v[0]);t=Math.min(t,v[1]);r=Math.max(r,v[2]);b=Math.max(b,v[3]);}
    for(const op of item.brush||[]) if(op.kind==='add'){
      const v=op.box;l=Math.min(l,v[0]);t=Math.min(t,v[1]);r=Math.max(r,v[2]);b=Math.max(b,v[3]);
    }
    if(rough) return [l,t,r,b];
    return [Math.max(0,l-pad),Math.max(0,t-pad),Math.min(source.width,r+pad),Math.min(source.height,b+pad)];
  }
  function asXYWH(b) { return [b[0],b[1],b[2]-b[0],b[3]-b[1]]; }
  function mapAxis(start,length,small,large) {
    return Int32Array.from({length},(_,i)=>clamp(Math.floor((start+i+.5)*small/large),0,small-1));
  }
  function shapeRow(shape,y) {
    const b=shape.box;
    if(y<b[1] || y>=b[3]) return [];
    if(shape.type==='rect') return [b[0],b[2]];
    if(shape.type==='mask')return rowAt(shape.bands,y);
    const xs=[],p=shape.points,cy=y+.5;
    for(let i=0,j=p.length-1;i<p.length;j=i++) {
      const a=p[j],b=p[i];
      if((a[1]>cy)!==(b[1]>cy)) xs.push(Math.ceil(a[0]+(cy-a[1])*(b[0]-a[0])/(b[1]-a[1])-.5));
    }
    return xs.sort((a,b)=>a-b);
  }
  function merge(runs) {
    const pairs=[];
    for(let i=0;i<runs.length;i+=2) if(runs[i]<runs[i+1]) pairs.push([runs[i],runs[i+1]]);
    pairs.sort((a,b)=>a[0]-b[0]);const out=[];
    for(const [l,r] of pairs) {
      if(out.length && l<=out.at(-1)) out[out.length-1]=Math.max(out.at(-1),r);
      else out.push(l,r);
    }
    return out;
  }
  function band(bands,row,runs) {
    const prev=bands.at(-1);
    if(prev && prev[1]===row && prev[2].length===runs.length && runs.every((v,i)=>v===prev[2][i])) prev[1]=row+1;
    else bands.push([row,row+1,runs]);
  }
  function intersect(a,b){
    const out=[];let i=0,j=0;
    while(i<a.length&&j<b.length){
      const l=Math.max(a[i],b[j]),r=Math.min(a[i+1],b[j+1]);if(l<r)out.push(l,r);
      if(a[i+1]<b[j+1])i+=2;else j+=2;
    }
    return out;
  }
  function subtract(a,b){
    const out=[];let j=0;
    for(let i=0;i<a.length;i+=2){
      let l=a[i],r=a[i+1];
      while(j<b.length&&b[j+1]<=l)j+=2;
      for(let k=j;k<b.length&&b[k]<r;k+=2){if(b[k]>l)out.push(l,Math.min(b[k],r));l=Math.max(l,b[k+1]);if(l>=r)break;}
      if(l<r)out.push(l,r);
    }return out;
  }
  function rowAt(bands,y){
    let lo=0,hi=bands.length;
    while(lo<hi){const m=(lo+hi)>>1;if(bands[m][1]<=y)lo=m+1;else hi=m;}
    return lo<bands.length&&bands[lo][0]<=y?bands[lo][2]:[];
  }
  function selection(model,id,box) {
    const [x,y,w,h]=asXYWH(box);
    const item=model.items[id],originalId=item.autoId??id;
    const xs=mapAxis(x,w,model.w,model.source.width), ys=mapAxis(y,h,model.h,model.source.height);
    const keep=[],white=[],rowExtent=[x,x+w];
    const original=!item.shape&&item.brush?.some(op=>op.kind==='add')?nativeBox(model,item.box):null;
    let automatic=[];
    for (let j=0;j<h;j++) {
      if(!item.shape && (!j || ys[j]!==ys[j-1] || (original&&(y+j===original[1]||y+j===original[3])))) {
        automatic=[];const row=ys[j]*model.w;let start=-1;
        for(let i=0;i<=w;i++) {
          const inside=i<w && model.owners[row+xs[i]]===originalId && (!original||(x+i>=original[0]&&x+i<original[2]&&y+j>=original[1]&&y+j<original[3]));
          if(inside && start<0) start=i;
          if(!inside && start>=0) {automatic.push(start,i);start=-1;}
        }
      }
      const local=v=>clamp(v-x,0,w),cy=y+j;
      let runs=item.shape?intersect(shapeRow(item.shape,cy),rowExtent).map(v=>v-x):automatic;
      if(item.additions?.length) {
        runs=runs.slice();
        for(const r of item.additions) if(cy>=r[1] && cy<r[3]) runs.push(local(r[0]),local(r[2]));
        runs=merge(runs);
      }
      const whiteBase=item.shape?.whiteBands;
      if(!item.cuts?.length&&!item.brush?.length&&!whiteBase?.length) {band(keep,j,runs);continue;}
      const holes=[];
      for(const r of item.cuts||[]) if(cy>=r[1] && cy<r[3]) holes.push(local(r[0]),local(r[2]));
      const cuts=merge(holes);
      let retained=subtract(runs,cuts),erased=intersect(runs,cuts);
      if(whiteBase?.length)erased=subtract(merge([...erased,...rowAt(whiteBase,cy).map(local)]),retained);
      for(const op of item.brush||[]){
        if(cy<op.box[1]||cy>=op.box[3]||op.box[0]>=x+w||op.box[2]<=x)continue;
        const s=merge(rowAt(op.bands,cy).map(local));if(!s.length)continue;
        if(op.kind==='add'){retained=merge([...retained,...s]);erased=subtract(erased,s);}
        else{
          if(op.kind==='erase')erased=merge([...erased,...intersect(retained,s)]);
          else erased=subtract(erased,s);
          retained=subtract(retained,s);
        }
      }
      band(keep,j,retained);band(white,j,erased);
    }
    return {keep,white};
  }
  function unionShape(model,ids){
    const boxes=ids.map(id=>bounds(model,id,0)),layers=ids.map((id,i)=>selection(model,id,boxes[i]));
    const box=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
    const bands=[],whiteBands=[];
    for(let y=box[1];y<box[3];y++){
      const keep=[],white=[];
      for(let i=0;i<layers.length;i++){
        const [x0,y0,,y1]=boxes[i];if(y<y0||y>=y1)continue;
        for(const v of rowAt(layers[i].keep,y-y0))keep.push(v+x0);
        for(const v of rowAt(layers[i].white,y-y0))white.push(v+x0);
      }
      const k=merge(keep),s=subtract(merge(white),k);
      if(k.length)band(bands,y,k);if(s.length)band(whiteBands,y,s);
    }
    return {type:'mask',box,bands,whiteBands};
  }
  function contains(model,id,x,y) {
    const p=model.items[id],rect=r=>x>=r[0]&&x<r[2]&&y>=r[1]&&y<r[3];
    for(let k=(p.brush?.length||0)-1;k>=0;k--){
      const op=p.brush[k];if(!rect(op.box))continue;
      const row=rowAt(op.bands,Math.floor(y));
      if(row.some((l,i)=>i%2===0&&x>=l&&x<row[i+1]))return op.kind==='add';
    }
    if(p.cuts?.some(rect)) return false;
    if(p.additions?.some(rect)) return true;
    if(p.shape) {
      const span=shapeRow(p.shape,Math.floor(y));
      return span.some((l,i)=>i%2===0 && Math.floor(x)>=l && Math.floor(x)<span[i+1]);
    }
    const i=clamp(Math.floor(y*model.h/model.source.height),0,model.h-1)*model.w+clamp(Math.floor(x*model.w/model.source.width),0,model.w-1);
    return rect(p.brush?.length?nativeBox(model,p.box):bounds(model,id,0)) && model.owners[i]===(p.autoId??id);
  }
  function paint(model,id,mode,pad,paper) {
    const box=bounds(model,id,pad,mode!=='clean'), [x,y,w,h]=asXYWH(box);
    const c=makeCanvas(w,h), ctx=c.getContext('2d',{willReadFrequently:mode==='removed'});
    ctx.drawImage(model.source,x,y,w,h,0,0,w,h);
    if (mode==='clean') {
      // Alter only excluded spans. All retained pixels, including alpha, stay untouched.
      ctx.fillStyle='rgb('+model.paper.join(',')+')';
      const omit=paper==='paper'?ctx.fillRect.bind(ctx):ctx.clearRect.bind(ctx);
      const mask=selection(model,id,box);
      for (const [top,bottom,runs] of mask.keep) {
        let left=0;
        for (let i=0;i<runs.length;i+=2) {
          if (runs[i]>left) omit(left,top,runs[i]-left,bottom-top);
          left=runs[i+1];
        }
        if (left<w) omit(left,top,w-left,bottom-top);
      }
      ctx.fillStyle='#ffffff';
      for(const [top,bottom,runs] of mask.white) for(let i=0;i<runs.length;i+=2) ctx.fillRect(runs[i],top,runs[i+1]-runs[i],bottom-top);
    } else if (mode==='removed') {
      const pixels=ctx.getImageData(0,0,w,h), rgba=pixels.data;
      const xs=mapAxis(x,w,model.w,model.source.width), ys=mapAxis(y,h,model.h,model.source.height);
      for(const [top,bottom,runs] of selection(model,id,box).keep) for(let j=top;j<bottom;j++) {
        let run=0;
        for(let i=0;i<w;i++) {
          while(run<runs.length && i>=runs[run+1]) run+=2;
          if(run<runs.length && i>=runs[run]) continue;
          const offset=ys[j]*model.w+xs[i],p=4*(j*w+i);
          if(model.visible[offset] && rgba[p+3]) {rgba[p]=211;rgba[p+1]=48;rgba[p+2]=82;rgba[p+3]=255;}
        }
      }
      ctx.putImageData(pixels,0,0);
    }
    return c;
  }
  function removedCount(model,id) {
    if(!model.items[id].rough)return 0;
    const [l,t,r,b]=model.items[id].rough;
    let count=0;
    for (let y=t;y<b;y++) for (let x=l;x<r;x++) {
      const i=y*model.w+x;
      if (model.owners[i]!==(model.items[id].autoId??id) && model.visible[i]) count++;
    }
    return count;
  }
  function regions(model,pad,paper) {
    return {schema:'panel-extract.v0.6',source:model.name,
      ...(model.evidence?{author_evidence:model.evidence,fusion:model.fusion,pdf_page:model.pdfPage,pdf_box:model.pdfBox}:{}),
      image:{width:model.source.width,height:model.source.height},analysis:{width:model.w,height:model.h},
      bbox_format:'[x,y,width,height] in source pixels',padding_px:pad,outside_mask:paper,
      background_rgb:model.paper,mask_format:'Within each bbox, [y0,y1,[x0,x1,x2,x3,...]] stores retained horizontal spans; all ends exclusive.',
      panels:model.items.map((item,id)=>{
        const b=bounds(model,id,pad),mask=selection(model,id,b);
        return {id:item.label,label:item.label,bbox:asXYWH(b),initial_bbox:asXYWH(bounds(model,id,0,true)),
          anchor:item.anchor?asXYWH(nativeBox(model,[item.anchor[0],item.anchor[1],item.anchor[0]+item.anchor[2],item.anchor[1]+item.anchor[3]])):null,
          mask_bands:mask.keep,white_bands:mask.white,selection:item.shape?.type==='mask'?{type:'mask',members:item.members}:item.shape||null,cut_rectangles:item.cuts||[],
          description:item.description,edited:!!item.edited,review_required:!!item.review,
          ...(model.evidence?{author_caption:PaperCaption.forItem(model.evidence,item)}:{})};
      })};
  }
  const png=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('无法编码 PNG')),'image/png'));
  function save(blob,filename) {
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  const crcTable=Uint32Array.from({length:256},(_,n)=>{
    for (let i=0;i<8;i++) n=(n&1)?0xedb88320^(n>>>1):n>>>1;
    return n>>>0;
  });
  function crc32(bytes) {
    let crc=0xffffffff;
    for (const b of bytes) crc=crcTable[(crc^b)&255]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  }
  // Store PNGs directly in a ZIP32 archive. PNG payloads are already compressed.
  async function zip(files) {
    const enc=new TextEncoder(), chunks=[], directory=[];
    let size=0, dirSize=0;
    for (const {name,blob} of files) {
      const bytes=new Uint8Array(await blob.arrayBuffer()), filename=enc.encode(name), crc=crc32(bytes);
      if (bytes.length+size>=0xffffffff) throw Error('文件超过 ZIP32 容量，请分别导出');
      const header=new Uint8Array(30+filename.length), hv=new DataView(header.buffer);
      hv.setUint32(0,0x04034b50,true);hv.setUint16(4,20,true);hv.setUint16(6,0x0800,true);hv.setUint16(12,0x21,true);
      hv.setUint32(14,crc,true);hv.setUint32(18,bytes.length,true);hv.setUint32(22,bytes.length,true);hv.setUint16(26,filename.length,true);
      header.set(filename,30); chunks.push(header,blob);
      const central=new Uint8Array(46+filename.length), cv=new DataView(central.buffer);
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);cv.setUint16(14,0x21,true);
      cv.setUint32(16,crc,true);cv.setUint32(20,bytes.length,true);cv.setUint32(24,bytes.length,true);
      cv.setUint16(28,filename.length,true);cv.setUint32(42,size,true);
      central.set(filename,46);directory.push(central);dirSize+=central.length;
      size+=header.length+blob.size;
    }
    const end=new Uint8Array(22), ev=new DataView(end.buffer);
    ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);
    ev.setUint32(12,dirSize,true);ev.setUint32(16,size,true);
    return new Blob([...chunks,...directory,end],{type:'application/zip'});
  }
  function cropMask(model,id,box) {
    const [, ,width,height]=asXYWH(box);
    const mask=selection(model,id,box);
    const hidden=[],white=[];
    for (const [top,bottom,kept] of mask.keep) {
      let left=0;
      for (let i=0;i<kept.length;i+=2) {
        if (kept[i]>left) hidden.push([left,top,kept[i],bottom]);
        left=kept[i+1];
      }
      if (left<width) hidden.push([left,top,width,bottom]);
    }
    if (!hidden.length) return null;
    for (const [top,bottom,runs] of mask.white)
      for (let i=0;i<runs.length;i+=2) white.push([runs[i],top,runs[i+1],bottom]);
    return {width,height,paper:Array.from(model.paper),hidden,white};
  }
  return {cropMask,bounds,asXYWH,nativeBox,selection,contains,paint,removedCount,regions,png,save,zip,merge,band,rowAt,intersect,subtract,unionShape};
})();
