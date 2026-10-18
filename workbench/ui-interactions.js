(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.Workbench ||= {},api);})(globalThis,()=>{
  'use strict';
  function clampFloatingPanel(rect,viewport){const gap=8,w=Math.min(rect.w,Math.max(1,viewport.w-gap*2)),h=Math.min(rect.h,Math.max(1,viewport.h-gap*2));return {x:Math.max(gap,Math.min(rect.x,viewport.w-w-gap)),y:Math.max(gap,Math.min(rect.y,viewport.h-h-gap)),w,h};}
  function pastedImages(data,editing=false){if(editing||!data)return [];const files=data.items?.length?Array.from(data.items).filter(i=>i.kind==='file').map(i=>i.getAsFile()):Array.from(data.files||[]);return files.filter(f=>f&&/^image\/(?:png|jpeg|webp)$/.test(f.type));}
  return {clampFloatingPanel,pastedImages};
});
