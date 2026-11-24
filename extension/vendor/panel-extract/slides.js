/* PNG exports and editable slide pictures use the same source coordinates. */
const PanelFiles=(()=>{
  const {asXYWH,bounds,selection,paint,png}=PanelOutput;
  function thumbnail(c){
    const s=Math.min(1,180/c.width,138/c.height),t=PanelEngine.makeCanvas(Math.max(1,Math.round(c.width*s)),Math.max(1,Math.round(c.height*s)));
    t.getContext('2d').drawImage(c,0,0,t.width,t.height);return t.toDataURL('image/png');
  }
  async function outputs(model,pad,paper,ids=model.items.map((_,i)=>i)){
    const result=[];
    for(const id of ids){
      const item=model.items[id],c=paint(model,id,'clean',pad,paper),box=bounds(model,id,pad);
      try{result.push({id,label:item.label,whole:!!item.whole,selected:item.pack!==false,review:!!item.review,box:asXYWH(box),
        mask:selection(model,id,box),blob:await png(c),thumb:thumbnail(c)});}
      finally{c.width=c.height=1;}
    }
    return result;
  }
  function filename(name,p){return name+(p.whole?'':/^[a-z]$/i.test(p.label)?p.label.toUpperCase():p.label)+'.png';}
  function validName(name){return !!name&&name.length<=110&&!/[\\/:*?"<>|\u0000-\u001f]/.test(name)&&!/[. ]$/.test(name)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);}
  return {outputs,filename,validName};
})();
const PanelSlides=(()=>{
  const P='http://schemas.openxmlformats.org/presentationml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main',
    R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',PKG='http://schemas.openxmlformats.org/package/2006/relationships',
    CT='http://schemas.openxmlformats.org/package/2006/content-types';
  const raw=s=>Uint8Array.from(atob(s),ch=>ch.charCodeAt(0));
  const xmlParse=s=>new DOMParser().parseFromString(s,'application/xml');
  const xmlDoc=d=>new XMLSerializer().serializeToString(d);
  const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const cache=new WeakMap();
  const emuPerPoint=12700,maxSlideSide=51206400;
  const measure=document.createElement('canvas').getContext('2d');
  measure.font='bold 100px Arial, sans-serif';
  function layout(sheets){
    const w=Math.max(...sheets.map(s=>s.physical[0])),h=Math.max(...sheets.map(s=>s.physical[1]));
    const fontPt=Math.max(12,Math.min(30,Math.round(w*.043))),header=2*fontPt*emuPerPoint;
    const scale=Math.min(emuPerPoint,maxSlideSide/w,(maxSlideSide-header)/h);
    const contentHeight=Math.max(914400,Math.round(h*scale));
    const longest=Math.max(...sheets.map(s=>measure.measureText(s.name).width));
    // Keep long custom titles legible even on a very narrow figure.
    const titleWidth=Math.ceil((longest*9/100+fontPt)*emuPerPoint);
    return {scale,w:Math.min(maxSlideSide,Math.max(914400,Math.round(w*scale),titleWidth)),h:contentHeight+header,contentHeight,header,fontPt};
  }
  function titleBox(name,frame){
    const x=Math.round(frame.header*.25),y=Math.round(frame.header*.12),w=frame.w-2*x;
    const pt=Math.min(frame.fontPt,w/emuPerPoint*100/Math.max(1,measure.measureText(name).width));
    return {x,y,w,h:frame.header-2*y,pt:Math.max(1,Math.floor(pt*100)/100)};
  }
  function position(sheet,p,frame){
    const [width,height]=sheet.physical,[sw,sh]=sheet.size,[x,y,w,h]=p.layoutBox||p.box, scale=frame.scale;
    return [Math.round((frame.w-width*scale)/2+x*width/sw*scale),frame.header+Math.round((frame.contentHeight-height*scale)/2+y*height/sh*scale),
      Math.max(1,Math.round(w*width/sw*scale)),Math.max(1,Math.round(h*height/sh*scale))];
  }
  async function placed(p,others){
    const usesCuts=p.mask.white.some(b=>b[2].length),key=usesCuts?others.map(v=>v.id).join(','):'';
    const existing=cache.get(p);if(existing?.key===key)return existing.blob;
    const [x,y,w,h]=p.box,c=PanelEngine.makeCanvas(w,h),ctx=c.getContext('2d'),image=await createImageBitmap(p.blob);
    try{
      ctx.drawImage(image,0,0);image.close();
      for(const [t,b,runs] of p.mask.keep){
        let cursor=0;
        for(let i=0;i<runs.length;i+=2){
          if(runs[i]>cursor)ctx.clearRect(cursor,t,runs[i]-cursor,b-t);
          cursor=runs[i+1];
        }
        if(cursor<w)ctx.clearRect(cursor,t,w-cursor,b-t);
      }
      ctx.fillStyle='white';
      const neighbours=usesCuts?others.filter(q=>q!==p&&q.part===p.part&&q.box[0]<x+w&&q.box[0]+q.box[2]>x&&q.box[1]<y+h&&q.box[1]+q.box[3]>y):[];
      for(const [t,b,runs] of p.mask.white)for(let i=0;i<runs.length;i+=2){
        const l=runs[i],r=runs[i+1];ctx.fillRect(l,t,r-l,b-t);
        // Make cutouts transparent where another included picture owns the source.
        // On a white slide unowned cutouts stay white, regardless of picture order.
        for(const q of neighbours){
          const dx=q.box[0]-x,dy=q.box[1]-y;
          for(const [qt,qb,qr] of q.mask.keep){
            if(qt+dy>=b)break;
            const top=Math.max(t,qt+dy),bot=Math.min(b,qb+dy);if(bot<=top)continue;
            for(let j=0;j<qr.length;j+=2){const a=Math.max(l,dx+qr[j]),z=Math.min(r,dx+qr[j+1]);if(a<z)ctx.clearRect(a,top,z-a,bot-top);}
          }
        }
      }
      const blob=await PanelOutput.png(c);cache.set(p,{key,blob});return blob;
    }finally{c.width=c.height=1;}
  }
  async function preview(sheet,sheets){
    const f=layout(sheets),k=1200/Math.max(f.w,f.h),c=PanelEngine.makeCanvas(Math.max(1,Math.round(f.w*k)),Math.max(1,Math.round(f.h*k)));
    const cx=c.getContext('2d');cx.fillStyle='white';cx.fillRect(0,0,c.width,c.height);
    const title=titleBox(sheet.name,f);cx.fillStyle='#202020';cx.textBaseline='middle';
    cx.font='bold '+(title.pt*emuPerPoint*k)+'px Arial, sans-serif';
    cx.fillText(sheet.name,title.x*k,(title.y+title.h/2)*k,title.w*k);
    for(const p of sheet.outputs){
      const b=await createImageBitmap(await placed(p,sheet.outputs));const [x,y,w,h]=position(sheet,p,f);
      cx.drawImage(b,x*k,y*k,w*k,h*k);b.close();
    }
    const blob=await PanelOutput.png(c);c.width=c.height=1;return blob;
  }
  function append(doc,parent,ns,name,attrs){
    const e=doc.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e;
  }
  function setSlideTitle(tree,name,frame,shapeId){
    const textBox=tree.getElementsByTagNameNS(P,'sp')[0],title=titleBox(name,frame);
    const first=tag=>textBox.getElementsByTagNameNS(A,tag)[0];
    textBox.getElementsByTagNameNS(P,'cNvPr')[0].setAttribute('id',shapeId);
    first('off').setAttribute('x',title.x);first('off').setAttribute('y',title.y);
    first('ext').setAttribute('cx',title.w);first('ext').setAttribute('cy',title.h);
    first('rPr').setAttribute('sz',Math.round(title.pt*100));first('t').textContent=name;
  }
  async function make(sheets,progress){
    if(!sheets.length||sheets.some(s=>!s.outputs.length))throw Error('请选择至少一个 Panel');
    const parts=JSON.parse(document.getElementById('pptParts').textContent),frame=layout(sheets),files=[];
    const parse=name=>xmlParse(new TextDecoder().decode(raw(parts[name])));
    const pres=parse('ppt/presentation.xml'),rels=parse('ppt/_rels/presentation.xml.rels'),types=parse('[Content_Types].xml');
    const slideIds=pres.getElementsByTagNameNS(P,'sldIdLst')[0],size=pres.getElementsByTagNameNS(P,'sldSz')[0];
    slideIds.replaceChildren();size.setAttribute('cx',frame.w);size.setAttribute('cy',frame.h);size.removeAttribute('type');
    for(const e of [...rels.documentElement.children])if(e.getAttribute('Type').endsWith('/slide'))e.remove();
    for(const e of [...types.documentElement.children])if(e.getAttribute('PartName')?.startsWith('/ppt/slides/slide'))e.remove();
    if(![...types.documentElement.children].some(e=>e.getAttribute('Extension')==='png'))
      append(types,types.documentElement,CT,'Default',{Extension:'png',ContentType:'image/png'});
    const rootrels=parse('_rels/.rels');for(const e of [...rootrels.documentElement.children])if(e.getAttribute('Type').endsWith('/thumbnail'))e.remove();
    const app=parse('docProps/app.xml'),counter=app.getElementsByTagName('Slides')[0];if(counter)counter.textContent=sheets.length;
    const dyn=new Map([['ppt/presentation.xml',pres],['ppt/_rels/presentation.xml.rels',rels],['[Content_Types].xml',types],['_rels/.rels',rootrels],['docProps/app.xml',app]]);
    const put=(name,s)=>files.push({name,blob:new Blob([s])});
    let picture=0;
    for(const [i,s] of sheets.entries()){
      const n=i+1,rid='rIdSlide'+n,el=append(pres,slideIds,P,'p:sldId',{id:255+n});
      el.setAttributeNS(R,'r:id',rid);
      append(rels,rels.documentElement,PKG,'Relationship',{Id:rid,Type:R+'/slide',Target:'slides/slide'+n+'.xml'});
      append(types,types.documentElement,CT,'Override',{PartName:'/ppt/slides/slide'+n+'.xml',ContentType:'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'});
      const slide=parse('ppt/slides/slide1.xml'),sr=parse('ppt/slides/_rels/slide1.xml.rels');
      slide.documentElement.setAttribute('showMasterSp','0');
      const common=slide.getElementsByTagNameNS(P,'cSld')[0];common.setAttribute('name',s.name);
      const tree=slide.getElementsByTagNameNS(P,'spTree')[0];
      setSlideTitle(tree,s.name,frame,s.outputs.length+2);
      for(const [j,p] of s.outputs.entries()){
        const [x,y,w,h]=position(s,p,frame),id='rIdImage'+(j+1),media='panel'+(++picture)+'.png';
        const title=PanelFiles.filename(s.name,p).slice(0,-4);
        const pic=xmlParse('<p:pic xmlns:p="'+P+'" xmlns:a="'+A+'" xmlns:r="'+R+'"><p:nvPicPr><p:cNvPr id="'+(j+2)+'" name="'+escape(title)+'"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="'+id+'"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="'+x+'" y="'+y+'"/><a:ext cx="'+w+'" cy="'+h+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>');
        tree.append(slide.importNode(pic.documentElement,true));
        append(sr,sr.documentElement,PKG,'Relationship',{Id:id,Type:R+'/image',Target:'../media/'+media});
        files.push({name:'ppt/media/'+media,blob:await placed(p,s.outputs)});
      }
      put('ppt/slides/slide'+n+'.xml',xmlDoc(slide));put('ppt/slides/_rels/slide'+n+'.xml.rels',xmlDoc(sr));
      progress?.(n,sheets.length);
    }
    for(const [name,encoded] of Object.entries(parts))if(!name.startsWith('ppt/slides/')&&!dyn.has(name))put(name,raw(encoded));
    for(const [name,doc] of dyn)put(name,xmlDoc(doc));
    const data=await PanelOutput.zip(files);
    return new Blob([data],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
  }
  return {make,preview};
})();
