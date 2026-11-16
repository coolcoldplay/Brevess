/* Official source geometry; selected paper-figure composes original corner and column nodes. */
(function(root){
 'use strict';
 const R=root.SemanticResources, media=root.matchMedia('(prefers-reduced-motion: reduce)');
 const keys=['navigation','highlights','figures','chat','notes'];
 const names=['导航','高亮','解图','问答','笔记'];
 const sets={
  1:{family:'tabler',assets:['list-details','highlight','photo-scan','message-2','notebook']},
  2:{family:'lucide',assets:['list-tree','highlighter','chart-no-axes-combined','message-square-more','notebook-text']},
  3:{family:'phosphor',assets:['regular/list-dashes','regular/highlighter','regular/image-square','regular/chat-dots','regular/notebook']},
  4:{family:'phosphor',assets:['duotone/list-dashes','duotone/highlighter','duotone/images-square','duotone/chat-dots','duotone/notebook']}
 };
 const esc=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
 const attrs=a=>Object.entries(a).map(([k,v])=>k+'="'+esc(v)+'"').join(' ');
 function node(f,a,i,cls='',style=''){const [tag,v]=R[f][a].nodes[i];return '<'+tag+' '+attrs(v)+' data-source="'+f+'/'+a+':'+i+'" pathLength="1" class="'+cls+'"'+(style?' style="'+style+'"':'')+'/>';}
 function motion(f,a,indices,type){return indices.map((i,k)=>node(f,a,i,'sr-move '+type,'--order:'+k)).join('');}
 function clipped(f,a,i,clip,type,order=0){return '<g class="sr-region" style="clip-path:'+clip+'">'+node(f,a,i,'sr-move '+type,'--order:'+order)+'</g>';}
 function paperFigure(){
  const f='lucide',frame='expand',bars='chart-no-axes-column';
  const corners=[6,3,2,4].map(i=>node(f,frame,i,'sr-native sr-chart-corner')).join('');
  const columns=[0,1,2].map(i=>node(f,bars,i,'sr-native sr-detail-native sr-chart-column')).join('');
  const group=content=>'<g class="sr-bar-group" transform="translate(6 6) scale(.5)">'+content+'</g>';
  return '<svg class="sr-icon sr-figure-chart" viewBox="0 0 24 24" '+attrs(R[f][frame].attrs)+' aria-hidden="true" focusable="false"><g class="sr-base">'+corners+group(columns)+'</g><g class="sr-motion">'+group(motion(f,bars,[0,1,2],'sr-read'))+'</g></svg>';
 }
 function svg(key,set){
  if(key==='figures'&&set===2)return paperFigure();
  const config=sets[set];let f=config.family,a=config.assets[keys.indexOf(key)];
  if(key==='highlights'){f='mdi';a='marker';}
  if(key==='figures'){f='tabler';a='photo-scan';}
  const asset=R[f][a],last=asset.nodes.length-1;
  const detailIndices=set===1?{navigation:[1,2,3,4],chat:[1,2],notes:[2,3]}:{navigation:[0,1,2],chat:[1,2,3],notes:[5,6,7]};
  let base=asset.nodes.map((_,i)=>node(f,a,i,'sr-native'+(f!=='phosphor'&&(key==='figures'?[1,2,3]:detailIndices[key]||[]).includes(i)?' sr-detail-native':''))).join(''),overlay='';
  if(key==='highlights'&&set!==2){
   const nib='inset(70% 64% 6% 0)';
   base='<g style="clip-path:polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,0% 70%,0% 94%,36% 94%,36% 70%,0% 70%)">'+base+'</g>'+clipped(f,a,last,nib,'sr-detail-under');
   overlay=clipped(f,a,last,nib,'sr-nib-read');
  }else if(key==='highlights'){
   // The selected scheme uses the entire original pen, without nib masks or copies.
  }else if(key==='figures'){
   base=asset.nodes.map((_,i)=>node(f,a,i,'sr-native'+([1,2,3].includes(i)?' sr-detail-native':'')+(i>=4?' sr-focus-native':''),'--order:'+Math.max(0,[4,6,7,5].indexOf(i)))).join('');
   overlay=motion(f,a,[2,3],'sr-trace');
  }else if(set===1){
   if(key==='navigation')overlay=motion(f,a,[1,2,3,4],'sr-read');
   if(key==='chat')overlay=motion(f,a,[1,2],'sr-write');
   if(key==='notes')overlay=motion(f,a,[2,3],'sr-write');
  }else if(set===2){
   if(key==='navigation')overlay=motion(f,a,[0,1,2],'sr-read');
   if(key==='chat')overlay=motion(f,a,[3,1,2],'sr-think');
   if(key==='notes')overlay=motion(f,a,[5,6,7],'sr-write');
  }else{
   const regions={navigation:['inset(18% 0 69% 0)','inset(42% 0 44% 0)','inset(67% 0 18% 0)'],chat:['inset(43% 59% 42% 28%)','inset(43% 42% 42% 45%)','inset(43% 25% 42% 62%)'],notes:['inset(38% 26% 51% 38%)','inset(51% 26% 38% 38%)']};
   const holes={navigation:'0% 18%,0% 82%,100% 82%,100% 18%,0% 18%',chat:'27% 42%,27% 58%,76% 58%,76% 42%,27% 42%',notes:'38% 38%,38% 62%,74% 62%,74% 38%,38% 38%'};
   base=asset.nodes.slice(0,-1).map((_,i)=>node(f,a,i,'sr-native')).join('')+'<g style="clip-path:polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,'+holes[key]+')">'+node(f,a,last,'sr-native')+'</g>'+regions[key].map(c=>clipped(f,a,last,c,'sr-detail-under')).join('');
   if(key==='navigation')overlay=[['inset(18% 0 69% 0)'],['inset(42% 0 44% 0)'],['inset(67% 0 18% 0)']].map((c,i)=>clipped(f,a,last,c[0],'sr-read',i)).join('');
   if(key==='chat')overlay=[28,45,62].map((left,i)=>clipped(f,a,last,'inset(43% '+(100-left-13)+'% 42% '+left+'%)','sr-think',i)).join('');
   if(key==='notes')overlay=[38,51].map((top,i)=>clipped(f,a,last,'inset('+top+'% 26% '+(100-top-11)+'% 38%)','sr-fill-write',i)).join('');
  }
  return '<svg class="sr-icon" viewBox="'+asset.viewBox+'" '+attrs(asset.attrs)+' aria-hidden="true" focusable="false"><g class="sr-base">'+base+'</g><g class="sr-motion">'+overlay+'</g></svg>';
 }
 function status(b,state){if(!['idle','running','complete','cancelled','error'].includes(state))throw Error('Unknown state');b.classList.remove('sr-enter');b.dataset.state=state;b.setAttribute('aria-busy',String(state==='running'));const key=b.dataset.module,description={idle:'空闲',running:'AI 运行中',complete:'已完成',cancelled:'已停止',error:'运行失败'}[state];b.setAttribute('aria-label',names[keys.indexOf(key)]+'，'+description);b.title=names[keys.indexOf(key)]+' · '+description+' · 单击切换 / 双击启动或停止';}
 function select(b,on,animate=true){const change=b.dataset.selected!==String(on);b.dataset.selected=String(on);b.setAttribute('aria-pressed',String(on));if(!on)b.classList.remove('sr-enter');if(change&&on&&animate)replay(b);}
 function replay(b){b.classList.remove('sr-enter');void b.offsetWidth;b.classList.add('sr-enter');}
 function decorate(b,key,set){if(!keys.includes(key)||!sets[set])throw Error('Invalid icon');b.classList.add('sr-button');b.dataset.module=key;b.dataset.set=set;b.innerHTML='<span class="sr-slot">'+svg(key,set)+'<span class="sr-busy" aria-hidden="true"></span></span><span class="sr-label">'+names[keys.indexOf(key)]+'</span>';b.addEventListener('animationend',e=>{if(e.animationName==='sr-enter-layer')b.classList.remove('sr-enter');});select(b,false,false);status(b,'idle');return b;}
 function reduced(value){document.documentElement.dataset.reduced=String(value||media.matches);}
 media.addEventListener('change',()=>reduced(document.querySelector('#reduce')?.checked));reduced(false);
 root.SemanticIcons=Object.freeze({keys,names,sets,svg,decorate,status,select,replay,reduced});
})(window);
