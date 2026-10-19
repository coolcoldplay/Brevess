(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('../core/research-workbench-group-table.js'):root.SciLLM);if(common)module.exports=api;Object.assign(root.Workbench ||= {},api);})(globalThis,tables=>{
  'use strict';
  const T=value=>globalThis.SciLLM?.translateInterfaceText?.(value)||value;
  const clone=value=>structuredClone(value), uid=prefix=>prefix+'_'+crypto.randomUUID();
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const PANEL_STATUS_OPTIONS=Object.freeze([
    {value:'planned',label:'计划占位',color:'#fde8e7'},
    {value:'running',label:'进行中',color:'#fff3cc'},
    {value:'complete',label:'已完成',color:'#e5f4e8'},
    {value:'review',label:'待复核',color:'#efe7fa'},
  ].map(Object.freeze));
  // Read compatibility is deliberately separate from writes: opening an old
  // ready Panel must neither migrate its raw status nor discard its result.
  function panelStatus(panelOrRaw){
    const rawValue=panelOrRaw&&typeof panelOrRaw==='object'?panelOrRaw.status:panelOrRaw;
    const value=rawValue==null||rawValue===''?'planned':PANEL_STATUS_OPTIONS.some(o=>o.value===rawValue)?rawValue:'review';
    return {...PANEL_STATUS_OPTIONS.find(o=>o.value===value),rawValue,legacy:rawValue==='ready'};
  }
  function updatePanelStatus(panel,value){
    if(!PANEL_STATUS_OPTIONS.some(o=>o.value===value))throw Object.assign(Error('实验状态无效'),{code:'WORKBENCH_INVALID_PANEL_STATUS',details:{field:'status',allowedValues:PANEL_STATUS_OPTIONS.map(o=>o.value)}});
    const next=clone(panel);
    if(panel.status==='ready')next.statusSource={kind:'legacy',rawValue:'ready',...(Object.hasOwn(panel,'statusSource')?{previous:clone(panel.statusSource)}:{})};
    next.status=value;return next;
  }
  const TABLE_LIMITS=tables?.WORKBENCH_GROUP_TABLE_LIMITS,createGroupTable=tables?.createWorkbenchGroupTable,validateGroupTable=tables?.validateWorkbenchGroupTable,editGroupTable=tables?.editWorkbenchGroupTable;
  const rect=o=>({x:finite(o.x),y:finite(o.y),w:Math.max(40,finite(o.w??o.width,190)),h:Math.max(28,finite(o.h??o.height,82))});
  function portForPoint(object,point={}){
    const r=rect(object),x=finite(point.x,r.x+r.w/2),y=finite(point.y,r.y+r.h/2);
    const candidates=[
      {side:'left',distance:Math.abs(x-r.x),offset:(y-r.y)/r.h},
      {side:'right',distance:Math.abs(x-(r.x+r.w)),offset:(y-r.y)/r.h},
      {side:'top',distance:Math.abs(y-r.y),offset:(x-r.x)/r.w},
      {side:'bottom',distance:Math.abs(y-(r.y+r.h)),offset:(x-r.x)/r.w}
    ];
    const best=candidates.sort((a,b)=>a.distance-b.distance||['left','right','top','bottom'].indexOf(a.side)-['left','right','top','bottom'].indexOf(b.side))[0];
    return {side:best.side,offset:Math.max(0,Math.min(1,finite(best.offset,.5)))};
  }
  function bounds(objects){if(!objects.length)return {x:0,y:0,w:640,h:400};const rs=objects.map(rect),x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));return {x,y,w:Math.max(1,...rs.map(r=>r.x+r.w-x)),h:Math.max(1,...rs.map(r=>r.y+r.h-y))};}
  function fit(objects,width,height){
    const rs=objects.length?objects.map(rect):[{x:0,y:0,w:640,h:400}];
    width=Math.max(1,finite(width,900));height=Math.max(1,finite(height,600));
    // Normalize before subtracting extrema: two finite world coordinates can
    // otherwise have an infinite span. The fit scale is independent of the
    // ordinary manual zoom floor and never changes object geometry.
    const scale=Math.max(1,...rs.flatMap(r=>[Math.abs(r.x),Math.abs(r.y),r.w,r.h]));
    const left=Math.min(...rs.map(r=>r.x/scale)),top=Math.min(...rs.map(r=>r.y/scale));
    const right=Math.max(...rs.map(r=>r.x/scale+r.w/scale)),bottom=Math.max(...rs.map(r=>r.y/scale+r.h/scale));
    const w=Math.max(right-left,...rs.map(r=>r.w/scale),Number.MIN_VALUE),h=Math.max(bottom-top,...rs.map(r=>r.h/scale),Number.MIN_VALUE);
    const padding=Math.min(50,width/4,height/4);
    const zoom=Math.max(Number.MIN_VALUE,Math.min(2,Number.MAX_VALUE/scale/8,(width-2*padding)/w/scale,(height-2*padding)/h/scale));
    const scaled=scale*zoom;
    return {zoom,x:width/2-(left/2+right/2)*scaled,y:height/2-(top/2+bottom/2)*scaled,selection:[]};
  }
  function zoomAt(view,point,factor){const minimum=Math.min(.08,view.zoom),zoom=Math.max(minimum,Math.min(4,view.zoom*factor)),ratio=zoom/view.zoom;return {...view,zoom,x:point.x-(point.x-view.x)*ratio,y:point.y-(point.y-view.y)*ratio};}
  function world(view,point){return {x:(point.x-view.x)/view.zoom,y:(point.y-view.y)/view.zoom};}
  function project(name,question=''){return {id:uid('project'),name,question,hypotheses:[],plans:[],assets:[],resources:[],materialLinks:[]};}
  function hypothesis(name){return {id:uid('hypothesis'),name,nodes:[],edges:[],papers:[],revision:0};}
  function plan(name){return {id:uid('plan'),name,hypothesisIds:[],figures:[],history:[],references:[]};}
  function figure(title=T('未命名 Figure')){return {id:uid('figure'),title,question:'',transition:'',panels:[],references:[],evidenceBlocks:[]};}
  function panel(title=T('新 Panel'),point={x:0,y:0},kind='panel'){return {id:uid('panel'),title,kind,x:finite(point.x),y:finite(point.y),w:kind==='text'?260:250,h:kind==='arrow'?60:190,purpose:'',experiment:'',readout:'',expectedResult:'',result:'',status:'planned',references:[],ownAssetId:null,links:[]};}
  function materialLink(data={}){
    return {id:data.id||uid('material-link'),targetType:data.targetType||'node',hypothesisId:data.hypothesisId||'',targetId:data.targetId||'',materialType:data.materialType||'paper',sourceKind:data.sourceKind||'library',resourceId:data.resourceId||'',sourceSnapshot:data.sourceSnapshot?clone(data.sourceSnapshot):null,stance:['support','oppose','neutral'].includes(data.stance)?data.stance:'neutral',note:String(data.note??'').slice(0,4000),createdAt:data.createdAt||new Date().toISOString(),updatedAt:data.updatedAt||new Date().toISOString()};
  }
  function evidenceBlock(data={}){
    return {id:data.id||uid('evidence-block'),title:data.title||T('新证据块'),panelIds:Array.isArray(data.panelIds)?[...new Set(data.panelIds)]:[],status:['draft','complete'].includes(data.status)?data.status:'draft',summary:String(data.summary??'').slice(0,4000),createdAt:data.createdAt||new Date().toISOString(),updatedAt:data.updatedAt||new Date().toISOString()};
  }
  function selection(project,requested={}){const next={projectId:project?.id||null,mode:requested.mode||'overview',hypothesisId:null,planId:null,figureId:null};if(!project)return next;next.hypothesisId=project.hypotheses.find(h=>h.id===requested.hypothesisId)?.id||null;const p=project.plans.find(p=>p.id===requested.planId);next.planId=p?.id||null;next.figureId=p?.figures.find(f=>f.id===requested.figureId)?.id||null;return next;}
  const ARRANGE_OPERATIONS=Object.freeze(['left','center-x','right','top','center-y','bottom','horizontal','vertical','horizontal-centers','vertical-centers']);
  function arrange(objects,operation){
    if(!ARRANGE_OPERATIONS.includes(operation))throw Object.assign(Error('对齐方式无效'),{code:'WORKBENCH_INVALID_ARRANGEMENT',details:{field:'arrangement',allowedValues:[...ARRANGE_OPERATIONS]}});
    if(objects.length<2)return objects;
    const b=bounds(objects),movable=objects.filter(o=>!o.locked);
    for(const o of movable){const r=rect(o);switch(operation){
      case 'left':o.x=b.x;break;case 'center-x':o.x=b.x+(b.w-r.w)/2;break;case 'right':o.x=b.x+b.w-r.w;break;
      case 'top':o.y=b.y;break;case 'center-y':o.y=b.y+(b.h-r.h)/2;break;case 'bottom':o.y=b.y+b.h-r.h;break;
    }}
    if(objects.length<3||!['horizontal','vertical','horizontal-centers','vertical-centers'].includes(operation))return objects;
    const axis=operation.startsWith('horizontal')?'x':'y',size=axis==='x'?'w':'h',centers=operation.endsWith('-centers');
    const position=o=>rect(o)[axis]+(centers?rect(o)[size]/2:0);
    const sorted=[...objects].sort((a,c)=>position(a)-position(c)||String(a.id).localeCompare(String(c.id)));
    if(!centers&&!sorted.at(-1).locked)sorted.at(-1)[axis]=b[axis]+b[size]-rect(sorted.at(-1))[size];
    // The outer objects and every locked object are fixed anchors. A lock in
    // the middle makes separate intervals; forcing one global gap would have
    // to move the lock or silently overlap it. Each interval has equal gaps.
    const anchors=sorted.map((o,i)=>i===0||i===sorted.length-1||o.locked?i:null).filter(i=>i!==null);
    for(let segment=1;segment<anchors.length;segment++){
      const start=anchors[segment-1],end=anchors[segment];if(end-start<2)continue;
      const first=sorted[start],last=sorted[end];
      if(centers){const left=position(first),step=(position(last)-left)/(end-start);for(let i=start+1;i<end;i++)sorted[i][axis]=left+(i-start)*step-rect(sorted[i])[size]/2;}
      else {const left=rect(first)[axis],right=rect(last)[axis]+rect(last)[size],total=sorted.slice(start,end+1).reduce((sum,o)=>sum+rect(o)[size],0),gap=(right-left-total)/(end-start);let cursor=left+rect(first)[size]+gap;for(let i=start+1;i<end;i++){sorted[i][axis]=cursor;cursor+=rect(sorted[i])[size]+gap;}}
    }
    return objects;
  }
  function layout(objects){const result=clone(objects),movable=result.filter(o=>!o.manual&&!o.locked),locked=result.filter(o=>o.manual||o.locked),b=bounds(objects),columns=Math.max(1,Math.ceil(Math.sqrt(movable.length))),width=Math.max(250,...objects.map(o=>rect(o).w)),height=Math.max(190,...objects.map(o=>rect(o).h)),top=locked.length?Math.max(...locked.map(o=>rect(o).y+rect(o).h))+24:b.y;movable.forEach((o,i)=>{o.x=b.x+i%columns*(width+24);o.y=top+Math.floor(i/columns)*(height+24);});return result;}
  function duplicatePanels(panels,offset={x:24,y:24}){
    const groups=new Map(),ids=new Map(panels.map(p=>[p.id,uid('panel')]));
    return clone(panels).map(p=>{p.id=ids.get(p.id);p.x=finite(p.x)+finite(offset.x);p.y=finite(p.y)+finite(offset.y);const group=p.groupId||p.group;if(group){if(!groups.has(group))groups.set(group,uid('group'));if(p.groupId)p.groupId=groups.get(group);if(p.group)p.group=groups.get(group);}
      for(const link of Array.isArray(p.links)?p.links:[])if(link&&typeof link==='object')for(const field of ['panelId','sourcePanelId','targetPanelId'])if(ids.has(link[field]))link[field]=ids.get(link[field]);
      return p;
    });
  }
  function duplicateGraph(nodes,edges,offset={x:24,y:24}){
    const ids=new Map(nodes.map(n=>[n.id,uid('node')])),shift=p=>({...p,x:finite(p.x)+offset.x,y:finite(p.y)+offset.y});
    const copiedNodes=clone(nodes).map(n=>({...shift(n),id:ids.get(n.id)}));
    const copiedEdges=clone(edges).filter(e=>ids.has(e.source)&&ids.has(e.target)).map(e=>{
      e.id=uid('edge');e.source=ids.get(e.source);e.target=ids.get(e.target);
      if(e.waypoints)e.waypoints=e.waypoints.map(shift);
      if(e.labelPosition)e.labelPosition=shift(e.labelPosition);
      // route is a derived cache. The router rebuilds it from the translated
      // manual waypoints and persisted explicit/automatic ports.
      delete e.route;return e;
    });
    return {nodes:copiedNodes,edges:copiedEdges};
  }
  function branch(source){const p=clone(source);p.id=uid('plan');p.name+=' '+T('· 分支');p.history=[];p.figures=p.figures.map(f=>({...f,id:uid('figure'),panels:duplicatePanels(f.panels,{x:0,y:0})}));delete p.view;return p;}
  function designPanels(project,planId,hypothesisId,edgeIds,targetFigureId){const h=project.hypotheses.find(h=>h.id===hypothesisId),p=project.plans.find(p=>p.id===planId);if(!h||!p)throw Error('请选择目标假说与方案');let f=p.figures.find(f=>f.id===targetFigureId);if(!f){f=figure(T('检验')+' '+h.name);p.figures.push(f);}if(!p.hypothesisIds.includes(h.id))p.hypothesisIds.push(h.id);const edges=h.edges.filter(e=>edgeIds.includes(e.id)),b=bounds(f.panels);edges.forEach((e,i)=>{const from=h.nodes.find(n=>n.id===e.source),to=h.nodes.find(n=>n.id===e.target);const q=[from?.label,e.claim||T('是否影响'),to?.label].filter(Boolean).join(' ');const object=panel(q,{x:f.panels.length?b.x+b.w+40+i*280:i*280,y:f.panels.length?b.y:0});object.purpose=q;object.experiment=e.condition||'';object.gap=T('待确定实验条件、对照及关键读出');object.links=[{hypothesisId:h.id,edgeId:e.id,revision:h.revision||0,question:q,evidence:clone(e.bindings||[]),role:'test',needsReview:false}];object.references=(e.bindings||[]).map(b=>({resourceId:b.resourceId,note:b.judgement||'',borrow:T('实验设计'),needsReview:true}));f.panels.push(object);});return f;}
  function sourceLabel(row){const d=row.data||{};return row.title??d.title??d.label??d.name??d.question??d.summary??row.panelId??row.blockId??row.figureId??row.source?.resourceId??'未命名来源';}
  function normalizeResource(row,paperTitle=''){const r=clone(row);r.title=String(sourceLabel(r));r.subtitle=paperTitle||r.subtitle||'';r.detail=String(r.detail??r.data?.description??r.data?.summary??r.data?.text??'');if(r.type==='paragraph')r.type='fragment';r.availability ||= r.sourceMismatch?'review':'local';return r;}
  function versionedResources(rows,paperTitle=''){const keys=new Map(rows.map(r=>[r.id,r.source?r.id+':v'+r.source.revision+':'+r.source.contentHash+':'+(r.source.bindings||[]).map(b=>b.revision+'-'+b.contentHash).join('_'):r.id]));return rows.map(row=>{const r=normalizeResource(row,paperTitle);r.id=keys.get(row.id);if(r.parentResourceId)r.parentResourceId=keys.get(r.parentResourceId)||r.parentResourceId;return r;});}
  function locator(resource,resources){if(!resource?.source)return null;const parent=resource.parentResourceId?resources.find(r=>r.id===resource.parentResourceId):null;const figure=resource.type==='figure'?resource:parent?.type==='figure'?parent:resources.find(r=>r.type==='figure'&&r.figureId===resource.figureId&&r.source?.workspaceId===resource.source.workspaceId&&r.source?.workspaceGeneration===resource.source.workspaceGeneration&&r.source?.contentHash===resource.source.contentHash);if(resource.figureId&&figure?.source)return {source:clone(figure.source),target:{kind:'figure',figureId:figure.figureId}};if(resource.type==='fragment'&&resource.source.resourceId!=='mechanism-canvas')return {source:clone(resource.source),target:{kind:'paragraph',paragraphId:resource.data?.paragraphId||resource.data?.id||resource.source.resourceId}};return null;}
  return {clone,uid,finite,PANEL_STATUS_OPTIONS,panelStatus,updatePanelStatus,TABLE_LIMITS,createGroupTable,validateGroupTable,editGroupTable,ARRANGE_OPERATIONS,rect,portForPoint,bounds,fit,zoomAt,world,project,hypothesis,plan,figure,panel,materialLink,evidenceBlock,selection,arrange,layout,duplicatePanels,duplicateGraph,branch,designPanels,normalizeResource,versionedResources,locator};
});
