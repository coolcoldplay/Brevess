(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./model.js'):root.Workbench);if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.Workbench ||= {},api);})(globalThis,M=>{
  'use strict';
  const SIDES=['top','right','bottom','left'],DIR={top:{x:0,y:-1},right:{x:1,y:0},bottom:{x:0,y:1},left:{x:-1,y:0}},EPS=.001;
  function autoPorts(a,b){a=M.rect(a);b=M.rect(b);const dx=b.x+b.w/2-a.x-a.w/2,dy=b.y+b.h/2-a.y-a.h/2;return Math.abs(dx)/(a.w+b.w)>=Math.abs(dy)/(a.h+b.h)?{source:{side:dx>=0?'right':'left',offset:.5},target:{side:dx>=0?'left':'right',offset:.5}}:{source:{side:dy>=0?'bottom':'top',offset:.5},target:{side:dy>=0?'top':'bottom',offset:.5}};}
  function port(node,value,fallback){const r=M.rect(node),p=SIDES.includes(value?.side)?{side:value.side,offset:Math.max(0,Math.min(1,M.finite(value.offset,.5)))}:fallback;return {...p,x:p.side==='left'?r.x:p.side==='right'?r.x+r.w:r.x+r.w*p.offset,y:p.side==='top'?r.y:p.side==='bottom'?r.y+r.h:r.y+r.h*p.offset};}
  function hits(a,b,r){if(Math.abs(a.x-b.x)<EPS)return a.x>r.x+EPS&&a.x<r.x+r.w-EPS&&Math.max(a.y,b.y)>r.y+EPS&&Math.min(a.y,b.y)<r.y+r.h-EPS;if(Math.abs(a.y-b.y)<EPS)return a.y>r.y+EPS&&a.y<r.y+r.h-EPS&&Math.max(a.x,b.x)>r.x+EPS&&Math.min(a.x,b.x)<r.x+r.w-EPS;return true;}
  function segments(points){return points.slice(1).map((b,i)=>[points[i],b]);}
  function simplify(points){const out=[];for(const p of points){if(out.length&&Math.abs(out.at(-1).x-p.x)<EPS&&Math.abs(out.at(-1).y-p.y)<EPS)continue;while(out.length>1&&((out.at(-2).x===out.at(-1).x&&p.x===out.at(-1).x)||(out.at(-2).y===out.at(-1).y&&p.y===out.at(-1).y)))out.pop();out.push({x:p.x,y:p.y});}return out;}
  function crossing(a,b,c,d){return Math.abs(a.x-b.x)<EPS?Math.abs(c.y-d.y)<EPS&&a.x>Math.min(c.x,d.x)&&a.x<Math.max(c.x,d.x)&&c.y>Math.min(a.y,b.y)&&c.y<Math.max(a.y,b.y):Math.abs(c.x-d.x)<EPS&&c.x>Math.min(a.x,b.x)&&c.x<Math.max(a.x,b.x)&&a.y>Math.min(c.y,d.y)&&a.y<Math.max(c.y,d.y);}
  function orthogonal(points){return segments(points).every(([a,b])=>Math.abs(a.x-b.x)<EPS||Math.abs(a.y-b.y)<EPS);}
  function turnCount(points){let turns=0;for(let i=1;i<points.length-1;i++){const a=points[i-1],b=points[i],c=points[i+1];if((a.x===b.x&&b.y===c.y)||(a.y===b.y&&b.x===c.x))turns++;}return turns;}
  function rounded(points,radius=6){if(!points.length)return '';let path=`M ${points[0].x} ${points[0].y}`;for(let i=1;i<points.length-1;i++){const a=points[i-1],b=points[i],c=points[i+1],ab=Math.hypot(b.x-a.x,b.y-a.y),bc=Math.hypot(c.x-b.x,c.y-b.y),r=Math.min(radius,ab/2,bc/2);const p={x:b.x+(a.x-b.x)*r/ab,y:b.y+(a.y-b.y)*r/ab},q={x:b.x+(c.x-b.x)*r/bc,y:b.y+(c.y-b.y)*r/bc};path+=` L ${p.x} ${p.y} Q ${b.x} ${b.y} ${q.x} ${q.y}`;}if(points.length>1)path+=` L ${points.at(-1).x} ${points.at(-1).y}`;return path;}
  function labelInfo(edge){const kind=['branch','feedback'].includes(edge.kind)?edge.kind:'main',prefix=kind==='branch'?'分支':kind==='feedback'?'↺ 反馈':'主线',chars=Array.from(String(edge.claim||'待检验联系')),claim=chars.length>11?chars.slice(0,11).join('')+'…':chars.join(''),text=prefix+' · '+claim,types=new Set((edge.bindings||[]).flatMap(b=>b.types||[]));const width=Array.from(text).reduce((sum,c)=>sum+(/[\u0000-\u007f]/.test(c)?(/[MW@#%&]/.test(c)?10:/[ilI1.,' ]/.test(c)?4:/[A-Z]/.test(c)?8:7):11),0);return {text,kind,w:Math.max(92,width+16+(types.has('sufficient')||types.has('necessary')?20:0)),h:24};}
  const inflate=(r,gap)=>({x:r.x-gap,y:r.y-gap,w:r.w+gap*2,h:r.h+gap*2});
  const overlaps=(a,b)=>a.x<b.x+b.w-EPS&&a.x+a.w>b.x+EPS&&a.y<b.y+b.h-EPS&&a.y+a.h>b.y+EPS;
  const boxAt=(info,p)=>({x:p.x-info.w/2,y:p.y-info.h/2,w:info.w,h:info.h});
  function parallelOverlap(a,b,c,d){const horizontal=Math.abs(a.y-b.y)<EPS&&Math.abs(c.y-d.y)<EPS,vertical=Math.abs(a.x-b.x)<EPS&&Math.abs(c.x-d.x)<EPS;if(!horizontal&&!vertical)return 0;const gap=horizontal?Math.abs(a.y-c.y):Math.abs(a.x-c.x);if(gap>=28)return 0;const axis=horizontal?'x':'y',length=Math.max(0,Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis])));return length*(1-gap/28);}
  function placeLabels(nodes,edges,routes){
    const obstacles=nodes.map(n=>inflate(M.rect(n),8)),reserved=[],lines=[];
    // routeAll repeats placement after all paths are known; discard provisional
    // label metadata so a previous pass cannot hide or detach the final label.
    for(const r of Object.values(routes)){delete r.labelHidden;delete r.labelDetached;delete r.labelAnchor;delete r.labelBox;delete r.labelInfo;delete r.label;}
    for(const e of edges){const r=routes[e.id];if(!r||r.blocked)continue;segments(r.points).forEach(([a,b],index)=>lines.push({a,b,index,id:e.id}));}
    // Manual positions are immutable and reserve their complete rendered box,
    // even when that edge sorts after an automatically labelled edge.
    for(const e of edges){const r=routes[e.id];if(!r||r.blocked||!e.labelPosition)continue;r.label={...e.labelPosition};r.labelInfo=labelInfo(e);r.labelBox=boxAt(r.labelInfo,r.label);reserved.push(inflate(r.labelBox,6));}
    for(const e of edges){const r=routes[e.id];if(!r||r.blocked||e.labelPosition)continue;const info=labelInfo(e),parts=segments(r.points).map(([a,b],index)=>({a,b,index,length:Math.hypot(b.x-a.x,b.y-a.y)})).sort((a,b)=>b.length-a.length||a.index-b.index);let chosen;
      const valid=c=>{const box=boxAt(info,c),space=inflate(box,4);if(obstacles.some(n=>overlaps(box,n))||reserved.some(n=>overlaps(box,n)))return false;return !lines.some(line=>!(c.inline&&line.id===e.id&&line.index===c.segment)&&hits(line.a,line.b,space));};
      for(let tier=0;tier<10&&!chosen;tier++){
        const candidates=[];
        for(const part of parts){if(part.length<20)continue;const horizontal=Math.abs(part.a.y-part.b.y)<EPS,normal=(horizontal?info.h/2:info.w/2)+8+tier*24;
          for(const fraction of [.5,.25,.75,.125,.875]){const anchor={x:part.a.x+(part.b.x-part.a.x)*fraction,y:part.a.y+(part.b.y-part.a.y)*fraction};const offsets=tier===0?[0,-normal,normal]:[-normal,normal];
            for(const offset of offsets){const p={x:anchor.x+(horizontal?0:offset),y:anchor.y+(horizontal?offset:0),anchor,segment:part.index,inline:offset===0};p.score=Math.abs(offset)+Math.abs(fraction-.5)*24+parts.indexOf(part)*6;candidates.push(p);}
          }
        }
        candidates.sort((a,b)=>a.score-b.score||a.segment-b.segment||a.x-b.x||a.y-b.y);chosen=candidates.find(valid);
      }
      // Congested drawings still use a deterministic free slot around their
      // routes; never fall back to an already occupied segment midpoint.
      if(!chosen){const area=M.bounds(nodes),anchor=r.points[Math.floor(r.points.length/2)]||{x:0,y:0};for(let ring=1;ring<=edges.length+2&&!chosen;ring++)for(const p of [{x:area.x-info.w/2-16*ring,y:anchor.y},{x:area.x+area.w+info.w/2+16*ring,y:anchor.y},{x:anchor.x,y:area.y-info.h/2-28*ring},{x:anchor.x,y:area.y+area.h+info.h/2+28*ring}]){const candidate={...p,anchor,inline:false,segment:-1};if(valid(candidate)){chosen=candidate;break;}}}
      if(!chosen){r.labelHidden=true;r.labelInfo=info;continue;}
      r.label={x:chosen.x,y:chosen.y};r.labelInfo=info;r.labelBox=boxAt(info,r.label);r.labelAnchor=chosen.anchor;r.labelDetached=!chosen.inline;reserved.push(inflate(r.labelBox,6));
    }
  }
  function graphPath(start,end,obstacles){
    const xs=[...new Set([start.x,end.x,...obstacles.flatMap(r=>[r.x,r.x+r.w])])].sort((a,b)=>a-b),ys=[...new Set([start.y,end.y,...obstacles.flatMap(r=>[r.y,r.y+r.h])])].sort((a,b)=>a-b),nx=xs.length,ny=ys.length;
    const sx=xs.indexOf(start.x),sy=ys.indexOf(start.y),tx=xs.indexOf(end.x),ty=ys.indexOf(end.y);const heap=[],dist=new Map(),previous=new Map(),closed=new Set(),cache=new Map();
    function push(v){heap.push(v);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].f<=v.f)break;heap[i]=heap[p];i=p;}heap[i]=v;}
    function pop(){const root=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].f<heap[c].f)c++;if(heap[c].f>=last.f)break;heap[i]=heap[c];i=c;}heap[i]=last;}return root;}
    const key=(x,y,d)=>(y*nx+x)*3+d;const initial=key(sx,sy,0);dist.set(initial,0);push({x:sx,y:sy,d:0,k:initial,f:0});let steps=0;
    while(heap.length&&steps++<60000){const u=pop();if(closed.has(u.k))continue;closed.add(u.k);if(u.x===tx&&u.y===ty){const out=[];let k=u.k;while(k!==undefined){const cell=Math.floor(k/3);out.push({x:xs[cell%nx],y:ys[Math.floor(cell/nx)]});k=previous.get(k);}return simplify(out.reverse());}
      for(const [dx,dy,d]of [[-1,0,1],[1,0,1],[0,-1,2],[0,1,2]]){const x=u.x+dx,y=u.y+dy;if(x<0||y<0||x>=nx||y>=ny)continue;const a={x:xs[u.x],y:ys[u.y]},b={x:xs[x],y:ys[y]},edge=[u.y*nx+u.x,y*nx+x].sort((a,b)=>a-b).join(':');if(!cache.has(edge))cache.set(edge,!obstacles.some(r=>hits(a,b,r)));if(!cache.get(edge))continue;const k=key(x,y,d),g=dist.get(u.k)+Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+(u.d&&u.d!==d?20:0);if(g>=(dist.get(k)??Infinity))continue;dist.set(k,g);previous.set(k,u.k);push({x,y,d,k,f:g+Math.abs(b.x-end.x)+Math.abs(b.y-end.y)});}
    }return null;
  }
  function route(edge,nodes,previous=[],lane=0){const from=nodes.find(n=>n.id===edge.source),to=nodes.find(n=>n.id===edge.target);if(!from||!to||from===to)return {blocked:true,reason:'请调整自环或补全节点',points:[],path:''};const auto=autoPorts(from,to),a=port(from,edge.sourcePort,auto.source),b=port(to,edge.targetPort,auto.target),da=DIR[a.side],db=DIR[b.side],distance=22+lane*10,s={x:a.x+da.x*distance,y:a.y+da.y*distance},t={x:b.x+db.x*distance,y:b.y+db.y*distance};
    const actual=nodes.map(n=>({...M.rect(n),id:n.id})),obstacles=actual.map(r=>({...r,x:r.x-8,y:r.y-8,w:r.w+16,h:r.h+16}));
    if(actual.some(r=>r.id!==from.id&&hits(a,s,r)||r.id!==to.id&&hits(t,b,r)))return {blocked:true,reason:'连接端口被节点遮挡，请换端口',points:[],path:'',a,b};
    const valid=points=>orthogonal(points)&&!segments(points).some(([p,q])=>obstacles.some(r=>hits(p,q,r)));
    const track=lane?Math.ceil(lane/2)*(lane%2?28:-28):0;
    const all=M.bounds(nodes),midX=(s.x+t.x)/2+track,midY=(s.y+t.y)/2+track,pad=28+lane*10;
    const candidates=[
      [s,{x:t.x,y:s.y},t],
      [s,{x:s.x,y:t.y},t],
      [s,{x:midX,y:s.y},{x:midX,y:t.y},t],
      [s,{x:s.x,y:midY},{x:t.x,y:midY},t],
      [s,{x:all.x-pad,y:s.y},{x:all.x-pad,y:t.y},t],
      [s,{x:all.x+all.w+pad,y:s.y},{x:all.x+all.w+pad,y:t.y},t],
      [s,{x:s.x,y:all.y-pad},{x:t.x,y:all.y-pad},t],
      [s,{x:s.x,y:all.y+all.h+pad},{x:t.x,y:all.y+all.h+pad},t]
    ];
    if(edge.waypoints?.length){const manual=[s,...edge.waypoints,t];if(!valid(manual))return {blocked:true,reason:'手动路线穿过节点或不是正交线，请调整',points:[],path:'',a,b};candidates.splice(0,candidates.length,manual);}
    let available=candidates.map(simplify).filter(valid);if(!available.length){const path=graphPath(s,t,obstacles);if(path&&orthogonal(path))available=[path];}
    if(!available.length)return {blocked:true,reason:'路线拥挤，请移动节点或调整端口',points:[],path:'',a,b};
    const priorSegments=previous.flatMap(r=>segments(r.points));
    const bounds={x:all.x-pad,y:all.y-pad,w:all.w+pad*2,h:all.h+pad*2};
    function score(points){
      let length=0,cross=0,bends=0,reversals=0,outside=0;
      for(const [p,q] of segments(points)){
        length+=Math.abs(p.x-q.x)+Math.abs(p.y-q.y);
        for(const [r,s] of priorSegments){cross+=Number(crossing(p,q,r,s))*90;cross+=parallelOverlap(p,q,r,s)*2.4;}
        for(const point of [p,q])if(point.x<bounds.x||point.x>bounds.x+bounds.w||point.y<bounds.y||point.y>bounds.y+bounds.h)outside+=40;
      }
      for(let i=1;i<points.length-1;i++){
        const p=points[i-1],q=points[i],r=points[i+1],ax=Math.sign(q.x-p.x),ay=Math.sign(q.y-p.y),bx=Math.sign(r.x-q.x),by=Math.sign(r.y-q.y);
        if((ax||ay)&&(bx||by)&&(ax!==bx||ay!==by))bends++;
        if((ax&&bx&&ax!==bx)||(ay&&by&&ay!==by))reversals++;
      }
      return length+bends*26+reversals*80+cross+outside+points.length*18;
    }
    available.sort((p,q)=>score(p)-score(q)||turnCount(p)-turnCount(q)||JSON.stringify(p).localeCompare(JSON.stringify(q)));
    const points=simplify([a,...available[0],b]),result={points,path:rounded(points),a,b,blocked:false};
    placeLabels(nodes,[edge],{[edge.id]:result});
    return result;
  }
  function routeAll(nodes,edges){const map={},previous=[],lanes=new Map(),groups=new Map(),effective=new Map();const sorted=[...edges].sort((a,b)=>a.id.localeCompare(b.id));for(const e of sorted){const a=nodes.find(n=>n.id===e.source),b=nodes.find(n=>n.id===e.target);if(!a||!b)continue;const defaults=autoPorts(a,b),copy={...e};effective.set(e.id,copy);for(const end of ['source','target'])if(!SIDES.includes(e[end+'Port']?.side)){const key=e[end]+'/'+defaults[end].side;const group=groups.get(key)||[];group.push({edge:copy,end,side:defaults[end].side});groups.set(key,group);}}for(const group of groups.values())group.forEach((item,index)=>item.edge[item.end+'Port']={side:item.side,offset:group.length===1?.5:(index+1)/(group.length+1)});for(const e of sorted){const key=[e.source,e.target].sort().join('/'),lane=lanes.get(key)||0;lanes.set(key,lane+1);const r=route(effective.get(e.id)||e,nodes,previous,lane);map[e.id]=r;if(!r.blocked)previous.push(r);}placeLabels(nodes,sorted,map);return map;}
  return {SIDES,autoPorts,port,portForPoint:M.portForPoint,segmentHits:hits,segments,orthogonal,turnCount,rounded,labelInfo,route,routeAll};
});
