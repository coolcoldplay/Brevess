/* Shipping hover controls, magnifier, viewer and annotation editor, with public image assets. */
window.BVCreateImageTools=({root,data:d,onToast,onViewerState,onNote,onOpen})=>{
 const paper=root.querySelector('.bv-paper'),images=[...paper.querySelectorAll('figure img')],sources=new Map(images.map(image=>[image,image.src]));
 const disabled=new WeakSet(),promoted=new Map(),resources=new Map(),previews=new Map(),notes=new Map(),layers=new Map(),sessions=new Map(),preferences={};
 let viewer=null,frame=null,epoch=0,positionFrame=0;
 SciLLM.publicPageStorage={get:async key=>({[key]:preferences[key]}),set:async value=>Object.assign(preferences,value)};
 const figures=()=>d.figures.map(f=>({...f,figureId:'Fig'+f.id,figureLabel:'Fig '+f.id,figureNumber:f.id,imageElements:[paper.querySelector('#bv-figure-'+f.id+' img')]}));
 const figureFor=image=>figures().find(f=>f.imageElements[0]===image);
 // The full public assets are retained by the browser; initial display uses a
 // reduced preview so HR demonstrates a real resolution change, without an API.
 for(const image of images){
  const preview=()=>{if(previews.has(image)||promoted.has(image)||!image.naturalWidth)return;const canvas=document.createElement('canvas'),scale=Math.min(1,600/image.naturalWidth);canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const source=canvas.toDataURL('image/jpeg',.83);previews.set(image,source);image.src=source;};
  image.addEventListener('load',preview);if(image.complete)preview();
 }
 async function resourceFor(figure){
  const source=sources.get(figure.imageElements[0]);if(!resources.has(source))resources.set(source,(async()=>{const response=await fetch(source);if(!response.ok)throw Error('论文图片读取失败');const bytes=new Uint8Array(await response.arrayBuffer()),hash=await crypto.subtle.digest('SHA-256',bytes);return {bytes,sourceUrl:source,requestedSourceUrl:source,contentType:'image/png',pixelWidth:figure.width,pixelHeight:figure.height,sha256:[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')};})().catch(error=>{resources.delete(source);throw error;}));return resources.get(source);
 }
 function promote(figure,resource){const image=figure.imageElements[0];image.src=resource.sourceUrl;promoted.set(image,{...resource,figureId:figure.figureId,imageIndex:0,display:{source:resource.sourceUrl,width:resource.pixelWidth,height:resource.pixelHeight,fit:'fill',position:'50% 50%'}});return true;}
 async function highResolution(image){const current=epoch,figure=figureFor(image),resource=await resourceFor(figure);if(current!==epoch)return false;promote(figure,resource);onToast(`已显示高清论文图片：${resource.pixelWidth} × ${resource.pixelHeight}。本次体验可重复复用。`);return true;}
 async function sessionFor(figure,resource){
  if(!sessions.has(figure.figureId))sessions.set(figure.figureId,SciLLM.createFigureAnnotationSession({binding:SciLLM.figureAnnotationBinding({documentKey:d.source,figureId:figure.figureId,imageIndex:0,sha256:resource.sha256,width:resource.pixelWidth,height:resource.pixelHeight}),save:async()=>({saved:true})}));return sessions.get(figure.figureId);
 }
 async function toggleAnnotations(image){
  const old=layers.get(image);if(old){old.destroy();layers.delete(image);return;}
  const current=epoch,figure=figureFor(image),resource=await resourceFor(figure);if(current!==epoch)return;promote(figure,resource);
  const session=await sessionFor(figure,resource);if(current!==epoch)return;const overlay=SciLLM.createFigureAnnotationOverlay({image,clipElement:paper,binding:session.getState().binding,getDisplaySource:image=>promoted.get(image),isVisible:()=>!frame});
  overlay.element.style.zIndex='2147482999';const unsubscribe=session.subscribe(state=>overlay.render(state.objects));
  layers.set(image,{refresh:overlay.refresh,destroy(){unsubscribe();overlay.destroy();}});
  if(!session.getState().objects.length)onToast('此图还没有标注。长按画笔按钮 0.5 秒，在查看器中画箭头或框选后保存。');
 }
 function positionViewer(){if(!frame)return;const r=root.getBoundingClientRect(),p=paper.getBoundingClientRect();Object.assign(frame.style,{left:(p.left-r.left)+'px',top:(p.top-r.top)+'px',width:p.width+'px',height:p.height+'px'});}
 const viewport=new ResizeObserver(positionViewer);viewport.observe(paper);
 function removeViewer(){const previous=frame;frame=null;viewer=null;previous?.remove();for(const layer of layers.values())layer.refresh();}
 async function open(id){
  onOpen();magnifier.hide();viewer?.close();removeViewer();
  const generation=epoch,created=document.createElement('iframe');created.className='bv-image-surface';created.title='BREVESS 高清原图与标注';frame=created;root.append(created);positionViewer();
  created.addEventListener('load',()=>{
   if(generation!==epoch||frame!==created)return;
   const api=BVCreateFigureViewer({document:created.contentDocument,window:created.contentWindow,SciLLM,bodyFigureAnnotationLayers:layers,getFigureViewerInventory:figures,
    loadSharedFigureOriginalResource:async figure=>({sources:[sources.get(figure.imageElements[0])],resource:await resourceFor(figure),cacheMode:'none',current:()=>generation===epoch&&frame===created}),
    promoteSavedFigureOriginalDisplay:async(figure,resource)=>generation===epoch&&frame===created?promote(figure,resource):false,
    bindAnnotations:async(viewer,image,canvas,controls,figure,resource)=>{const session=await sessionFor(figure,resource);if(generation!==epoch||frame!==created||!viewer.isConnected)return;return SciLLM.createFigureAnnotationEditor({image,canvas,controls,session});},
    publishFigureImageViewerState:state=>{onViewerState(state);if(!state.open)queueMicrotask(()=>{if(frame===created)removeViewer();});}
   });viewer=api;void api.open('Fig'+id).catch(error=>{onToast(error.message);api.close();});
  },{once:true});created.src='assets/demo/image-viewer-frame.html?v=20261118-native4';
 }
 function note(image){const figure=figureFor(image);SciLLM.openFigureNoteEditor({document,title:figure.figureLabel+' · 图片笔记',value:notes.get(figure.figureId)||'',onSave:async value=>{notes.set(figure.figureId,value);onNote({figureId:figure.figureId,value});onToast('图片笔记已保留在本次体验中，可重新打开查看。');}});}
 const magnifier=SciLLM.createFigureMagnifier({document,isActive:()=>!frame,acceptImage:image=>images.includes(image)&&!disabled.has(image),getDisplaySource:image=>promoted.get(image)});
 const createControls=()=>SciLLM.createFigureQuickControls({document,isActive:()=>!frame,acceptImage:image=>images.includes(image),isHighResolution:image=>promoted.has(image),isMagnifierEnabled:image=>!disabled.has(image),isAnnotationsVisible:image=>layers.has(image),onHighResolution:highResolution,onToggleMagnifier:image=>{if(disabled.has(image))disabled.delete(image);else disabled.add(image);magnifier.hide();},onToggleAnnotations:toggleAnnotations,onOpenAnnotations:image=>void open(figureFor(image).id),onOpenNotes:note});
 let controls=createControls();
 // The real extension uses the browser viewport; this page embeds that viewport
 // inside a scrollable paper. Keep the unchanged rail within that visible area.
 document.addEventListener('pointermove',()=>{if(positionFrame)return;positionFrame=requestAnimationFrame(()=>{positionFrame=0;const host=document.querySelector('[data-brevess-figure-tools]');if(!host||host.style.display==='none')return;const p=paper.getBoundingClientRect(),top=Math.max(p.top+4,parseFloat(host.style.top)||0);host.style.setProperty('top',top+'px','important');const bar=host.shadowRoot?.querySelector('.tools');if(bar)bar.style.maxHeight=Math.max(36,p.bottom-top-4)+'px';});},{passive:true});
 return {open,close(){viewer?.close();removeViewer();},state:()=>({magnifier:magnifier.getState(),notes:Object.fromEntries(notes),annotations:[...sessions].map(([figureId,s])=>({figureId,...s.getState()}))}),
  reset(){epoch++;controls.destroy();viewer?.close();removeViewer();magnifier.hide();for(const layer of layers.values())layer.destroy();layers.clear();notes.clear();sessions.clear();promoted.clear();document.querySelectorAll('[data-brevess-figure-note]').forEach(n=>n.remove());for(const image of images){disabled.delete(image);image.removeAttribute('style');image.src=previews.get(image)||sources.get(image);}controls=createControls();}
 };
};
