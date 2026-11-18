(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,()=>{
  'use strict';
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function canvasWorldPoint(point,bounds,view){return {x:(point.x-bounds.left-view.x)/view.zoom,y:(point.y-bounds.top-view.y)/view.zoom};}
  function canvasRouteDistance(points,point){let distance=Infinity;for(let i=1;i<(points||[]).length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,f=clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);distance=Math.min(distance,Math.hypot(point.x-a.x-f*dx,point.y-a.y-f*dy));}return distance;}
  function canvasProjectRoutePoint(points,point){
    let best=null,distance=Infinity;
    for(let i=1;i<(points||[]).length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,t=clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1),p={x:a.x+t*dx,y:a.y+t*dy},d=Math.hypot(point.x-p.x,point.y-p.y);if(d<distance){distance=d;best=p;}}
    return best;
  }
  function canvasRouteTarget(routes,point,zoom,{radius=24,ambiguity=4,explicitId}={}){if(explicitId&&routes.some(r=>r.id===explicitId&&!r.blocked))return {id:explicitId,ambiguous:false};const candidates=routes.filter(r=>!r.blocked).map(r=>({id:r.id,distance:canvasRouteDistance(r.points,point)})).filter(r=>r.distance<=radius/zoom).sort((a,b)=>a.distance-b.distance);const ambiguous=!!(candidates[1]&&candidates[1].distance-candidates[0].distance<ambiguity/zoom);return {id:candidates.length&&!ambiguous?candidates[0].id:null,ambiguous};}
  function canvasGestureMode({presentation,pan,middle,port,reconnect,resize,object,edge,shift}={}){return presentation||pan||middle?'pan':port||reconnect?'connect':resize?'resize':object?'move':edge?'edge':shift?'marquee':'pan';}
  function canvasToggleSelection(selection,id,shift){return !shift?[id]:selection.includes(id)?selection.filter(x=>x!==id):[...new Set([...selection,id])];}
  function canvasPan(view,start,point){return {...view,x:view.x+point.x-start.x,y:view.y+point.y-start.y};}
  function canvasPortTarget(boxes,point,zoom=1,{radius=18,exclude=[]}={}){
    let best=null;
    for(const b of boxes){if(exclude.includes(b.id))continue;const w=b.width??b.w,h=b.height??b.h;
      for(const side of ['left','right','top','bottom']){
        const vertical=side==='left'||side==='right',length=vertical?h:w;
        let offset=clamp(((vertical?point.y:point.x)-(vertical?b.y:b.x))/length,.05,.95);
        const quarter=Math.round(offset*4)/4;if(quarter>0&&quarter<1&&Math.abs(offset-quarter)*length*zoom<=6)offset=quarter;
        const p={x:side==='left'?b.x:side==='right'?b.x+w:b.x+w*offset,y:side==='top'?b.y:side==='bottom'?b.y+h:b.y+h*offset};
        const distance=Math.hypot(point.x-p.x,point.y-p.y);
        const inside=point.x>=b.x&&point.x<=b.x+w&&point.y>=b.y&&point.y<=b.y+h;
        if((inside||distance<=radius/zoom)&&(!best||distance<best.distance))best={id:b.id,port:{side,offset},point:p,distance};
      }
    }return best;
  }
  function canvasEditRoute(points,kind,index,point){
    const p=points.map(p=>({x:p.x,y:p.y}));if(p.length<2)return p;
    if(kind==='segment'){
      if(index<0||index>=p.length-1)return p;
      const a=p[index],b=p[index+1],horizontal=a.y===b.y;
      const c=horizontal?{x:a.x,y:point.y}:{x:point.x,y:a.y},d=horizontal?{x:b.x,y:point.y}:{x:point.x,y:b.y};
      if(index+1===p.length-1)p.splice(index+1,0,d);else p[index+1]=d;
      if(index===0)p.splice(1,0,c);else p[index]=c;
    }else{
      if(index<=0||index>=p.length-1)return p;
      const old=p[index],a=p[index-1],b=p[index+1],q={x:point.x,y:point.y};
      const before=a.x===old.x?{x:a.x,y:q.y}:{x:q.x,y:a.y},after=b.x===old.x?{x:b.x,y:q.y}:{x:q.x,y:b.y};
      p.splice(index,1,before,q,after);
    }
    const out=[];
    for(const q of p){const b=out.at(-1),a=out.at(-2);if(b&&b.x===q.x&&b.y===q.y)continue;
      if(a&&((a.x===b.x&&b.x===q.x&&(b.y-a.y)*(q.y-b.y)>=0)||(a.y===b.y&&b.y===q.y&&(b.x-a.x)*(q.x-b.x)>=0)))out.pop();out.push(q);
    }return out;
  }
  // Edge/centre target collection and nearest-in-range selection follow Konva's
  // Objects Snapping demo; resize targets follow interact.js snapSize/snapEdges.
  // This renderer-neutral adapter adds preview and zoom-scaled thresholds.
  function canvasSnapBox(box,neighbors,{enabled=false,resize=false,zoom=1,range=6,previewRange=12}={}){
    const result={box:{...box},preview:{...box},guides:[]};if(!enabled)return result;
    const limit=previewRange/zoom,snap=range/zoom;
    for(const [axis,size] of [['x','width'],['y','height']]){
      let best=null;
      for(const other of neighbors){
        const gapX=Math.max(0,other.x-box.x-box.width,box.x-other.x-other.width),gapY=Math.max(0,other.y-box.y-box.height,box.y-other.y-other.height);
        if(Math.hypot(gapX,gapY)>300/zoom)continue;
        const targets=[other[axis],other[axis]+other[size]/2,other[axis]+other[size]];
        const anchors=resize?[box[axis]+box[size]]:[box[axis],box[axis]+box[size]/2,box[axis]+box[size]];
        const choices=targets.flatMap(target=>anchors.map(anchor=>({delta:target-anchor,target,kind:'edge'})));
        if(resize)choices.push({delta:other[size]-box[size],target:box[axis]+other[size],kind:'size'});
        for(const c of choices)if(Math.abs(c.delta)<=limit&&(!best||Math.abs(c.delta)<Math.abs(best.delta)))best={...c,other};
      }
      if(!resize){
        const cross=axis==='x'?'y':'x',crossSize=axis==='x'?'height':'width';
        const row=neighbors.filter(n=>Math.min(n[cross]+n[crossSize],box[cross]+box[crossSize])>Math.max(n[cross],box[cross])&&Math.max(0,n[axis]-box[axis]-box[size],box[axis]-n[axis]-n[size])<=300/zoom).slice().sort((a,b)=>a[axis]-b[axis]);
        for(let i=1;i<row.length;i++){
          const a=row[i-1],b=row[i],gap=b[axis]-a[axis]-a[size];if(gap<0)continue;
          const candidates=[{target:a[axis]-gap-box[size],placement:'before'},{target:b[axis]+b[size]+gap,placement:'after'}];
          if(gap>=box[size])candidates.push({target:(a[axis]+a[size]+b[axis]-box[size])/2,placement:'between'});
          for(const c of candidates){
            if(row.some(n=>c.target<n[axis]+n[size]&&c.target+box[size]>n[axis]))continue;
            const delta=c.target-box[axis];if(Math.abs(delta)<=limit&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={...c,delta,kind:'gap',other:a,pair:[a,b]};
          }
        }
      }
      if(best){const key=resize?size:axis;if(resize&&box[size]+best.delta<1)continue;
        result.preview[key]+=best.delta;if(Math.abs(best.delta)<=snap)result.box[key]+=best.delta;
        result.guides.push({axis,value:best.target,kind:best.kind,other:best.other,pair:best.pair,placement:best.placement,snapped:Math.abs(best.delta)<=snap});
      }
    }return result;
  }
  function canvasSnapGuidePath(g,p){
    if(g.kind!=='gap')return g.axis==='x'?'M '+g.value+' '+(Math.min(p.y,g.other.y)-16)+' V '+(Math.max(p.y+p.height,g.other.y+g.other.height)+16):'M '+(Math.min(p.x,g.other.x)-16)+' '+g.value+' H '+(Math.max(p.x+p.width,g.other.x+g.other.width)+16);
    const axis=g.axis,size=axis==='x'?'width':'height',cross=axis==='x'?'y':'x',rows=[...g.pair,p].sort((a,b)=>a[axis]-b[axis]),level=Math.min(...rows.map(r=>r[cross]))-14;
    return rows.slice(1).map((r,i)=>{const start=rows[i][axis]+rows[i][size],end=r[axis];return axis==='x'?`M ${start} ${level} H ${end} M ${start} ${level-4} V ${level+4} M ${end} ${level-4} V ${level+4}`:`M ${level} ${start} V ${end} M ${level-4} ${start} H ${level+4} M ${level-4} ${end} H ${level+4}`;}).join(' ');
  }
  return {canvasWorldPoint,canvasRouteDistance,canvasProjectRoutePoint,canvasRouteTarget,canvasGestureMode,canvasToggleSelection,canvasPan,canvasPortTarget,canvasEditRoute,canvasSnapBox,canvasSnapGuidePath};
});
