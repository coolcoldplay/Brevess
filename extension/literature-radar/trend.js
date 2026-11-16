(function(root){
  'use strict';
  const NS='http://www.w3.org/2000/svg',R=root.BrevessRadar,T=value=>root.SciLLM?.translateInterfaceText?.(value)||value;
  R.renderRadarTrend=function(container,revision,mode='cumulative'){
    const doc=container.ownerDocument,data=R.radarTrend(revision),key=mode==='new'?'newCount':'cumulative',label=T(mode==='new'?'新增文献':'累计文献');
    const text=(tag,value,className)=>{const node=doc.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
    container.replaceChildren();container.dataset.mode=mode;container.dataset.total=data.total;container.dataset.newTotal=data.newTotal;
    const compact=data.total===0||data.points.length<=1;container.closest('.radar-trend')?.classList.toggle('trend-compact',compact);
    if(compact){container.append(text('p',T(data.undated?'旧记录缺少首次发现时间，暂无法绘制趋势。':data.total===0?'尚无文献，暂不绘制趋势。':'单个日期暂不绘制趋势。'),'hint'));return;}
    const summary=text('p',`${label} · ${mode==='new'?data.newTotal:data.total} ${T('篇')}`,'trend-summary');container.append(summary);
    if(!data.points.length){container.append(text('p',T(data.undated?'旧记录缺少首次发现时间，暂无法绘制趋势。':'首次检查成功后显示文献趋势。'),'hint'));return;}
    const svg=doc.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 760 260');svg.setAttribute('role','img');svg.setAttribute('tabindex','0');svg.setAttribute('aria-label',T('文献发现趋势；左右方向键查看各时间段'));
    const node=(tag,attrs,value)=>{const child=doc.createElementNS(NS,tag);for(const [name,v]of Object.entries(attrs))child.setAttribute(name,String(v));if(value!==undefined)child.textContent=value;svg.append(child);return child;};
    node('title',{},label);const high=Math.max(1,...data.points.map(p=>p[key])),step=Math.max(1,Math.ceil(high/4)),top=step*4;
    const left=55,right=740,bottom=214,y=value=>bottom-value/top*180,x=i=>data.points.length===1?(left+right)/2:left+i/(data.points.length-1)*(right-left);
    for(let i=0;i<=4;i++){const value=i*step;node('line',{x1:left,y1:y(value),x2:right,y2:y(value),class:'trend-grid'});node('text',{x:left-12,y:y(value)+4,'text-anchor':'end',class:'trend-axis'},value);}
    node('text',{x:left,y:16,class:'trend-axis'},T('文献数量（篇）'));
    for(const i of [...new Set([0,Math.floor((data.points.length-1)/2),data.points.length-1])])node('text',{x:x(i),y:237,'text-anchor':i===0&&data.points.length>1?'start':i===data.points.length-1&&data.points.length>1?'end':'middle',class:'trend-axis'},data.points[i].startDay);
    node('text',{x:right,y:257,'text-anchor':'end',class:'trend-axis'},T('首次发现日期（UTC）'));
    const points=data.points.map((p,i)=>`${x(i)},${y(p[key])}`).join(' ');
    if(data.points.length>1)node('polygon',{points:`${left},${bottom} ${points} ${right},${bottom}`,class:'trend-area'});
    node('polyline',{points,class:'trend-line'});
    const cursor=node('line',{y1:28,y2:bottom,class:'trend-cursor'}),dot=node('circle',{r:4,class:'trend-point'});
    const detail=text('output','','trend-detail');detail.setAttribute('aria-live','polite');
    let selected=data.points.length-1;
    const select=index=>{selected=Math.max(0,Math.min(data.points.length-1,index));const point=data.points[selected];cursor.setAttribute('x1',x(selected));cursor.setAttribute('x2',x(selected));dot.setAttribute('cx',x(selected));dot.setAttribute('cy',y(point[key]));detail.textContent=`${point.startDay}${point.endDay!==point.startDay?' — '+point.endDay:''} · ${label} ${point[key]} ${T('篇')}`;};
    svg.addEventListener('pointermove',event=>{const rect=svg.getBoundingClientRect();select(Math.round(((event.clientX-rect.left)*760/rect.width-left)/(right-left)*(data.points.length-1)));});
    svg.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();select(event.key==='Home'?0:event.key==='End'?data.points.length-1:selected+(event.key==='ArrowRight'?1:-1));}});
    select(selected);container.append(svg,detail,text('p',T('累计包含首次基线；新增仅计后续首次发现，重复扫描不重复计数。')+(data.bucketDays>1?` ${T('每个点汇总天数：')}${data.bucketDays}`:'')+(data.undated?` ${T('缺少发现时间，未纳入：')}${data.undated}`:''),'hint'));
  };
})(globalThis);
