/* Local panel detection. All coordinates in this module refer to the analysis raster.
   The source bitmap is retained separately for lossless, full-resolution export. */
const PanelEngine = (() => {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  const median = values => [...values].sort((a,b) => a-b)[values.length >> 1];
  const makeCanvas = (w,h) => typeof document === 'undefined'
    ? new OffscreenCanvas(w,h) : Object.assign(document.createElement('canvas'), {width:w, height:h});

  function readRaster(source,photoChecks=false,neutralChecks=false,plateChecks=false) {
    const scale = Math.min(1, 1750 / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * scale));
    const h = Math.max(1, Math.round(source.height * scale));
    const canvas = makeCanvas(w,h);
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    ctx.fillStyle = 'white';
    ctx.fillRect(0,0,w,h);
    ctx.drawImage(source,0,0,w,h);
    const rgba = ctx.getImageData(0,0,w,h).data;
    const samples = [[],[],[]];
    function sample(x,y) {
      const pos = (y*w+x)*4;
      for (let c=0;c<3;c++) samples[c].push(rgba[pos+c]);
    }
    for (let x=0;x<w;x+=Math.max(1,w>>7)) { sample(x,0); sample(x,h-1); }
    for (let y=0;y<h;y+=Math.max(1,h>>7)) { sample(0,y); sample(w-1,y); }
    const paper = samples.map(median);
    const ink = new Uint8Array(w*h), glyph = new Uint8Array(w*h), light = new Uint8Array(w*h);
    const deep=new Uint8Array(w*h),bright=new Uint8Array(w*h);
    const tileInk=plateChecks?new Uint8Array(w*h):null;
    const tileTone=plateChecks?new Uint8Array(w*h):null;
    const neutral=neutralChecks?new Uint8Array(w*h):null;
    let coverage=0;
    const visible = new Uint8Array(w*h), nonPaper = new Uint8Array(w*h),tone=photoChecks?new Uint8Array(w*h):null;
    for (let i=0;i<ink.length;i++) {
      const p=i*4, r=rgba[p]-paper[0], g=rgba[p+1]-paper[1], b=rgba[p+2]-paper[2];
      const delta=Math.max(Math.abs(r),Math.abs(g),Math.abs(b));
      nonPaper[i] = delta > 0;
      visible[i] = delta > 4;
      ink[i] = delta > 23;
      coverage+=ink[i];
      const lum=.299*rgba[p]+.587*rgba[p+1]+.114*rgba[p+2];
      const chroma=Math.max(rgba[p],rgba[p+1],rgba[p+2])-Math.min(rgba[p],rgba[p+1],rgba[p+2]);
      if(tileInk){tileInk[i]=Math.min(rgba[p],rgba[p+1],rgba[p+2])<174;tileTone[i]=Math.round(lum);}
      if(tone)tone[i]=chroma<36?Math.min(4,Math.floor(lum/52)):5+(rgba[p]>rgba[p+1]&&rgba[p]>rgba[p+2]?0:rgba[p+1]>rgba[p+2]?1:2);
      glyph[i] = lum<157 && chroma<185;
      light[i] = lum>202 && chroma<65;
      deep[i]=lum<70 && chroma<90;bright[i]=lum>233 && chroma<45;
      if(neutral)neutral[i]=lum<145&&chroma<24;
    }
    return {w,h,ink,glyph,light,deep,bright,neutral,tone,tileInk,tileTone,coverage:coverage/(w*h),visible,nonPaper,paper};
  }

  // Span, area and optional membership of each eight-connected component.
  function components(mask,w,h,visit) {
    const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
    for (let i=0;i<mask.length;i++) {
      if (!mask[i] || seen[i]) continue;
      let head=0, tail=1, l=i%w, r=l, t=(i/w)|0, b=t;
      seen[i]=1; queue[0]=i;
      while (head<tail) {
        const p=queue[head++], x=p%w, y=(p/w)|0;
        if (x<l) l=x; if (x>r) r=x; if (y>b) b=y;
        for (let ny=Math.max(0,y-1);ny<=Math.min(h-1,y+1);ny++) {
          for (let nx=Math.max(0,x-1);nx<=Math.min(w-1,x+1);nx++) {
            const n=ny*w+nx;
            if (mask[n] && !seen[n]) { seen[n]=1; queue[tail++]=n; }
          }
        }
      }
      visit({x:l,y:t,w:r-l+1,h:b-t+1,area:tail},queue,tail);
    }
  }

  const sw=12, sh=16;
  function shape(mask,stride,box) {
    const vec = new Float32Array(sw*sh);
    // Sample within each bin to keep one/two-pixel stems recognizable.
    for (let y=0;y<sh;y++) for (let x=0;x<sw;x++) {
      let sum=0;
      for (const dy of [.17,.5,.83]) for (const dx of [.17,.5,.83]) {
        const sx=box.x+Math.floor((x+dx)*box.w/sw), sy=box.y+Math.floor((y+dy)*box.h/sh);
        sum += mask[sy*stride+sx];
      }
      vec[y*sw+x]=sum/9;
    }
    return vec;
  }
  let templateCache;
  function templates() {
    if (templateCache) return templateCache;
    const list=[], canvas=makeCanvas(96,86), ctx=canvas.getContext('2d',{willReadFrequently:true});
    for (const [family,weight] of [['Arial','400'],['Arial','700'],['Arial Black','900'],['Times New Roman','400'],['Times New Roman','700']]) {
      for (const em of [17,24,36]) for (const letter of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        ctx.fillStyle='#fff'; ctx.fillRect(0,0,96,86); ctx.fillStyle='#000';
        ctx.font=weight+' '+em+'px "'+family+'"'; ctx.fillText(letter,12,62);
        const raw=ctx.getImageData(0,0,96,86).data, mask=new Uint8Array(96*86);
        let x0=96,y0=86,x1=-1,y1=-1;
        for (let p=0;p<mask.length;p++) if (raw[p*4]<163) {
          mask[p]=1; const x=p%96, y=(p/96)|0;
          x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y);
        }
        const box={x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
        list.push({letter,style:weight,family, ratio:box.w/box.h, height:box.h/em, vec:shape(mask,96,box)});
      }
    }
    templateCache=list;
    return list;
  }

  function glyphCandidates(a,lightText=false,override) {
    const {w,h}=a, glyph=override||(lightText?a.light:a.glyph), all=[], boxes=[];
    const limit=Math.max(18,Math.min(w,h)*.15);
    components(glyph,w,h,b => { if (b.w<=limit && b.h<=limit) all.push(b); });
    const minH=Math.max(5,Math.min(w,h)/180);
    // Join a detached dot only to a stem directly beneath it (i, j).
    const buckets=new Map();
    for (const b of all) {
      const key=Math.floor((b.x+b.w/2)/12);
      if (!buckets.has(key)) buckets.set(key,[]);
      buckets.get(key).push(b);
    }
    for (const b of all) {
      if (b.h<minH || b.area<5 || b.w>b.h*1.8 || b.area<.13*b.w*b.h) continue;
      boxes.push(b);
      if (b.w>b.h*.58) continue;
      const cx=b.x+b.w/2, col=Math.floor(cx/12);
      let dot=null, gap=Infinity;
      for (let k=col-1;k<=col+1;k++) for (const d of buckets.get(k)||[]) {
        const dy=b.y-d.y-d.h;
        if (dy<0 || dy>Math.max(3,b.h*.4) || dy>=gap || d.h>b.h*.43 || d.w>b.h*.5) continue;
        if (d.x+d.w<b.x || d.x>b.x+b.w || Math.abs(d.x+d.w/2-cx)>Math.max(1.5,b.w*.52)) continue;
        gap=dy; dot=d;
      }
      if (dot) {
        const left=Math.min(dot.x,b.x);
        boxes.push({x:left,y:dot.y,w:Math.max(dot.x+dot.w,b.x+b.w)-left,h:b.y+b.h-dot.y,joined:true});
      }
    }
    const lib=templates(), byLetter=new Map();
    for (const box of boxes) {
      const {x,y,w:bw,h:bh}=box, ratio=bw/bh;
      let left=0,right=0,above=0,below=0;
      const gap=Math.max(3,Math.round(bh*.49));
      for (let yy=y;yy<y+bh;yy++) for (let d=1;d<=gap;d++) {
        if (x-d>=0) left+=glyph[yy*w+x-d];
        if (x+bw+d-1<w) right+=glyph[yy*w+x+bw+d-1];
      }
      for (let yy=Math.max(0,y-gap);yy<y;yy++) for (let xx=x;xx<x+bw;xx++) above+=glyph[yy*w+xx];
      for (let yy=y+bh;yy<Math.min(h,y+bh+gap);yy++) for (let xx=x;xx<x+bw;xx++) below+=glyph[yy*w+xx];
      left/=gap*bh; right/=gap*bh; above/=gap*bw; below/=gap*bw;
      // At the top-left of a photo, the white paper outside the tile is not adjacent lettering.
      const paperEdge=lightText && left+above>.42 && right+below<.20;
      const crowd=(Math.min(left+right,.85)*.4+Math.min(left,right)*.7+
        Math.min(above+below,.85)*.34+Math.min(above,below)*.65)*(paperEdge?.24:1);
      if (crowd>.43) continue;
      let contextPenalty=0;
      {
        let occupied=0,n=0;
        const margin=Math.max(3,Math.round(bh*.55));
        for (let yy=Math.max(0,y-margin);yy<Math.min(h,y+bh+margin);yy+=2)
          for (let xx=Math.max(0,x-margin);xx<Math.min(w,x+bw+margin);xx+=2) {
            if (xx>=x && xx<x+bw && yy>=y && yy<y+bh) continue;
            n++;occupied+=a.ink[yy*w+xx];
          }
        if (lightText && occupied<.62*n) continue;
        if(override && occupied<.33*n) continue;
        if(occupied>.53*n || lightText) {
          // Printed letters inside photos are generally inset from a tile edge.
          // Reject texture that resembles an alphabet far from both paper gutters.
          const reach=Math.max(6,Math.round(bh*2.35)),len=Math.max(12,Math.round(bh*5.0));
          let top=y<reach?1:0,side=x<reach?1:0;
          for(let yy=Math.max(0,y-reach);top<.95 && yy<=y;yy++) {
            let clear=0,total=0;for(let xx=Math.max(0,x-bh*.34|0);xx<Math.min(w,x+len);xx+=2){clear+=1-a.ink[yy*w+xx];total++;}
            top=Math.max(top,clear/total);
          }
          for(let xx=Math.max(0,x-reach);side<.95 && xx<=x;xx++) {
            let clear=0,total=0;for(let yy=Math.max(0,y-bh*.34|0);yy<Math.min(h,y+len);yy+=2){clear+=1-a.ink[yy*w+xx];total++;}
            side=Math.max(side,clear/total);
          }
          if(Math.max(top,side)<.84 || (override && Math.min(top,side)<.35)) continue;
          contextPenalty=.11*(1-Math.min(top,side));
        }
      }
      const vec=shape(glyph,w,box);
      const best=new Map();
      for (const t of lib) {
        if (box.joined && t.letter!=='i' && t.letter!=='j') continue;
        const aspect=Math.abs(Math.log(ratio/t.ratio));
        if (aspect>.6) continue;
        let diff=0, total=0;
        for (let i=0;i<vec.length;i++) {
          diff+=Math.abs(vec[i]-t.vec[i]); total+=vec[i]+t.vec[i];
        }
        const error=diff/Math.max(1,total)+.20*aspect+crowd+contextPenalty;
        if (error>.44) continue;
        const prev=best.get(t.letter);
        if (!prev || error<prev.error) best.set(t.letter,{x,y,w:bw,h:bh,letter:t.letter,em:bh/t.height,error,style:t.style,light:lightText});
      }
      for (const c of best.values()) {
        let alternate=1;
        for(const other of best.values()) if (other.letter!==c.letter && (other.letter<'a')===(c.letter<'a')) alternate=Math.min(alternate,other.error);
        c.ambiguity=Math.max(0,c.error-alternate);
        if (!byLetter.has(c.letter)) byLetter.set(c.letter,[]);
        byLetter.get(c.letter).push(c);
      }
    }
    return byLetter;
  }

  function anchorSequence(a,byLetter,expected='') {
    const {w,h}=a;
    let winner={score:0,path:[]};
    for (const alphabet of expected?[expected]:['abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
      const first=(byLetter.get(alphabet[0])||[]).filter(c=>c.x<w*.48 && c.y<h*.38 && c.error<.32);
      for (const start of first) {
        const em=start.em;
        let states=[{c:start,path:[start],score:1.3-3*start.error-2.5*start.x/w-4*start.y/h}];
        for (const letter of alphabet.slice(1)) {
          const next=[];
          for (const c of byLetter.get(letter)||[]) {
            const size=Math.abs(Math.log(c.em/em));
            if (size>.36 || c.error+.23*size>.44 || c.ambiguity>.32) continue;
            let best=null;
            for (const s of states) {
              const dx=c.x-s.c.x, dy=c.y-s.c.y;
              const same=Math.abs(dy)<em*2.15 && dx>Math.max(em*1.55,w*.022);
              const lower=dy>Math.max(em*2.3,h*.028);
              const column=dy<0 && dx>Math.max(em*2.7,w*.06);
              if (!same && !lower && !column) continue;
              if (s.path.some(p=>Math.abs(p.x-c.x)<em*.7 && Math.abs(p.y-c.y)<em*.7)) continue;
              const rowCost=same?Math.abs(dy)/em*.09 : column?.28+.25*Math.abs(dy)/h:.12+Math.min(.65,c.x/w*.50);
              const aligned=s.path.some(p=>Math.abs(p.x-c.x)<em*1.25 || Math.abs(p.y-c.y)<em*1.5);
              const suffixRoom=Math.max(0,3-(h-c.y-c.h)/em);
              const score=s.score+1.29-3.3*c.error-1.4*size-rowCost-1.7*c.ambiguity-
                (aligned?0:.19)-(c.style===start.style?0:.09)-suffixRoom*.43;
              if (!best || score>best.score) best={c,path:s.path.concat(c),score};
            }
            if (best) next.push(best);
          }
          if (!next.length) break;
          next.sort((a,b)=>b.score-a.score);
          states=next.slice(0,64);
          const top=states[0];
          if (top.path.length>=2 && (expected?(top.path.length>winner.path.length||(top.path.length===winner.path.length&&top.score>winner.score)):top.score>winner.score)) winner=top;
        }
      }
    }
    return winner.path;
  }

  function distanceField(a) {
    const {w,h,ink}=a, d=new Uint16Array(w*h), far=8000;
    for (let y=0,i=0;y<h;y++) for (let x=0;x<w;x++,i++) {
      if (ink[i]) continue;
      let v=x ? d[i-1]+3 : far;
      if (y) {
        v=Math.min(v,d[i-w]+3);
        if (x) v=Math.min(v,d[i-w-1]+4);
        if (x+1<w) v=Math.min(v,d[i-w+1]+4);
      }
      d[i]=v;
    }
    for (let y=h-1,i=w*h-1;y>=0;y--) for (let x=w-1;x>=0;x--,i--) {
      let v=d[i];
      if (x+1<w) v=Math.min(v,d[i+1]+3);
      if (y+1<h) {
        v=Math.min(v,d[i+w]+3);
        if (x) v=Math.min(v,d[i+w-1]+4);
        if (x+1<w) v=Math.min(v,d[i+w+1]+4);
      }
      d[i]=v;
    }
    return d;
  }

  // Find a continuous gutter with dynamic programming. Ink is expensive to cross.
  // A finite cost and a later component vote also support imperfect/scanned images.
  function gutter(length,lo,hi,prior,clearance,allowed,em,fine=false) {
    lo=Math.floor(lo); hi=Math.max(lo+1,Math.ceil(hi));
    const step=fine?1:clamp(Math.round(em/9),1,5), n=Math.ceil((length-1)/step)+1;
    const span=1+Math.floor((hi-lo)/step);
    const track=new Int8Array(n*span), result=new Int32Array(length);
    let prev=new Float64Array(span), curr=new Float64Array(span);
    for (let k=0;k<n;k++) {
      const along=Math.min(length-1,k*step), expected=prior(along);
      for (let j=0;j<span;j++) {
        const cross=lo+j*step, d=clearance(along,cross);
        const offset=(cross-expected)/em;
        const cost=(allowed(along,cross)?0:2000) + (d<.5?80:0) +
          20*Math.exp(-d/(em*.18)) + .16*offset*offset;
        let best=0, delta=0;
        if (k) {
          best=Infinity;
          for (let v=Math.max(0,j-3);v<=Math.min(span-1,j+3);v++) {
            const bend=Math.abs(v-j);
            const score=prev[v]+bend*.77+bend*bend*.22;
            if (score<best) {best=score;delta=v-j;}
          }
        }
        curr[j]=cost+best; track[k*span+j]=delta;
      }
      [prev,curr]=[curr,prev];
    }
    let last=0;
    for (let j=1;j<span;j++) if (prev[j]<prev[last]) last=j;
    for (let k=n-1;k>=0;k--) {
      const end=Math.min(length-1,k*step), val=lo+last*step;
      result[end]=val;
      if (!k) break;
      last+=track[k*span+last];
      const start=(k-1)*step, before=lo+last*step;
      for (let z=start;z<end;z++) result[z]=Math.round(before+(val-before)*(z-start)/(end-start));
    }
    return result;
  }
  function interpolate(markers,x) {
    if (x<=markers[0].x) return markers[0].y;
    for (let i=1;i<markers.length;i++) if (x<markers[i].x) {
      const a=markers[i-1], b=markers[i];
      return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);
    }
    return markers.at(-1).y;
  }

  function sliceLayout(a,anchors,em,distance,printedGrid=false,tiles=[]) {
    const {w,h}=a, items=new Array(anchors.length),owners=new Int16Array(w*h);
    // A narrow straight white border is strong evidence between packed photographs.
    // On a sparse page the same border often lies inside a graph or above a heading.
    const denseMosaic=a.coverage>.60;
    function choose(group,rect) {
      let best=null;
      for (const vertical of [true,false]) {
        const axis=vertical?'x':'y', perp=vertical?'y':'x', span=vertical?'w':'h';
        const [start,end]=vertical?[rect[1],rect[3]]:[rect[0],rect[2]];
        const [low,high]=vertical?[rect[0],rect[2]]:[rect[1],rect[3]];
        const sorted=group.slice().sort((a,b)=>a[axis]-b[axis]);
        for (let cut=1;cut<sorted.length;cut++) {
          const lower=sorted.slice(0,cut), upper=sorted.slice(cut);
          const last=Math.max(...lower.map(p=>p[axis]+p[span])), first=upper[0][axis];
          if (first-last<em*1.15) continue;
          const near=upper.filter(p=>p[axis]-first<em*2.65);
          const primary=median(near.map(p=>p[axis]))-.64*em;
          const reach=printedGrid&&!tiles.length&&!near.some(p=>p.light)?2.15:5.8;
          const tileStart=Math.min(first,...near.filter(p=>p.corner&&p.tile).map(p=>p.tile[axis]));
          const lo=Math.max(low+1,Math.floor(last+1),Math.floor(Math.min(first-em*reach,tileStart-em*.5)));
          const hi=Math.min(high-1,Math.floor(first-1));
          if (lo>hi) continue;
          const alongStep=clamp(Math.round(em*.13),1,5);
          const crossing=new Float32Array(hi-lo+1);
          for(const t of tiles){
            const contains=p=>p.x+p.w/2>=t.x&&p.x+p.w/2<t.r&&p.y+p.h/2>=t.y&&p.y+p.h/2<t.b;
            if(lower.some(contains)&&upper.some(contains))continue;
            const extent=Math.min(end,vertical?t.b:t.r)-Math.max(start,t[perp]);
            if(extent<em)continue;
            const penalty=1.6*extent/(end-start);
            for(let c=Math.max(lo,t[axis]+2);c<=Math.min(hi,(vertical?t.r:t.b)-2);c++)crossing[c-lo]=Math.max(crossing[c-lo],penalty);
          }
          let cost=Infinity,line=lo,photoEdge=false;
          for (let c=lo;c<=hi;c++) {
            let ink=0,nearInk=0,n=0,local=0,maxLocal=0,adjacentA=0,adjacentB=0;
            const shoulder=Math.max(4,Math.round(em*.36));
            for (let t=start;t<end;t+=alongStep) {
              const gap=vertical?distance(c,t):distance(t,c);
              ink+=gap<.6?1:0;
              if(denseMosaic) {
                adjacentA+=(vertical?distance(c-shoulder,t):distance(t,c-shoulder))<1.5?1:0;
                adjacentB+=(vertical?distance(c+shoulder,t):distance(t,c+shoulder))<1.5?1:0;
              }
              nearInk+=Math.exp(-gap/(em*.23));n++;
              if (gap<.6) {local++;maxLocal=Math.max(local,maxLocal);} else local=0;
            }
            const offset=(c-primary)/em;
            const edge=ink/n<.065?Math.max(adjacentA,adjacentB)/n:0;
            const test=crossing[c-lo]+3.0*ink/n+.66*nearInk/n+.48*maxLocal/n+.010*offset*offset-
              (edge>.60?.70*edge:0);
            if (test<cost) {cost=test;line=c;photoEdge=edge>.60;}
          }
          // A horizontal split starting mid-page can bisect a tall panel on its left.
          // The same test, transposed, also applies to a right-hand column starting mid-page.
          const firstNear=Math.min(...near.map(p=>p[perp])), firstOther=Math.min(...lower.map(p=>p[perp]));
          const partial=Math.max(0,firstNear-firstOther-2.0*em)/Math.max(em,end-start);
          const balance=Math.abs(lower.length-upper.length)/group.length;
          const compatible=near.some(p=>lower.some(q=>Math.abs(p[perp]-q[perp])<em*2.5));
          const score=cost+1.45*partial+.09*balance-(compatible?.10:0)-.035*Math.min(3,near.length-1);
          if (!best || score<best.score) best={vertical,low,high,start,end,lower,upper,line,primary,score,photoEdge};
        }
      }
      return best;
    }
    function build(group,rect) {
      if (group.length===1) {
        const c=group[0], bleed=Math.ceil(em*1.75);
        items[c.id]={label:c.letter,anchor:[c.x,c.y,c.w,c.h],description:'',error:c.error,
          rough:[Math.max(0,rect[0]-bleed),Math.max(0,rect[1]-bleed),Math.min(w,rect[2]+bleed),Math.min(h,rect[3]+bleed)]};
        return {id:c.id};
      }
      let split=choose(group,rect);
      if (!split) {
        const xr=Math.max(...group.map(p=>p.x))-Math.min(...group.map(p=>p.x));
        const yr=Math.max(...group.map(p=>p.y))-Math.min(...group.map(p=>p.y));
        const vertical=xr>=yr,ax=vertical?'x':'y', s=group.slice().sort((a,b)=>a[ax]-b[ax]), half=s.length>>1;
        const line=clamp(Math.round((s[half-1][ax]+s[half][ax])*.5),vertical?rect[0]+1:rect[1]+1,vertical?rect[2]-1:rect[3]-1);
        split={vertical,lower:s.slice(0,half),upper:s.slice(half),line,
          low:vertical?rect[0]:rect[1],high:vertical?rect[2]:rect[3],start:vertical?rect[1]:rect[0],end:vertical?rect[3]:rect[2]};
      }
      const {vertical,lower,upper,line,low,high,start,end}=split;
      const ax=vertical?'x':'y',other=vertical?'y':'x',span=vertical?'w':'h',os=vertical?'h':'w';
      const radius=em*(split.photoEdge?.22:3.8);
      const lo=clamp(Math.floor(line-radius),low,high-1), hi=clamp(Math.ceil(line+radius),lo+1,high);
      const allowed=(pos,cross)=>{
        const t=start+pos;
        return !upper.some(p=>t>=p[other]-1 && t<=p[other]+p[os]+1 && cross>=p[ax]) &&
               !lower.some(p=>t>=p[other]-1 && t<=p[other]+p[os]+1 && cross<=p[ax]+p[span]);
      };
      const seam=gutter(Math.max(1,end-start),lo,hi,()=>line,(pos,cross)=>vertical?distance(cross,pos+start):distance(pos+start,cross),allowed,em,true);
      const left=rect.slice(),right=rect.slice();
      left[vertical?2:3]=line;right[vertical?0:1]=line;
      return {vertical,seam,start,a:build(lower,left),b:build(upper,right)};
    }
    const tree=build(anchors.map((c,id)=>({...c,id})),[0,0,w,h]);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      let node=tree;
      while (node.id===undefined) {
        const along=node.vertical?y:x,cross=node.vertical?x:y;
        node=cross<node.seam[clamp(along-node.start,0,node.seam.length-1)]?node.a:node.b;
      }
      owners[y*w+x]=node.id;
    }
    return {owners,items};
  }

  function textLines(boxes,vertical,em) {
    const chars=boxes.map(b=>({b,u:vertical?b.y:b.x,v:vertical?b.x:b.y,
      len:vertical?b.h:b.w,size:vertical?b.w:b.h})).sort((a,b)=>a.u-b.u);
    const parent=chars.map((_,i)=>i);
    function root(i) {while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
    for (let i=0;i<chars.length;i++) {
      const a=chars[i];
      for (let j=i+1;j<chars.length;j++) {
        const b=chars[j],gap=b.u-a.u-a.len;
        if (gap>em*1.05) break;
        const small=Math.min(a.size,b.size),big=Math.max(a.size,b.size);
        if (big>small*2.35 || gap>big*.63 || gap < -Math.min(a.len,b.len)*.55) continue;
        const overlap=Math.min(a.v+a.size,b.v+b.size)-Math.max(a.v,b.v);
        if (overlap>=small*.58 && Math.abs(a.v+a.size/2-b.v-b.size/2)<big*.45) parent[root(j)]=root(i);
      }
    }
    const groups=new Map();
    chars.forEach((c,i)=>{const k=root(i);if(!groups.has(k)) groups.set(k,[]);groups.get(k).push(c.b);});
    const lines=[];
    for (const glyphs of groups.values()) {
      if (glyphs.length<3) continue;
      let x=Infinity,y=Infinity,r=0,b=0;
      for (const g of glyphs){x=Math.min(x,g.x);y=Math.min(y,g.y);r=Math.max(r,g.x+g.w);b=Math.max(b,g.y+g.h);}
      const length=vertical?b-y:r-x, size=vertical?r-x:b-y;
      if (length>size*2.7 && length>em*1.5 && size<em*2.8) lines.push({x,y,r,b,glyphs});
    }
    return lines;
  }
  function restoreCaptions(a,owners,items,em) {
    const {w,h,glyph,ink}=a,chars=[],axes=[],rules=[];
    components(glyph,w,h,b=>{
      if (b.h>em*4 && b.h>b.w*12 && b.w<em*.6) rules.push(b);
      const ratio=b.area/(b.w*b.h);
      if (b.w>2.2*em && b.h>2*em && b.w/b.h>.46 && b.w/b.h<3.8 && ratio<.43) {
        let vertical=0,horizontal=0;
        for (let x=b.x;x<=b.x+b.w*.23;x++) {
          let run=0;for(let y=b.y;y<b.y+b.h;y++){run=glyph[y*w+x]?run+1:0;vertical=Math.max(vertical,run);}
        }
        for (let y=Math.floor(b.y+b.h*.72);y<b.y+b.h;y++) {
          let run=0;for(let x=b.x;x<b.x+b.w;x++){run=glyph[y*w+x]?run+1:0;horizontal=Math.max(horizontal,run);}
        }
        if (vertical>b.h*.63 && horizontal>b.w*.58) axes.push({...b,id:owners[Math.floor(b.y+b.h*.55)*w+Math.floor(b.x+b.w*.5)]});
      }
      if (b.area<4 || b.w>em*2.05 || b.h>em*2.05 || Math.max(b.w,b.h)<em*.21) return;
      let paper=0,total=0;
      const pad=Math.max(2,Math.round(em*.11));
      for(let x=b.x;x<b.x+b.w;x+=2) for(const y of [b.y-pad,b.y+b.h+pad]) if(y>=0 && y<h){paper+=1-ink[y*w+x];total++;}
      for(let y=b.y;y<b.y+b.h;y+=2) for(const x of [b.x-pad,b.x+b.w+pad]) if(x>=0 && x<w){paper+=1-ink[y*w+x];total++;}
      if (paper>total*.39) chars.push(b);
    });
    function assign(b,id,pad) {
      const l=Math.max(0,b.x-pad),r=Math.min(w,b.x+b.w+pad);
      for(let y=Math.max(0,b.y-pad);y<Math.min(h,b.y+b.h+pad);y++) owners.fill(id,y*w+l,y*w+r);
    }
    const lines=textLines(chars,false,em);
    const above=(s,g)=> Math.abs((s.x+s.r)/2-g.x-g.w/2)<g.w*.23 && s.r-s.x<g.w*1.45 &&
      s.b<=g.y+em*.1 && s.b>=g.y-em*2.8 && s.b-s.y>=em*.33;
    for(const g of axes) {
      const peers=axes.filter(p=>p!==g && p.id===g.id && Math.abs(p.y-g.y)<em*.85 &&
        Math.abs(p.w-g.w)<g.w*.4 && Math.abs(p.x-g.x)>g.w*.6);
      if(!peers.length) continue;
      for(const s of lines) if(above(s,g) && peers.some(p=>lines.some(t=>above(t,p) && Math.abs(t.b-s.b)<em*1.3))) {
        const id=owners[Math.floor((s.y+s.b)/2)*w+Math.floor((s.x+s.r)/2)];
        if(id!==g.id) assign({x:s.x,y:s.y,w:s.r-s.x,h:s.b-s.y},g.id,2);
      }
    }
    const columns=textLines(chars,true,em);
    for(const rule of rules) {
      const col=clamp(Math.floor(rule.x+rule.w+em*.8),0,w-1), mid=Math.floor(rule.y+rule.h*.5);
      let occupied=0,n=0;
      for(let y=Math.floor(rule.y+rule.h*.12);y<rule.y+rule.h*.88;y+=3){occupied+=ink[y*w+col];n++;}
      if(occupied<n*.72) continue;
      const adjacent=columns.filter(s=>s.r<rule.x+2 && rule.x-s.r<em*2.9 && s.b-s.y>rule.h*.55 &&
        Math.abs((s.b+s.y)/2-mid)<rule.h*.15);
      if(adjacent.length<2) continue;
      const id=owners[mid*w+col];
      for(const s of adjacent) assign({x:s.x,y:s.y,w:s.r-s.x,h:s.b-s.y},id,2);
      assign(rule,id,1);
    }
  }

  function restorePhotoTiles(a,owners,anchors,em){
    const tiles=[];
    components(a.ink,a.w,a.h,(b,q,n)=>{
      if(Math.min(b.w,b.h)<em*2.6||n<b.w*b.h*.42)return;
      const vote=new Uint32Array(anchors.length);for(let i=0;i<n;i++)vote[owners[q[i]]]++;
      let owner=0;for(let i=1;i<vote.length;i++)if(vote[i]>vote[owner])owner=i;
      if(vote[owner]<n*.72)return;tiles.push({...b,owner});
    });
    const eligible=(anchor,tile)=>anchor.x<tile.x+tile.w*.56+em*.5&&anchor.y<tile.y+tile.h*.48+em*.5;
    function patch(t,id){
      const hist=new Float64Array(8);let votes=0;
      for(let y=0;y<12;y++)for(let x=0;x<12;x++){
        const px=clamp(Math.floor(t.x+t.w*(.07+.86*x/11)),0,a.w-1),py=clamp(Math.floor(t.y+t.h*(.07+.86*y/11)),0,a.h-1),i=py*a.w+px;
        hist[a.tone[i]]+=1/144;if(owners[i]===id)votes++;
      }
      return {hist,votes};
    }
    const difference=(a,b)=>a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0);
    function assign(t,id){
      for(let y=t.y;y<t.y+t.h;y++){
        const start=y*a.w+t.x;for(let i=start;i<start+t.w;i++)if(owners[i]===t.owner)owners[i]=id;
      }
      t.owner=id;
    }
    const changes=[];
    for(const t of tiles){
      const prev=anchors[t.owner];
      if(eligible(prev,t))continue;
      const near=[];
      for(const q of tiles){
        if(q===t||q.owner===t.owner||!eligible(anchors[q.owner],q)||!eligible(anchors[q.owner],t))continue;
        for(const vertical of [true,false]){
          const along=vertical?'y':'x',across=vertical?'x':'y',len=vertical?'h':'w',breadth=vertical?'w':'h';
          const gap=t[along]-q[along]-q[len],offset=Math.abs(t[across]-q[across]),size=Math.abs(t[breadth]-q[breadth]);
          if(gap>=-2&&gap<em*2&&offset<em&&size<Math.max(em,t[breadth]*.20))near.push({id:q.owner,score:Math.abs(gap)+offset+size*.25});
        }
      }
      near.sort((a,b)=>a.score-b.score);
      if(near.length&&(!near[1]||near[1].id===near[0].id||near[1].score>near[0].score+em*.35))changes.push([t,near[0].id]);
    }
    for(const [t,id] of changes)assign(t,id);
    // Recheck a tile after the initial geometric repair. A fresh row label
    // and a matching photograph on its left can distinguish it from the row above.
    for(const t of tiles){
      const prev=anchors[t.owner];
      const next=anchors.findIndex(p=>p.y>prev.y+3*em&&Math.abs(p.x-prev.x)<2.1*em&&
        p.y<t.y+em*.65&&p.y>t.y-em*2&&p.x<t.x-em&&t.x-p.x<t.w*1.6);
      if(next<0)continue;
      const above=tiles.filter(q=>q.owner===t.owner&&q.y+q.h<t.y+2&&t.y-q.y-q.h<em*4&&
        Math.abs(q.x-t.x)<em&&Math.abs(q.w-t.w)<em*2).sort((a,b)=>b.y-a.y)[0];
      if(!above)continue;
      const sibling=patch({...t,x:t.x-t.w-em*.38},next),image=patch(t,t.owner);
      const sideDifference=difference(sibling.hist,image.hist),aboveDifference=difference(patch(above,t.owner).hist,image.hist);
      if(sibling.votes>=105&&sideDifference<.68&&aboveDifference>Math.max(.65,sideDifference*1.65))assign(t,next);
    }
  }
  function partition(a,anchors,printedGrid=false,tiles=[],details=[]) {
    const {w,h}=a, owners=new Int16Array(w*h).fill(-1);
    if (!anchors.length) return {owners,items:[]};
    const em=median(anchors.map(c=>c.em)), rows=[];
    for (const [id,c] of anchors.entries()) {
      let row=rows.at(-1);
      if (!row || c.x<=row.at(-1).x || Math.abs(c.y-row.at(-1).y)>em*2.8) {
        row=[];rows.push(row);
      }
      row.push({...c,id});
    }
    const d=distanceField(a);
    const distance=(x,y)=>d[clamp(y,0,h-1)*w+clamp(x,0,w-1)]/3;
    const firsts=rows.map(row=>row[0].x);
    if (tiles.length||Math.max(...firsts)-Math.min(...firsts)>Math.max(em*3.5,w*.095) || anchors.some(c=>c.light)) {
      const flexible=sliceLayout(a,anchors,em,distance,printedGrid,tiles);
      restoreStrokes(a,flexible.owners,flexible.items,em);
      restoreCaptions(a,flexible.owners,flexible.items,em);
      if(printedGrid)restorePhotoTiles(a,flexible.owners,anchors,em);
      if(tiles.length)PanelPlate.assignTiles(a,flexible.owners,anchors,tiles,em,details);
      return flexible;
    }
    const rowEdges=[new Int32Array(w)], initialRows=[0];
    for (let r=1;r<rows.length;r++) {
      const below=rows[r], above=rows[r-1], ys=below.map(c=>c.y);
      initialRows.push(Math.round(median(ys)-.55*em));
      const cut=gutter(w,Math.max(0,Math.min(...ys)-em*4.0),Math.min(h-1,Math.max(...ys)+em*1.1),
        x=>interpolate(below,x)-em*.55, distance,
        (x,y)=>!below.some(c=>x>=c.x-em*.18 && x<=c.x+c.w+em*.18 && y>=c.y-1) &&
                 !above.some(c=>x>=c.x-2 && x<=c.x+c.w+2 && y<=c.y+c.h+1),em);
      for (let x=0;x<w;x++) cut[x]=Math.max(cut[x],rowEdges.at(-1)[x]+1);
      rowEdges.push(cut);
    }
    rowEdges.push(new Int32Array(w).fill(h)); initialRows.push(h);
    const items=[];
    for (const [r,row] of rows.entries()) {
      const top=rowEdges[r], bottom=rowEdges[r+1], xEdges=[new Int32Array(h)], initialCols=[0];
      for (let j=1;j<row.length;j++) {
        const left=row[j-1], right=row[j], target=right.x-em*.61;
        initialCols.push(Math.round(target));
        const lo=clamp(Math.max(left.x+left.w+1,right.x-4.4*em),0,w-2);
        const nextLimit=j+1<row.length?row[j+1].x-1:w-1;
        const hi=clamp(Math.min(right.x+2.0*em,nextLimit),lo+1,w-1);
        const y0=clamp(Math.min(...top.subarray(lo|0,Math.ceil(hi)+1)),0,h-1);
        const y1=clamp(Math.max(...bottom.subarray(lo|0,Math.ceil(hi)+1)),y0+1,h);
        const part=gutter(y1-y0,lo,hi,()=>target,
          (pos,x)=>{const y=pos+y0; return y<top[x] || y>=bottom[x]?em:distance(x,y);},
          (pos,x)=>{const y=pos+y0;return !(y>=right.y-2 && y<=right.y+right.h+2 && x>=right.x-1) &&
            !(y>=left.y-2 && y<=left.y+left.h+2 && x<=left.x+left.w+1);},em);
        const cut=new Int32Array(h).fill(part[0],0,y0);
        cut.set(part,y0); cut.fill(part.at(-1),y1);
        for (let y=0;y<h;y++) cut[y]=Math.max(cut[y],xEdges.at(-1)[y]+1);
        xEdges.push(cut);
      }
      xEdges.push(new Int32Array(h).fill(w)); initialCols.push(w);
      for (const [j,c] of row.entries()) {
        const bleed=Math.ceil(em*1.75);
        items[c.id]={label:c.letter,anchor:[c.x,c.y,c.w,c.h],description:'',error:c.error,
          rough:[clamp(initialCols[j]-bleed,0,w),clamp(initialRows[r]-bleed,0,h),
            clamp(initialCols[j+1]+bleed,0,w),clamp(initialRows[r+1]+bleed,0,h)]};
        for (let y=0;y<h;y++) for (let x=xEdges[j][y];x<xEdges[j+1][y];x++) {
          if (y>=top[x] && y<bottom[x]) owners[y*w+x]=c.id;
        }
      }
    }
    restoreStrokes(a,owners,items,em);
    return {owners,items};
  }
  function restoreStrokes(a,owners,items,em) {
    const {w,h}=a;
    // Large touching tiles can be connected across two scientific panels.
    // Only reunite whole components when the minority is a narrow fringe or one local stroke.
    const votes=new Uint32Array(items.length), changed=new Set();
    components(a.visible,w,h,(box,queue,count)=>{
      const first=owners[queue[0]];
      let split=false;
      for (let i=1;i<count && !split;i++) split=owners[queue[i]]!==first;
      if (!split) return;
      votes.fill(0);
      for (let i=0;i<count;i++) votes[owners[queue[i]]]++;
      let owner=first;
      for (let i=0;i<votes.length;i++) if (votes[i]>votes[owner]) owner=i;
      if (Math.max(box.w,box.h)<em*2.8 || count-votes[owner]<Math.max(10,count*.018)) {
        for (let i=0;i<count;i++) owners[queue[i]]=owner;
      }
      if (count-votes[owner]>Math.max(10,em*.65)) {
        for (let i=0;i<votes.length;i++) if (votes[i]) changed.add(i);
      }
    });
    for (const i of changed) items[i].review=true;
  }

  function measure(model) {
    const {w,h,nonPaper,items,owners}=model;
    const boxes=items.map(()=>[w,h,0,0]);
    for (let i=0;i<owners.length;i++) {
      const id=owners[i];
      // Tight bounds retain even a one-level difference from the paper.
      // Detection thresholds must never decide which antialiased fringe to export.
      if (id<0 || !nonPaper[i]) continue;
      const box=boxes[id], x=i%w, y=Math.floor(i/w);
      if (x<box[0]) box[0]=x; if (x+1>box[2]) box[2]=x+1;
      if (y<box[1]) box[1]=y; if (y+1>box[3]) box[3]=y+1;
    }
    items.forEach((item,id)=>{
      item.box=boxes[id][2]>boxes[id][0]?boxes[id]:item.rough.slice();
      item.rough=[Math.min(item.rough[0],item.box[0]),Math.min(item.rough[1],item.box[1]),
        Math.max(item.rough[2],item.box[2]),Math.max(item.rough[3],item.box[3])];
    });
  }
  function analyze(source,pdfLetters=[],textBoxes=[],panelRun='',options={}) {
    const a=readRaster(source,!!panelRun,!!options.neutralGlyphs,!!options.plate);
    const candidates=glyphCandidates(a);
    function add(pool) {
      for(const [letter,options] of pool) {
        const list=candidates.get(letter)||[];
        for(const c of options) {
          const match=list.findIndex(p=>Math.abs(p.x-c.x)<=2 && Math.abs(p.y-c.y)<=2 &&
            Math.abs(p.h-c.h)<=3 && Math.abs(p.w-c.w)<=3);
          if(match<0) list.push(c);else if(list[match].error>c.error) list[match]=c;
        }
        candidates.set(letter,list);
      }
    }
    add(glyphCandidates(a,true));
    // A black printed label may touch a colored protein/cartoon. A neutral-ink
    // candidate can separate the glyph without editing any exported pixels.
    if(options.neutralGlyphs)add(glyphCandidates({...a,glyph:a.neutral}));
    if(a.coverage>.36) {add(glyphCandidates(a,false,a.deep));add(glyphCandidates(a,true,a.bright));}
    if(pdfLetters.length) {
      const pool=new Map(),sx=a.w/source.width,sy=a.h/source.height;
      // If the PDF explicitly draws a number or word at this location, its glyph
      // cannot serve as a separate panel letter (e.g. an axis zero mistaken for o).
      const boxes=textBoxes.map(p=>({text:p.text,x:p.x*sx,y:p.y*sy,w:p.w*sx,h:p.h*sy}));
      for(const [letter,list] of candidates)candidates.set(letter,list.filter(c=>{
        const x=c.x+c.w/2,y=c.y+c.h/2;
        return !boxes.some(b=>b.text!==letter&&x>b.x&&x<b.x+b.w&&y>b.y&&y<b.y+b.h&&
          c.w<=b.w*1.5&&c.h<=b.h*1.4);
      }));
      for(const p of pdfLetters) {
        if(p.w*sx<1.6 || p.h*sy<5 || p.h*sy>Math.min(a.h,a.w)*.13)continue;
        const value={letter:p.letter,x:Math.round(p.x*sx),y:Math.round(p.y*sy),w:Math.max(2,Math.round(p.w*sx)),
          h:Math.max(3,Math.round(p.h*sy)),em:p.em*sy,error:.045,ambiguity:0,style:'pdf',light:false};
        if(!pool.has(p.letter))pool.set(p.letter,[]);
        pool.get(p.letter).push(value);
      }
      add(pool);
    }
    let anchors=anchorSequence(a,candidates);
    if(panelRun&&(options.captionCandidates||anchors.length>panelRun.length&&anchors.slice(0,panelRun.length).map(c=>c.letter).join('')===panelRun))
      anchors=anchorSequence(a,candidates,panelRun);
    if (options.matchPrintedCase && panelRun) {
      // HTML legends often capitalize labels that were printed in lowercase.
      // Compare observed glyph paths without manufacturing missing letters.
      const other = panelRun === panelRun.toUpperCase() ? panelRun.toLowerCase() : panelRun.toUpperCase();
      const alternate = anchorSequence(a,candidates,other);
      const cost = path => path.reduce((n,p) => n + p.error + .25*p.ambiguity, 0);
      if (alternate.length > anchors.length || (alternate.length === anchors.length && cost(alternate) < cost(anchors))) {
        anchors = alternate;
        panelRun = other;
      }
    }
    let tiles=[],plate=false,aligned=[];
    if(options.plate&&panelRun&&anchors.length&&a.coverage>.22){
      const height=median(anchors.slice(0,3).map(p=>p.h));
      tiles=PanelPlate.rectangles(a,height);
      if(tiles.length>=3){
        const corners=PanelPlate.cornerLetters(source,a,tiles,height,panelRun,{makeCanvas,components,templates,shape});
        for(const [letter,list] of corners)candidates.set(letter,(candidates.get(letter)||[]).concat(list));
        const fitted=PanelPlate.sequence(a,candidates,panelRun,height,tiles);
        if(fitted.length){anchors=fitted;plate=true;}
      }
      if(!plate&&anchors.map(p=>p.letter).join('')===panelRun){
        const fit=PanelPlate.alignedRun(anchors,candidates,height);
        anchors=fit.anchors;aligned=fit.changes;
      }
    }
    const printedGrid=panelRun.length>=8&&anchors.length===panelRun.length&&anchors[0].letter===panelRun[0]&&a.coverage>.23;
    const details=plate?anchors.flatMap((p,id)=>(candidates.get(p.letter)||[])
      .filter(q=>q.subscript&&q.error<.25&&q.ambiguity<.07).map(q=>({...q,id}))):[];
    const model={...a,...partition(a,anchors,printedGrid,plate?tiles:[],details)};
    model.plate=plate;model.aligned=aligned;
    if(plate){
      model.plotFrames=PanelPlate.keepPlotFrames(model,anchors);
      model.diagrams=PanelPlate.keepDiagrams(model,anchors,tiles);
      model.sharedHeadings=PanelPlate.sharedHeadings(model,anchors,tiles,source);
      PanelPlate.keepInsets(model,anchors,tiles,source);
    }
    if(options.diagnostics){model.tiles=tiles;}
    if(options.diagnostics)model.candidates=[...candidates.values()].flat().map(c=>({...c}));
    measure(model);
    return model;
  }
  return {analyze,measure,makeCanvas,clamp};
})();
