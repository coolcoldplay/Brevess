(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.BrevessRadar ||= {},api);})(globalThis,()=>{
  'use strict';
  const DAY=86400000,valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=8640000000000000;
  function radarTrend(revision={}) {
    const papers=new Map();
    for(const paper of revision.articles||[]) {
      if(!paper?.id)continue;
      const previous=papers.get(paper.id);
      if(!previous||valid(paper.firstSeenAt)&&(!valid(previous.firstSeenAt)||paper.firstSeenAt<previous.firstSeenAt))papers.set(paper.id,paper);
    }
    const dated=[...papers.values()].filter(p=>valid(p.firstSeenAt)),undated=papers.size-dated.length;
    const timestamps=dated.map(p=>p.firstSeenAt);
    if(valid(revision.baselineAt))timestamps.push(revision.baselineAt);
    if(valid(revision.lastSuccessAt))timestamps.push(revision.lastSuccessAt);
    if(!timestamps.length)return {points:[],total:0,newTotal:0,undated,bucketDays:1};
    const first=Math.floor(timestamps.reduce((a,b)=>Math.min(a,b),Infinity)/DAY),last=Math.floor(timestamps.reduce((a,b)=>Math.max(a,b),0)/DAY);
    const bucketDays=Math.max(1,Math.ceil((last-first+1)/180)),points=Array.from({length:Math.ceil((last-first+1)/bucketDays)},(_,i)=>({
      startDay:new Date((first+i*bucketDays)*DAY).toISOString().slice(0,10),endDay:new Date(Math.min(last,first+(i+1)*bucketDays-1)*DAY).toISOString().slice(0,10),newCount:0,discovered:0,cumulative:0
    }));
    for(const paper of dated){const point=points[Math.floor((Math.floor(paper.firstSeenAt/DAY)-first)/bucketDays)];point.discovered++;if(!paper.isBaseline)point.newCount++;}
    let cumulative=0;for(const point of points){cumulative+=point.discovered;point.cumulative=cumulative;}
    return {points,total:cumulative,newTotal:points.reduce((n,p)=>n+p.newCount,0),undated,bucketDays};
  }
  return {radarTrend};
});
