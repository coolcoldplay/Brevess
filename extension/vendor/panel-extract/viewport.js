/* Each viewport maps a window of original image pixels to CSS pixels. */
function panelViewport(stage, surface, readout) {
  const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
  let box=[0,0,1,1], scale=1, mode='fit', left=0, top=0, width=0, height=0;
  const ring=stage.querySelector('.eraser-ring');
  const guide=document.createElement('canvas');
  guide.className='selection-guide';guide.hidden=true;guide.setAttribute('aria-hidden','true');
  stage.insertBefore(guide,ring);
  const imageWidth=()=>box[2]-box[0], imageHeight=()=>box[3]-box[1];
  function fit() {
    const margin=Math.min(28,Math.min(width,height)*.12);
    return Math.max(.001,Math.min((width-2*margin)/imageWidth(),(height-2*margin)/imageHeight()));
  }
  function constrain(offset,extent,frame) {
    const edge=Math.min(48,extent/2,frame/2);
    return clamp(offset,edge-extent,frame-edge);
  }
  function place(x,y) {
    const w=imageWidth()*scale,h=imageHeight()*scale;
    left=constrain(x,w,width);top=constrain(y,h,height);
    surface.style.width=w+'px';surface.style.height=h+'px';
    surface.style.transform='translate('+left+'px,'+top+'px)';
    readout.textContent=Math.round(scale*100)+'%';
  }
  function layout(next=box,preset=null) {
    const w=stage.clientWidth,h=stage.clientHeight;
    const center=[box[0]+(width/2-left)/scale,box[1]+(height/2-top)/scale];
    const first=!width||!height;
    box=next;
    if(preset)mode=preset;
    if(!w||!h)return;
    width=w;height=h;
    if(mode==='fit')scale=fit();
    else if(mode==='actual')scale=1;
    if(preset||first||mode==='fit'){
      place((w-imageWidth()*scale)/2,(h-imageHeight()*scale)/2);
    }else{
      place(w/2-(center[0]-box[0])*scale,h/2-(center[1]-box[1])*scale);
    }
  }
  function local(e) {
    const r=stage.getBoundingClientRect();
    return [e.clientX-r.left-stage.clientLeft,e.clientY-r.top-stage.clientTop];
  }
  function point(e) {
    const rect=surface.getBoundingClientRect();
    const px=box[0]+(e.clientX-rect.left)*imageWidth()/rect.width;
    const py=box[1]+(e.clientY-rect.top)*imageHeight()/rect.height;
    return [px,py];
  }
  function hit(e) {
    const [x,y]=local(e);
    return x>=0&&y>=0&&x<width&&y<height&&x>=left&&y>=top&&x<left+imageWidth()*scale&&y<top+imageHeight()*scale;
  }
  function zoom(value,e) {
    if(value==='fit'){layout(box,'fit');return;}
    const [x,y]=e?local(e):[width/2,height/2];
    const ix=(x-left)/scale,iy=(y-top)/scale;
    mode=value==='actual'?'actual':'custom';
    scale=mode==='actual'?1:clamp(scale*value,Math.min(1,fit())*.25,Math.max(12,fit()*6));
    place(x-ix*scale,y-iy*scale);
  }
  function cursor(e,diameter) {
    if(!e){ring.hidden=true;return;}
    const [x,y]=local(e);
    ring.hidden=x<0||x>=width||y<0||y>=height;if(ring.hidden)return;
    ring.style.left=x+'px';ring.style.top=y+'px';
    ring.style.width=ring.style.height=(diameter*scale)+'px';
  }
  function drawGuide(paint) {
    guide.hidden=!paint;
    if(!paint)return;
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
    if(guide.width!==w||guide.height!==h){guide.width=w;guide.height=h;}
    const ctx=guide.getContext('2d');
    ctx.resetTransform();ctx.clearRect(0,0,w,h);
    // Use the same rendered bounds as point(), including fractional CSS sizes.
    const frame=stage.getBoundingClientRect(),image=surface.getBoundingClientRect();
    const sx=image.width/imageWidth(),sy=image.height/imageHeight();
    const x=image.left-frame.left-stage.clientLeft-box[0]*sx;
    const y=image.top-frame.top-stage.clientTop-box[1]*sy;
    ctx.save();ctx.setTransform(sx*w/width,0,0,sy*h/height,x*w/width,y*h/height);
    paint(ctx);ctx.restore();
  }
  const observer=new ResizeObserver(()=>{if(stage.clientWidth!==width||stage.clientHeight!==height)layout();});
  observer.observe(stage);
  function pan(dx,dy){if(dx||dy){mode='custom';place(left+dx,top+dy);}}
  return {stage,surface,layout,zoom,point,hit,cursor,pan,drawGuide,dispose:()=>observer.disconnect(),
    get box(){return box},get scale(){return scale},get mode(){return mode}};
}
