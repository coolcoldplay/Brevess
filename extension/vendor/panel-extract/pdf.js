/* PDF coordinates in this module are displayed page points, including page rotation. */
const PaperPDF=(()=>{
  const canvas=PanelEngine.makeCanvas,clamp=PanelEngine.clamp;
  const area=b=>Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);
  const union=(a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])];
  const overlap=(a,b)=>area([Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])]);
  const expand=(b,d,w,h)=>[Math.max(0,b[0]-d),Math.max(0,b[1]-d),Math.min(w,b[2]+d),Math.min(h,b[3]+d)];
  let library;
  function runtime(){
    return library??=import('../pdfjs/build/pdf.min.mjs').then(lib=>{
      lib.GlobalWorkerOptions.workerSrc=chrome.runtime.getURL('vendor/pdfjs/build/pdf.worker.min.mjs');
      return lib;
    });
  }
  async function open(file,onPassword,onTask){
    const lib=await runtime(),base=chrome.runtime.getURL('vendor/pdfjs/');
    const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:base+'cmaps/',
      standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',iccUrl:base+'iccs/',cMapPacked:true,
      isEvalSupported:false,disableFontFace:false,useSystemFonts:true,isOffscreenCanvasSupported:false,verbosity:0});
    if(onTask)onTask(task);
    task.onPassword=(update,reason)=>onPassword(update,reason);
    return task.promise;
  }
  function textGeometry(lib,page,text,vp){
    const words=[],letters=[];
    for(const item of text.items){
      const str=item.str?.normalize('NFKC').replace(/[\u0000-\u001f]/g,' ').trim();
      if(!str)continue;
      const t=lib.Util.transform(vp.transform,item.transform),size=Math.hypot(t[2],t[3])||Math.hypot(t[0],t[1])||8;
      const ax=Math.hypot(t[0],t[1])||1,ux=t[0]/ax,uy=t[1]/ax,vx=t[2]/size,vy=t[3]/size;
      const st=text.styles[item.fontName]||{},asc=clamp(st.ascent??.85,.6,1.12),desc=clamp(st.descent??-.2,-.32,0);
      const width=Math.abs(item.width*vp.scale),ps=[];
      for(const dx of [0,width])for(const dy of [desc*size,asc*size])ps.push([t[4]+dx*ux+dy*vx,t[5]+dx*uy+dy*vy]);
      const box=[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))];
      const entry={s:str,b:box,y:t[5],size,font:item.fontName,upright:Math.abs(uy)<.2&&ux>.7};
      words.push(entry);
      if(entry.upright && /^[A-Za-z]$/.test(str))letters.push(entry);
    }
    const groups=[];
    for(const v of words.filter(v=>v.upright).sort((a,b)=>a.y-b.y||a.b[0]-b.b[0])){
      let row=groups.at(-1);
      if(!row || Math.abs(v.y-row.y)>Math.max(1.35,Math.min(v.size,row.size)*.23)){row={y:v.y,size:v.size,words:[]};groups.push(row);}
      row.words.push(v);
    }
    const lines=[];
    for(const g of groups){
      let line;
      for(const v of g.words.sort((a,b)=>a.b[0]-b.b[0])){
        const gap=line?v.b[0]-line.b[2]:Infinity;
        if(!line || gap>Math.max(5,Math.min(13,v.size*1.05)) || gap<-Math.max(6,v.size*1.6)){
          line={s:v.s,b:v.b.slice(),size:v.size,first:v,parts:[v]};lines.push(line);
        }else{
          line.s+=(gap>v.size*.11?' ':'')+v.s;line.b=union(line.b,v.b);line.parts.push(v);line.size=Math.max(line.size,v.size);
        }
      }
    }
    const textBoxes=words.filter(v=>v.upright&&v.s.length<=40).map(v=>({s:v.s,b:v.b}));
    const marginText=words.filter(v=>!v.upright&&(v.b[2]<vp.width*.06||v.b[0]>vp.width*.94)&&v.s.length>6).map(v=>v.b);
    return {lines,letters,textBoxes,marginText};
  }
  // Adapted from BREVESS parseCaptionHeader under AGPL-3.0-or-later.
  // Here the caller only needs a yes/no hint before checking layout and language.
  const captionHeader = /^\s*(?:extended\s+data\s+fig(?:ure)?|supplement(?:ary|al)\s+fig(?:ure)?|fig(?:ure)?)\.?\s*(?:S\s*)?(\d{1,3})(?!\d)(\s*(?:[.:|\u2010-\u2015\u2212-])\s*|\s*$)(.*)$/iu;
  const referenceVerb = /^(?:shows?|showing|illustrates?|depicts?|demonstrates?|presents?|summari[sz]es?|compares?|indicates?|reveals?|provides?|is|was|were|has|contains?)\b/iu;
  function matchesCaptionHeader(line) {
    const normalized = line.normalize('NFKC').replace(/[\t\f\v ]+/g,' ').trim();
    const match = normalized.match(captionHeader);
    if (!match || Number(match[1]) < 1) return false;
    const body = match[3].trim();
    if (referenceVerb.test(body) || /^(?:figure\s+supplements?|source\s+data|videos?|animations?)\b/iu.test(body)) return false;
    if (!match[2].trim() && /^(?:and|or|see|also|above|below|in|from|of|for)\b/iu.test(body)) return false;
    return !/\.{3,}\s*\d{1,4}\s*$|^\.{2,}/u.test(body);
  }
  function caption(s){
    s=s.trim().replace(/\u00ad/g,'');
    const native=matchesCaptionHeader(s);
    let m=/^(?:(extended\s+data|supplementary|supplemental|supplement)\s+)?(?:fig(?:ure)?\.?\s*|图\s*)(S\s*)?(\d{1,3})(?![\da-zA-Z])([\s\S]*)$/iu.exec(s);
    if(!m)return null;
    const tail=m[4].trim(),strong=/^[.|:：｜—–-]/u.test(tail),next=tail.replace(/^[.|:：｜—–\s-]+/u,'');
    const continued=/^\(?\s*(?:continued|cont[’'.]?d|续)\b/i.test(next)||/^\(续\)/.test(next);
    if(!native && !strong && !continued && tail && !/^(?:[A-Z\u3400-\u9fff]|\([A-Za-z]\)|\d{2,}\s+[A-Za-z])/.test(tail))return null;
    if(!continued && /^[),;（，、]|^(?:and|or|shows?|in|of|we|was|were|is|are|see|illustrates?|displays?|depicts?)\b/i.test(next))return null;
    if(!native && !continued && /^[.,]\s*(?:[a-z][,;.)]|\d)/.test(tail))return null;
    const kind=/extended/i.test(m[1]||'')?'ed':m[2]||m[1]?'supp':'main',n=Number(m[3]);
    if(!n)return null;
    return {key:kind+n,name:(kind==='ed'?'Extended Data Fig ':kind==='supp'?'Fig S':'Fig ')+n,kind,n,continued,
      strength:strong&&next.length>2?3:tail.length>1?2:1};
  }
  function describeLines(lines,w,h){
    const caps=[],tables=[];
    for(const l of lines){
      const id=caption(l.s);
      if(id){
        const wraps=lines.some(prev=>prev!==l&&prev.first.font===l.first.font&&Math.abs(prev.b[0]-l.b[0])<4&&
          l.first.y-prev.first.y>l.size*.7&&l.first.y-prev.first.y<l.size*1.9&&/\b(?:shown in|presented in|as in|see also|in|and|see|of|from|with)\s*$/i.test(prev.s));
        if(!wraps){caps.push({...id,b:l.b,s:l.s,size:l.size});l.header=true;}
      }
      if(/^(?:(?:extended data|supplementary)\s+)?(?:Table\s*S?\s*\d{1,3}(?![A-Za-z\d])|表\s*\d+)(?:[.:：|｜\s]|$)/i.test(l.s))tables.push(l.b);
      const count=l.s.length, width=l.b[2]-l.b[0];
      const tokens=l.s.split(/\s+/).length;
      l.prose=!!l.header || (count>=35 && width>w*.16 && (tokens>=5 || /[\u3400-\u9fff]/.test(l.s))) ||
        (count>=25 && width>w*.25 && tokens>=4 && /[.,;:]/.test(l.s));
    }
    const long=lines.filter(l=>l.prose);
    for(const l of lines){
      if(l.prose||l.s.length<4)continue;
      l.prose=long.some(t=>Math.abs(t.b[0]-l.b[0])<4 && Math.abs(t.size-l.size)<1.4 &&
        Math.abs(t.first.y-l.first.y)<=1.8*l.size && Math.abs(t.first.y-l.first.y)>.65*l.size);
    }
    for(const c of caps){
      // A panel legend often typesets just the panel letters in a separate face.
      // Require a substantial alphabetic run in the same caption paragraph.
      const groups=new Map();let last=c.b[1];
      const ordered=lines.filter(l=>l.b[1]>=c.b[1]-2&&l.b[0]>=c.b[0]-5&&Math.abs(l.size-c.size)<c.size*.33)
        .sort((a,b)=>Math.abs(a.first.y-b.first.y)<c.size*.26?a.b[0]-b.b[0]:a.first.y-b.first.y);
      for(const line of ordered){
        if(line.b[1]-last>c.size*2.35||line.b[1]-c.b[1]>h*.40||(line.header&&Math.abs(line.b[1]-c.b[1])>3))break;
        last=Math.max(last,line.b[1]);
        for(const part of line.parts){
          // Only standalone tokens or explicit ranges in one consistent font.
          const m=/^\(?([A-Za-z])(?:\s*[-–—]\s*([A-Za-z]))?\)?[.,;:]?$/.exec(part.s.trim());
          if(!m)continue;
          if(!groups.has(part.font))groups.set(part.font,[]);
          const seq=groups.get(part.font);seq.push(m[1]);
          if(m[2]&&m[2]>=m[1]&&m[2].charCodeAt(0)-m[1].charCodeAt(0)<15)
            for(let i=m[1].charCodeAt(0)+1;i<=m[2].charCodeAt(0);i++)seq.push(String.fromCharCode(i));
        }
      }
      for(const seq of groups.values()){
        const letters=[...new Set(seq)],alpha=letters[0]==='a'?'abcdefghijklmnopqrstuvwxyz':'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if(letters[0]!==alpha[0]||letters[1]!==alpha[1]||letters.length<5)continue;
        const indices=letters.map(v=>alpha.indexOf(v));
        if(indices.some((v,i)=>v<0||(i&&v<indices[i-1])))continue;
        const len=indices.at(-1)+1;
        if(letters.length>=len*.65&&(!c.panelRun||c.panelRun.length<len))c.panelRun=alpha.slice(0,len);
      }
    }
    return {caps,tables};
  }
  function pageGraphics(lib,list,bbs,vp){
    const {OPS}=lib,rects=[],pics=[];
    const picture=new Set([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat,OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectRepeat]);
    const path=new Set([OPS.constructPath,OPS.fill,OPS.eoFill,OPS.stroke,OPS.fillStroke,OPS.eoFillStroke,OPS.shadingFill]);
    if(bbs)for(let i=0;i<list.fnArray.length&&i<bbs.length;i++){
      const op=list.fnArray[i];if((!picture.has(op)&&!path.has(op))||bbs.isEmpty(i))continue;
      const b=[bbs.minX(i)*vp.width,bbs.minY(i)*vp.height,bbs.maxX(i)*vp.width,bbs.maxY(i)*vp.height];
      if(picture.has(op)){if(area(b)>80)pics.push(b);}
      if(area(b)<vp.width*vp.height*.84)rects.push(b);
    }
    // Image placement matrices retain full PDF precision, including Form XObjects.
    const exact=[],stack=[];let matrix=vp.transform.slice();
    const save=()=>stack.push(matrix.slice()),restore=()=>{if(stack.length)matrix=stack.pop();};
    for(let i=0;i<list.fnArray.length;i++){
      const op=list.fnArray[i],args=list.argsArray[i];
      if(op===OPS.save)save();
      else if(op===OPS.restore)restore();
      else if(op===OPS.transform)matrix=lib.Util.transform(matrix,args);
      else if(op===OPS.paintFormXObjectBegin){save();if(args[0])matrix=lib.Util.transform(matrix,args[0]);}
      else if(op===OPS.paintFormXObjectEnd)restore();
      else if(op===OPS.paintImageXObject||op===OPS.paintInlineImageXObject){
        const [a,b,c,d,e,f]=matrix,x=[e,e+a,e+c,e+a+c],y=[f,f+b,f+d,f+b+d];
        const box=[Math.min(...x),Math.min(...y),Math.max(...x),Math.max(...y)];
        const iw=op===OPS.paintImageXObject?args[1]:args[0]?.width,ih=op===OPS.paintImageXObject?args[2]:args[0]?.height;
        if(area(box)>70)exact.push({box,iw,ih});
      }
    }
    return {rects,pics:exact.length?exact.map(v=>v.box):pics,exact};
  }
  function visualBlocks(meta,bitmap,rects,pics){
    const {w,h,lines,caps}=meta,step=3,gw=Math.ceil(w/step),gh=Math.ceil(h/step);
    const bits=new Uint8Array(gw*gh),draw=new Uint8Array(bits.length),prose=new Uint8Array(bits.length);
    const rgba=bitmap.getContext('2d',{willReadFrequently:true}).getImageData(0,0,bitmap.width,bitmap.height).data;
    const sx=bitmap.width/w,sy=bitmap.height/h;
    function mark(grid,b,val){
      const x0=clamp(Math.floor(b[0]/step),0,gw),x1=clamp(Math.ceil(b[2]/step),0,gw);
      for(let y=clamp(Math.floor(b[1]/step),0,gh);y<Math.min(gh,Math.ceil(b[3]/step));y++)grid.fill(val,y*gw+x0,y*gw+x1);
    }
    for(const b of [...rects,...pics])if(area(b)<w*h*.92)mark(draw,b,1);
    for(const l of lines)if(l.prose)mark(prose,expand(l.b,1.2,w,h),1);
    for(const b of meta.marginText)mark(prose,expand(b,1.5,w,h),1);
    for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
      let hits=0;
      for(const dy of [.2,.5,.8])for(const dx of [.2,.5,.8]){
        const p=4*(clamp(Math.floor((y+dy)*step*sy),0,bitmap.height-1)*bitmap.width+clamp(Math.floor((x+dx)*step*sx),0,bitmap.width-1));
        if(Math.min(rgba[p],rgba[p+1],rgba[p+2])<222)hits++;
      }
      bits[y*gw+x]=hits>=1?1:0;
    }
    const pagesize=w*h,scanned=pics.some(b=>area(b)>.82*pagesize)&&lines.length<7;
    meta.scan=scanned;
    if(scanned){
      // An isolated scanned plate can be proposed by its labels. Text-heavy
      // scans still need a page crop because they can contain multiple figures.
      let l=gw,r=0,t=gh,b=0,first=-1,thinLines=0,wide=0;
      for(let y=0;y<=gh;y++){
        let a=gw,z=0,count=0;
        if(y<gh)for(let x=0;x<gw;x++)if(bits[y*gw+x]){a=Math.min(a,x);z=x+1;count++;}
        if(count>=3){l=Math.min(l,a);r=Math.max(r,z);t=Math.min(t,y);b=y+1;}
        if(count>gw*.12){if(first<0)first=y;wide=Math.max(wide,z-a);}
        else if(first>=0){if(wide>gw*.48&&y-first<=Math.max(4,gh*.018))thinLines++;first=-1;wide=0;}
      }
      if(thinLines>12||r-l<gw*.3||b-t<gh*.16)return [];
      const model=PanelEngine.analyze(bitmap);
      if(model.items.length<3)return [];
      const box=expand([l*step,t*step,Math.min(w,r*step),Math.min(h,b*step)],3,w,h);
      return [{b:box,page:meta.page,strength:1,letterCount:model.items.length,points:Math.round(area(box)/12),scanPlate:true}];
    }
    const splitColumns=caps.some(a=>caps.some(b=>a.key!==b.key && a.b[0]<w*.46 && b.b[0]>w*.49 && Math.abs(a.b[1]-b.b[1])<h*.28));
    const lanes=splitColumns?[[0,Math.floor(gw/2)],[Math.floor(gw/2),gw]]:[[0,gw]],blocks=[];
    for(const [left,right] of lanes){
      const spans=[],laneW=right-left;
      const bars=caps.filter(c=>c.b[0]/step>=left-1&&c.b[0]/step<right).map(c=>c.b[1]/step);
      let span=null,last=-1;
      const rows=[];
      for(let y=0;y<gh;y++){
        let min=right,max=left-1,ink=0,graphics=0,text=0;
        for(let x=left;x<right;x++){
          const p=y*gw+x;
          if(prose[p]){text++;continue;}
          if(!bits[p])continue;
          min=Math.min(x,min);max=Math.max(x,max);ink++;graphics+=draw[p];
        }
        const pos=(y+.5)*step;
        const furniture=pos<h*.049 || pos>h*.954 || ((pos<h*.085 || pos>h*.90)&&ink>laneW*.8&&graphics>laneW*.72);
        rows.push({min,max,ink,graphics,text,furniture});
        const active=!furniture&&ink>=2&&(graphics>=1 || ink>=4);
        if(!active)continue;
        const barrier=span && (bars.some(b=>b>last+.2&&b<=y+.2) ||
          (y-last>3 && rows.slice(last+1,y).filter(r=>r.text>laneW*.19).length>=2));
        if(!span || y-last>Math.max(10,gh*.052)||barrier){span={start:y,end:y};spans.push(span);}
        span.end=y;last=y;
      }
      for(const seg of spans){
        let l=right,r=left,points=0,graphic=0;
        for(let y=seg.start;y<=seg.end;y++){
          const row=rows[y];if(row.furniture)continue;
          for(let x=left;x<right;x++){
            const p=y*gw+x;if(!bits[p]||prose[p])continue;
            l=Math.min(l,x);r=Math.max(r,x+1);points++;graphic+=draw[p];
          }
        }
        if(r<=l)continue;
        let b=[l*step,seg.start*step,Math.min(w,r*step),Math.min(h,(seg.end+1)*step)];
        const large=pics.filter(p=>area(p)>pagesize*.012&&area(p)<pagesize*.84&&overlap(p,b)>.45*area(p));
        const letterCount=meta.letters.filter(c=>c.b[0]>=b[0]-5&&c.b[2]<=b[2]+5&&c.b[1]>=b[1]-7&&c.b[3]<=b[3]+7).length;
        if((b[2]-b[0])<43||(b[3]-b[1])<27||points<55||(!large.length&&graphic<Math.max(35,points*.08)&&letterCount<3))continue;
        if(!large.length && graphic<60 && letterCount<3)continue;
        // Use PDF artwork edges too, including white margins enclosing pale content.
        for(const p of large)b=union(b,p);
        blocks.push({b:expand(b,2.5,w,h),strength:Math.min(1,graphic/1400)+(large.length?.45:0),points,letterCount,page:meta.page});
      }
    }
    return blocks;
  }
  async function scanPage(doc,number){
    const lib=await runtime(),page=await doc.getPage(number),vp=page.getViewport({scale:1});
    const text=await page.getTextContent(),{lines,letters,textBoxes,marginText}=textGeometry(lib,page,text,vp),{caps,tables}=describeLines(lines,vp.width,vp.height);
    const meta={page:number,w:vp.width,h:vp.height,lines,letters,textBoxes,marginText,caps,tables,
      captionInput:{pageNumber:number,view:page.view,textContent:text},transform:vp.transform};
    const scale=Math.min(1.55,1050/Math.max(vp.width,vp.height)),view=page.getViewport({scale}),c=canvas(Math.ceil(view.width),Math.ceil(view.height));
    try{
      await page.render({canvas:c,viewport:view,recordOperations:true,annotationMode:0,background:'white'}).promise;
      const ops=await page.getOperatorList({annotationMode:0}),{rects,pics,exact}=pageGraphics(lib,ops,page.recordedBBoxes,vp);
      const pageArea=meta.w*meta.h;
      meta.blocks=visualBlocks(meta,c,rects,pics);
      meta.proseCount=lines.filter(l=>l.prose).length;
      meta.form=lines.some(l=>/reporting summary|life sciences study design|corresponding author\(s\)|reporting on sex and gender/i.test(l.s));
      for(const img of exact.filter(im=>!meta.scan&&area(im.box)>pageArea*.074&&area(im.box)<pageArea*.87 && im.iw>90&&im.ih>50)){
        const b=img.box,existing=meta.blocks.find(block=>overlap(block.b,b)>.55*area(b));
        const extras=letters.filter(l=>existing && overlap(l.b,existing.b)>.6*area(l.b)&&overlap(l.b,b)<.4*area(l.b)&&
          !lines.some(t=>t.prose&&t.parts.includes(l)));
        const siblings=exact.some(im=>im!==img&&existing&&overlap(im.box,existing.b)>.5*area(im.box)&&
          area(im.box)>pageArea*.016&&overlap(im.box,b)<area(im.box)*.3);
        const overlay=lines.some(l=>!l.prose && l.s.length>2 && overlap(b,l.b)>.7*area(l.b));
        if(extras.length>=2||siblings || (overlay&&existing&&area(b)<.72*area(existing.b)))continue;
        if(!existing || existing.native || area(b)>.48*area(existing.b)){
          const box=expand(b,0,meta.w,meta.h);
          const block={b:box,page:number,strength:2.8,points:Math.round(area(b)/12),letterCount:0,native:true,
            resolution:Math.max(1,Math.min(img.iw/(b[2]-b[0]),img.ih/(b[3]-b[1])))};
          if(existing&&!existing.native)Object.assign(existing,block);
          else if(!existing || overlap(existing.b,b)<.75*area(b))meta.blocks.push(block);
        }
      }
      meta.blocks=meta.blocks.filter(b=>!meta.form&&(b.native||(!((b.b[3]<meta.h*.19||b.b[1]>meta.h*.87)&&
        b.b[3]-b.b[1]<meta.h*.14&&b.letterCount<2)))&&(!b.native?!(number===1&&meta.proseCount>9&&b.letterCount<2):true));
    }finally{c.width=c.height=1;page.cleanup();}
    delete meta.lines;delete meta.marginText;return meta;
  }
  function collect(pages){
    const blocks=pages.flatMap(p=>p.blocks||[]), anchors=pages.flatMap(p=>p.caps.map(c=>({...c,page:p.page})));
    const detached=anchors.filter(c=>c.kind==='main'&&c.b[1]<pages[c.page-1].h*.20&&pages[c.page-2]?.blocks.some(b=>
      b.native&&area(b.b)>.22*pages[c.page-2].w*pages[c.page-2].h));
    const serialPlates=detached.some(c=>[1,2].every(i=>detached.some(d=>d.n===c.n+i&&d.page===c.page+2*i)));
    const identities=new Map(),edges=[];
    for(const c of anchors){
      const key=c.key+(c.continued?'-continued-'+c.page:'');
      if(!identities.has(key))identities.set(key,{...c,key,anchors:[]});
      identities.get(key).anchors.push(c);
    }
    const matched=new Set(),chosen=new Map();
    for(const [key,id] of identities)for(const c of id.anchors)for(const b of blocks){
      const dp=b.page-c.page;if(Math.abs(dp)>1)continue;
      const p=pages[b.page-1],box=b.b;
      const dx=Math.max(0,box[0]-c.b[0],c.b[0]-box[2])/p.w;
      const dy=box[3]<=c.b[1]+7?(c.b[1]-box[3])/p.h:
        box[1]>=c.b[3]-6?(box[1]-c.b[3])/p.h+.035:.19;
      let score=dp===0?105-Math.min(.85,Math.max(0,dy))*98-dx*108:45-dx*12;
      // A top-of-page caption may follow a full-page plate. A thin text/rule
      // fragment below that caption must not outrank the preceding artwork.
      if(serialPlates&&dp===0&&c.b[1]<p.h*.16&&!b.native&&b.strength<.25&&b.letterCount<2&&box[3]-box[1]<p.h*.13&&
         pages[c.page-2]?.blocks.some(q=>q.native&&area(q.b)>.22*p.w*p.h))score-=70;
      score+=c.strength*2+Math.min(3,b.strength)*6+Math.min(.65,area(box)/(p.w*p.h))*23+Math.min(8,b.letterCount);
      if(dp===0 && p.tables.some(t=>Math.abs(t[1]-box[3])<Math.abs(c.b[1]-box[3])*.7 && Math.abs(t[0]-box[0])<p.w*.25))score-=48;
      edges.push({key,c,b,score});
    }
    // Match in printed Figure order. Two legends can share a page while their
    // artworks are on either side; nearest-caption greedy matching swaps them.
    for(const kind of ['main','ed','supp']){
      const keys=[...identities].filter(([,id])=>id.kind===kind).sort((a,b)=>a[1].n-b[1].n||a[1].page-b[1].page).map(t=>t[0]);
      const candidates=blocks.filter(b=>!matched.has(b)).sort((a,b)=>a.page-b.page||(Math.abs(a.b[1]-b.b[1])<21?a.b[0]-b.b[0]:a.b[1]-b.b[1]));
      const byKey=new Map(keys.map(k=>[k,new Map()]));
      for(const e of edges){const m=byKey.get(e.key);if(m&&e.score>46&&e.score>(m.get(e.b)?.score??0))m.set(e.b,e);}
      const dp=Array.from({length:keys.length+1},()=>new Float64Array(candidates.length+1));
      for(let i=1;i<=keys.length;i++)for(let j=1;j<=candidates.length;j++){
        const edge=byKey.get(keys[i-1]).get(candidates[j-1]);
        dp[i][j]=Math.max(dp[i-1][j],dp[i][j-1],edge?dp[i-1][j-1]+edge.score:-1);
      }
      let i=keys.length,j=candidates.length;
      while(i&&j){
        const e=byKey.get(keys[i-1]).get(candidates[j-1]);
        if(e&&dp[i][j]===dp[i-1][j-1]+e.score){chosen.set(e.key,e);matched.add(e.b);i--;j--;}
        else if(dp[i][j]===dp[i-1][j])i--;else j--;
      }
    }
    // Some PDFs put all legends together and all artwork later in the document.
    // Pair only an uninterrupted run of distant plates with the same number of
    // unplaced captions, then leave the proposed identities marked for review.
    for(const kind of ['main','supp','ed']){
      const pending=[...identities].filter(([key,c])=>!chosen.has(key)&&c.kind===kind&&c.strength>=2);
      if(pending.length<2)continue;
      const platePages=pages.filter(p=>!p.caps.length&&!p.tables.length&&!p.form&&p.proseCount<12).map(p=>{
        const large=p.blocks.filter(b=>!matched.has(b)&&(b.native||b.letterCount>=3)&&area(b.b)>.18*p.w*p.h);
        return large.length===1?large[0]:null;
      }).filter(Boolean);
      if(platePages.length!==pending.length||platePages.some((b,i)=>i&&b.page-platePages[i-1].page>2))continue;
      pending.sort((a,b)=>a[1].n-b[1].n);if(platePages.some(b=>pending.some(([,c])=>Math.abs(b.page-c.page)<=1)))continue;
      pending.forEach(([key,c],i)=>{const b=platePages[i];chosen.set(key,{c,b,score:60});matched.add(b);});
    }
    const results=[];
    for(const [key,c] of identities){
      const hit=chosen.get(key);
      if(!hit&&c.strength<2)continue;
      results.push({name:c.name+(c.continued?' (续 P'+c.page+')':''),groupId:c.kind+c.n,group:c.name,kind:c.kind,n:c.n,page:hit?.b.page??c.page,
        box:hit?.b.b??null,resolution:hit?.b.resolution,captionPage:hit?.c.page??c.page,caption:(hit?.c??c).s,
        panelRun:serialPlates?(hit?.c??c).panelRun:null,uncertain:!hit||hit.score<79});
    }
    // Standalone graphical pages with no usable caption stay visible for review.
    for(const b of blocks)if(!matched.has(b)){
      const p=pages[b.page-1],box=b.b;
      if(p.tables.length || area(box)<p.w*p.h*.11 || (!b.native&&(b.letterCount<3||b.strength<.28)) || p.caps.length)continue;
      results.push({name:'待命名 P'+b.page,kind:'unknown',n:b.page,page:b.page,box,resolution:b.resolution,captionPage:null,caption:'',uncertain:true});
    }
    const rank={main:0,supp:1,ed:2,unknown:3};
    return results.sort((a,b)=>rank[a.kind]-rank[b.kind]||a.n-b.n||a.page-b.page);
  }
  async function render(doc,number,box,scale=3){
    const page=await doc.getPage(number),pageRect=page.getViewport({scale:1});
    box??=[0,0,pageRect.width,pageRect.height];
    const w=box[2]-box[0],h=box[3]-box[1];
    if(!(w>0&&h>0))throw Error('图像区域为空');
    scale=Math.min(scale,4800/Math.max(w,h),Math.sqrt(12000000/(w*h)));
    const c=canvas(Math.max(1,Math.ceil(w*scale)),Math.max(1,Math.ceil(h*scale)));
    try{await page.render({canvas:c,viewport:page.getViewport({scale}),transform:[1,0,0,1,-box[0]*scale,-box[1]*scale],annotationMode:0,background:'white'}).promise;}
    catch(e){c.width=c.height=1;throw e;}
    finally{page.cleanup();}
    return c;
  }
  function hints(meta,box,source){
    const sx=source.width/(box[2]-box[0]),sy=source.height/(box[3]-box[1]);
    const within=v=>v.b[0]>=box[0]-1&&v.b[2]<=box[2]+1&&v.b[1]>=box[1]-1&&v.b[3]<=box[3]+1;
    const geom=v=>({x:(v.b[0]-box[0])*sx,y:(v.b[1]-box[1])*sy,w:(v.b[2]-v.b[0])*sx,h:(v.b[3]-v.b[1])*sy});
    return {letters:meta.letters.filter(within).map(v=>({...geom(v),letter:v.s,em:v.size*sy})),
      words:(meta.textBoxes||[]).filter(within).map(v=>({...geom(v),text:v.s}))};
  }
  return {open,scanPage,collect,render,hints};
})();
