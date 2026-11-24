/* Original-image pixel spans make the brush independent of viewport zoom and DPI. */
const PanelBrush=(()=>{
  const {merge,band,rowAt,intersect,selection,bounds}=PanelOutput;
  function stroke(points,r,width,height){
    const rows=new Map();
    function span(y,l,z){
      l=Math.max(0,Math.ceil(l-.5));z=Math.min(width,Math.floor(z-.5)+1);
      if(l>=z)return;
      if(!rows.has(y))rows.set(y,[]);rows.get(y).push(l,z);
    }
    function circle([x,y]){
      for(let j=Math.max(0,Math.ceil(y-r-.5));j<Math.min(height,Math.floor(y+r-.5)+1);j++){
        const d=Math.sqrt(Math.max(0,r*r-(j+.5-y)**2));span(j,x-d,x+d);
      }
    }
    circle(points[0]);
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      if(!len)continue;
      const nx=-dy*r/len,ny=dx*r/len;
      const quad=[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]];
      const ys=quad.map(p=>p[1]);
      for(let j=Math.max(0,Math.ceil(Math.min(...ys)-.5));j<Math.min(height,Math.ceil(Math.max(...ys)-.5));j++){
        const cy=j+.5,xs=[];
        for(let k=0;k<4;k++){const p=quad[k],q=quad[(k+1)%4];if((p[1]>cy)!==(q[1]>cy))xs.push(p[0]+(cy-p[1])*(q[0]-p[0])/(q[1]-p[1]));}
        if(xs.length)span(j,Math.min(...xs),Math.max(...xs));
      }
      circle(b);
    }
    const bands=[];for(const y of [...rows.keys()].sort((a,b)=>a-b))band(bands,y,merge(rows.get(y)));
    return region(bands);
  }
  function region(bands){
    if(!bands.length)return null;
    let l=Infinity,r=0;for(const [, ,runs] of bands){l=Math.min(l,runs[0]);r=Math.max(r,runs.at(-1));}
    return {bands,box:[l,bands[0][0],r,bands.at(-1)[1]]};
  }
  function erase(model,id,{points,size},pad){
    const ink=stroke(points,size/2,model.source.width,model.source.height);
    if(!ink)return null;
    const base=bounds(model,id,pad),b=[Math.max(base[0],ink.box[0]),Math.max(base[1],ink.box[1]),Math.min(base[2],ink.box[2]),Math.min(base[3],ink.box[3])];
    const crop=b[2]>b[0]&&b[3]>b[1]?selection(model,id,b).keep:[],bands=[];
    for(const [t,z,runs] of ink.bands)for(let y=t;y<z;y++){
      const kept=rowAt(crop,y-b[1]).map(v=>v+b[0]),rr=intersect(runs,kept);
      if(rr.length)band(bands,y,rr);
    }
    const part=region(bands);
    return part?{kind:'erase',...part}:null;
  }
  return {erase};
})();
