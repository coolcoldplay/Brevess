(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,()=>{
  'use strict';
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function canvasWorldPoint(point,bounds,view){return {x:(point.x-bounds.left-view.x)/view.zoom,y:(point.y-bounds.top-view.y)/view.zoom};}
  function canvasRouteDistance(points,point){let distance=Infinity;for(let i=1;i<(points||[]).length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,f=clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);distance=Math.min(distance,Math.hypot(point.x-a.x-f*dx,point.y-a.y-f*dy));}return distance;}
  function canvasRouteTarget(routes,point,zoom,{radius=24,ambiguity=4,explicitId}={}){if(explicitId&&routes.some(r=>r.id===explicitId&&!r.blocked))return {id:explicitId,ambiguous:false};const candidates=routes.filter(r=>!r.blocked).map(r=>({id:r.id,distance:canvasRouteDistance(r.points,point)})).filter(r=>r.distance<=radius/zoom).sort((a,b)=>a.distance-b.distance);const ambiguous=!!(candidates[1]&&candidates[1].distance-candidates[0].distance<ambiguity/zoom);return {id:candidates.length&&!ambiguous?candidates[0].id:null,ambiguous};}
  function canvasGestureMode({presentation,pan,middle,port,reconnect,resize,object,edge,shift}={}){return presentation||pan||middle?'pan':port||reconnect?'connect':resize?'resize':object?'move':edge?'edge':shift?'marquee':'pan';}
  function canvasToggleSelection(selection,id,shift){return !shift?[id]:selection.includes(id)?selection.filter(x=>x!==id):[...new Set([...selection,id])];}
  function canvasPan(view,start,point){return {...view,x:view.x+point.x-start.x,y:view.y+point.y-start.y};}
  return {canvasWorldPoint,canvasRouteDistance,canvasRouteTarget,canvasGestureMode,canvasToggleSelection,canvasPan};
});
