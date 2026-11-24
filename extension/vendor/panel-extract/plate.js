/* Read labels printed inside a raster figure. Detect photo edges on the small
   analysis raster, then compare glyphs at the resolution of the imported plate. */
const PanelPlate=(()=>{
  function scanEdges(ink,w,h,height){
    const step=Math.max(1,Math.round(height*.16));
    const tracks=[],bins=new Map(),stride=Math.ceil(w/3)+2;
    const fraction=(x,right,y)=>{
      let sum=0;
      for(let i=y*w+x;i<y*w+right;i++)sum+=ink[i];
      return sum/(right-x);
    };
    for(let y=0;y<h;y+=step){
      const row=y*w;
      for(let x=0;x<w;){
        while(x<w&&!ink[row+x])x++;
        const l=x;
        while(x<w&&ink[row+x])x++;
        if(x-l<height*2.4)continue;
        const key=Math.floor(l/3)*stride+Math.floor(x/3);
        let track;
        for(let i=-1;i<=1&&!track;i++)for(let j=-1;j<=1&&!track;j++){
          const q=bins.get(key+i*stride+j);
          if(q&&y-q.last<=height&&Math.abs(q.x-l)<=2&&Math.abs(q.r-x)<=2)track=q;
        }
        if(track){track.last=y;track.hits++;}
        else{track={x:l,r:x,y,last:y,hits:1};bins.set(key,track);tracks.push(track);}
      }
    }
    const tiles=[];
    for(const p of tracks){
      if(p.last-p.y<height*2.4||p.hits*step<Math.max(2*height,(p.last-p.y)*.45))continue;
      let t=p.y,b=p.last+1;
      while(t>0&&fraction(p.x,p.r,t-1)>.66)t--;
      while(b<h&&fraction(p.x,p.r,b)>.66)b++;
      if(!tiles.some(v=>Math.abs(v.x-p.x)<=2&&Math.abs(v.r-p.r)<=2&&Math.abs(v.y-t)<=2&&Math.abs(v.b-b)<=2))
        tiles.push({x:p.x,y:t,r:p.r,b});
    }
    return tiles;
  }
  function rectangles(a,height){
    const tiles=[];
    function record(t){
      if(!tiles.some(q=>Math.abs(q.x-t.x)<=2&&Math.abs(q.y-t.y)<=2&&Math.abs(q.r-t.r)<=2&&Math.abs(q.b-t.b)<=2))tiles.push(t);
    }
    for(const mask of [a.tileInk,a.ink]){
      for(const t of scanEdges(mask,a.w,a.h,height))record(t);
      const columns=new Uint8Array(mask.length);
      for(let y=0;y<a.h;y++)for(let x=0;x<a.w;x++)columns[x*a.h+y]=mask[y*a.w+x];
      for(const t of scanEdges(columns,a.h,a.w,height))record({x:t.y,y:t.x,r:t.b,b:t.r});
    }
    // A bright arrow or cell can interrupt a scanline at the corner. Across
    // an aligned row, a paper gutter persists down the height of the tile.
    const bands=[];
    for(const t of tiles){
      if(bands.some(b=>Math.abs(b.y-t.y)<height*.3&&Math.abs(b.b-t.b)<height*.3))continue;
      if(tiles.some(q=>q!==t&&Math.abs(q.y-t.y)<height*.3&&Math.abs(q.b-t.b)<height*.3&&
        (q.x>=t.r-2||t.x>=q.r-2)))bands.push(t);
    }
    for(const t of bands){
      const start=t.y+Math.round((t.b-t.y)*.08),end=t.b-Math.round((t.b-t.y)*.08);
      const stripe=new Uint8Array(a.w);
      for(let x=0;x<a.w;x++){
        let dark=0,total=0;
        for(let y=start;y<end;y+=3){dark+=a.tileInk[y*a.w+x];total++;}
        stripe[x]=dark>.49*total;
      }
      for(let x=0;x<a.w;){
        while(x<a.w&&!stripe[x])x++;
        const l=x;
        while(x<a.w&&stripe[x])x++;
        if(x-l<height*2.4)continue;
        const edge=(y,sign)=>{
          if(y<0||y>=a.h)return true;
          let inside=0,outside=0,n=0;
          for(let i=l+1;i<x-1;i+=2){
            inside+=a.tileInk[(y+sign)*a.w+i]||0;outside+=a.tileInk[y*a.w+i];n++;
          }
          return inside>.54*n&&outside<.36*n;
        };
        if(edge(t.y-1,2)||edge(t.b,-2))record({x:l,y:t.y,r:x,b:t.b});
      }
      // Complete a textured tile whose top scanlines were broken by white
      // annotation. Require matching lateral edges on both sides of the extension.
      for(const q of tiles.slice()){
        if(Math.abs(t.b-q.b)>3||q.y<=t.y+2||q.y-t.y>(t.b-t.y)*.65)continue;
        const neighbors=tiles.some(p=>Math.abs(p.y-t.y)<=3&&Math.abs(p.b-t.b)<=3&&
          Math.abs((p.r-p.x)-(q.r-q.x))<height*.45&&Math.min(Math.abs(q.r-p.x),Math.abs(p.r-q.x))<height);
        if(!neighbors)continue;
        let edges=0,n=0;
        for(let y=t.y+2;y<q.y;y+=2){
          if(q.x>1&&q.r<a.w-1&&a.ink[y*a.w+q.x+2]&&a.ink[y*a.w+q.r-3]&&
            (!a.tileInk[y*a.w+q.x-2]||!a.tileInk[y*a.w+q.r+1]))edges++;
          n++;
        }
        if(n&&edges>.60*n)record({x:q.x,y:t.y,r:q.r,b:t.b});
      }
    }
    return tiles;
  }

  function cornerLetters(source,a,tiles,height,alphabet,{makeCanvas,components,templates,shape}){
    const sx=source.width/a.w,sy=source.height/a.h;
    const scale=Math.min(3,sx,sy),canvas=makeCanvas(1,1),ctx=canvas.getContext('2d',{willReadFrequently:true});
    const library=templates().filter(t=>alphabet.includes(t.letter)),pool=new Map();
    const seen=new Set();
    for(const tile of tiles)for(const side of ['left','right','top','margin']){
      const right=side==='right',alongTop=side==='top',margin=side==='margin';
      if(alongTop&&tile.r-tile.x<height*5)continue;
      const width=alongTop?tile.r-tile.x:Math.min(tile.r-tile.x,Math.ceil(height*3.3));
      const depth=Math.min(tile.b-tile.y,Math.ceil(height*2.25));
      const x0=margin?Math.max(0,tile.x-Math.ceil(height*1.9)):right?tile.r-width:tile.x;
      const y0=margin?Math.max(0,tile.y-Math.ceil(height*.85)):tile.y;
      const key=[Math.round(x0/2),Math.round(y0/2),width,depth,right].join(',');
      if(seen.has(key))continue;
      seen.add(key);
      const w=canvas.width=Math.ceil(width*scale),h=canvas.height=Math.ceil(depth*scale);
      ctx.drawImage(source,x0*sx,y0*sy,width*sx,depth*sy,0,0,w,h);
      const rgba=ctx.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);
      for(const threshold of margin?[-95,-165]:[222,175,124,86,57,-85,-145]){
        const light=threshold>0;
        for(let i=0;i<mask.length;i++){
          const r=rgba[i*4],g=rgba[i*4+1],b=rgba[i*4+2];
          mask[i]=light?Math.min(r,g,b)>=threshold:Math.max(r,g,b)<=-threshold;
        }
        const boxes=[];
        components(mask,w,h,b=>boxes.push(b));
        for(const b of boxes){
          const H=b.h/scale;
          if(H<height*.64||H>height*1.32||b.w>b.h*1.48||b.area<b.w*b.h*.13)continue;
          if(b.y+b.h===h||(!right&&b.x+b.w===w)||(right&&b.x===0))continue;
          const inset=(right?w-b.x-b.w:b.x)/scale;
          if(margin&&x0+(b.x+b.w*.5)/scale>tile.x)continue;
          if((!alongTop&&inset>height*1.65)||b.y/scale>height*1.3)continue;
          const follows=boxes.some(q=>q!==b&&q.x>=b.x+b.w-1&&q.x<=b.x+b.w+b.h*.40&&
            q.y<b.y+b.h*.55&&q.y+q.h>b.y+b.h*.65&&q.h>b.h*.49&&q.h<b.h*1.45);
          if(follows)continue;
          const subscript=boxes.some(q=>q!==b&&q.x>=b.x+b.w-b.h*.12&&q.x<b.x+b.w+b.h*.48&&
            q.y>b.y+b.h*.47&&q.y<b.y+b.h*1.10&&q.h>=b.h*.28&&q.h<=b.h*.79);
          const vec=shape(mask,w,b),ratio=b.w/b.h,best=new Map();
          for(const t of library){
            const aspect=Math.abs(Math.log(ratio/t.ratio));
            if(aspect>.44)continue;
            let diff=0,total=0;
            for(let i=0;i<vec.length;i++){diff+=Math.abs(vec[i]-t.vec[i]);total+=vec[i]+t.vec[i];}
            const error=diff/Math.max(1,total)+.20*aspect;
            if(error>.34||error>=(best.get(t.letter)?.error??Infinity))continue;
            best.set(t.letter,{letter:t.letter,error,em:H/t.height,style:t.style});
          }
          for(const c of best.values()){
            const rival=Math.min(1,...[...best.values()].filter(v=>v!==c).map(v=>v.error));
            const ambiguity=Math.max(0,c.error-rival);
            if(ambiguity>.105)continue;
            const list=pool.get(c.letter)||[];
            const value={...c,x:Math.round(x0+b.x/scale),y:Math.round(y0+b.y/scale),
              w:Math.max(1,Math.round(b.w/scale)),h:Math.round(H),light,ambiguity,corner:true,
              right,subscript,tile,inset:margin?.65:(Math.min(inset/height,3)+b.y/scale/height)};
            list.push(value);pool.set(c.letter,list);
          }
        }
      }
    }
    for(const list of pool.values()){
      const suffixes=list.filter(c=>c.subscript&&c.error<.26);
      for(const c of list)if(suffixes.some(q=>Math.abs(q.x-c.x)<height*.28&&Math.abs(q.y-c.y)<height*.28))c.subscript=true;
      // With two separately printed numbered views, compare the actual sibling
      // glyph against the preceding tile. A bright feature can touch part of
      // the unsuffixed letter and prevent connected-component recognition.
      const repeats=[];
      for(const c of suffixes.sort((u,v)=>u.error-v.error)){
        if(!c.light||repeats.some(q=>Math.abs(q.x-c.x)<height*.5&&Math.abs(q.y-c.y)<height*.5))continue;
        repeats.push(c);
      }
      for(const p of repeats){
        if(!repeats.some(q=>q.x>p.x+height&&Math.abs(p.y-q.y)<height*.45))continue;
        const r=tiles.filter(t=>p.x>=t.x-1&&p.x+p.w<=t.r+1&&p.y>=t.y-1&&p.y<t.y+height&&
          Math.min(Math.abs(t.r-p.x-p.w),Math.abs(p.x-t.x))<height*1.4)
          .sort((u,v)=>(u.r-u.x)-(v.r-v.x))[0]||p.tile;
        const right=r.r-p.x-p.w<p.x-r.x;
        for(const t of tiles){
          const gap=r.x-t.r;
          if(gap<0||gap>height*.95||Math.abs(t.y-r.y)>height*.35||
             Math.abs(t.b-r.b)>height*.65||Math.abs((r.r-r.x)-(t.r-t.x))>height*.85)continue;
          if(suffixes.some(q=>q.x>=t.x&&q.x<t.r&&Math.abs(q.y-p.y)<height*.6))continue;
          let best=null;
          for(let dy=0;dy<=height*.7;dy++)for(let dx=0;dx<=height*1.05;dx++){
            const x=right?t.r-p.w-dx:t.x+dx,y=t.y+dy;
            if(x<t.x||x+p.w>t.r||y+p.h>t.b)continue;
            let fg=0,bg=0,both=0,clear=0;
            for(let j=0;j<p.h;j++)for(let i=0;i<p.w;i++){
              const ref=!a.tileInk[(p.y+j)*a.w+p.x+i],v=!a.tileInk[(y+j)*a.w+x+i];
              if(ref){fg++;both+=v;}else{bg++;clear+=!v;}
            }
            if(fg<p.w*p.h*.16||bg<p.w*p.h*.21||both/fg<.76||clear/bg<.45)continue;
            const error=1-(both/fg*.65+clear/bg*.35);
            if(error<.23&&(!best||error<best.error))best={...p,x,y,error,tile:t,right,subscript:false,inset:(dx+dy)/height};
          }
          if(best)list.push(best);
        }
      }
    }
    canvas.width=canvas.height=1;
    return pool;
  }
  // Keep isolated glyphs from the plate and allow a caption letter to be absent.
  // Local reading order can restart at the top of a column.
  function sequence(a,candidates,alphabet,height,tiles){
    const statesPerLetter=72;
    let states=[{score:0,path:[]}];
    for(const letter of alphabet){
      const choices=[];
      const list=candidates.get(letter)||[],suffixes=list.filter(p=>p.subscript&&p.error<.25);
      for(const c of list){
        const size=Math.abs(Math.log(c.h/height));
        if(size>.37||c.error>(c.corner?.33:.405)||c.ambiguity>(c.corner?.10:.14))continue;
        if(letter===alphabet[0]&&(c.x>a.w*.48||c.y>a.h*.37))continue;
        const suffix=suffixes.some(p=>Math.abs(p.x-c.x)<height*.3&&Math.abs(p.y-c.y)<height*.3);
        const precedes=!suffix&&suffixes.some(p=>(Math.abs(p.y-c.y)<height*.55&&p.x>c.x+height&&p.x<c.x+height*10)||
          (Math.abs(p.x-c.x)<height*.55&&p.y>c.y+height&&p.y<c.y+height*10));
        const margin=!c.light&&tiles.some(t=>t.x>=c.x+c.w-1&&t.x-c.x-c.w<height*.95&&
          Math.abs(t.y-c.y)<height*.6&&t.b-t.y>3*height);
        const quality=1.26-3.45*c.error-2.15*c.ambiguity-1.0*size+(precedes?.54:0)-(suffix?.75:0)+(margin?.58:0)+
          (c.corner?.36-.18*c.inset-(c.right?.20:0):0)-
          (letter===alphabet[0]?2.5*c.x/a.w+4*c.y/a.h:0);
        if(quality<=-.14)continue;
        const duplicate=choices.findIndex(q=>Math.abs(q.c.x-c.x)<height*.28&&Math.abs(q.c.y-c.y)<height*.28);
        if(duplicate<0)choices.push({c,quality});
        else if(quality>choices[duplicate].quality)choices[duplicate]={c,quality};
      }
      choices.sort((p,q)=>q.quality-p.quality);
      const next=states.map(s=>({score:s.score-.25,path:s.path}));
      for(const {c,quality} of choices.slice(0,48)){
        let best=null;
        for(const state of states){
          const prev=state.path.at(-1);
          if(state.path.some(p=>Math.abs(p.x-c.x)<height*.7&&Math.abs(p.y-c.y)<height*.7))continue;
          let transition=0;
          if(prev){
            const dx=c.x-prev.x,dy=c.y-prev.y;
            if(Math.abs(dy)<height*1.7&&dx>height)transition=.24;
            else if(dy>=height*1.7)transition=.04;
            else if(dx>height*2.6)transition=-.15;
            else if(c.corner&&prev.corner&&Math.abs(dy)<height*.7&&dx<0)transition=-.40;
            else continue;
            if(state.path.some(p=>Math.abs(p.x-c.x)<height||Math.abs(p.y-c.y)<height))transition+=.16;
            transition-=.19*(Math.abs(dx)/a.w+Math.abs(dy)/a.h);
          }
          const score=state.score+quality+transition;
          if(!best||score>best.score)best={score,path:[...state.path,c]};
        }
        if(best)next.push(best);
      }
      next.sort((p,q)=>q.score-p.score);
      states=next.slice(0,statesPerLetter);
    }
    const path=states[0].path;
    const photographic=path.filter(p=>p.corner&&p.light&&!p.subscript);
    const replicated=photographic.some(p=>candidates.get(p.letter)?.some(q=>q.subscript&&q.light&&q.error<.22&&
      (Math.abs(p.y-q.y)<height*.7&&q.x>p.x+height||Math.abs(p.x-q.x)<height*.7&&q.y>p.y+height)));
    return path.length>=3&&(photographic.length>=2||replicated)?path:[];
  }
  function assignTiles(a,owners,anchors,tiles,em,details){
    const ordered=tiles.slice().sort((u,v)=>(v.r-v.x)*(v.b-v.y)-(u.r-u.x)*(u.b-u.y));
    for(const t of ordered){
      const inner=anchors.filter(p=>p.x+p.w/2>=t.x&&p.x+p.w/2<t.r&&p.y+p.h/2>=t.y&&p.y+p.h/2<t.b);
      if(inner.length>1)continue;
      let id;
      if(inner.length){
        const p=inner[0];
        if(p.y>t.y+em*1.8)continue;
        id=anchors.indexOf(p);
      }else{
        const labels=new Set();
        for(const q of details){
          const p=anchors[q.id];
          if(q.y<t.y-1||q.y>t.y+em*1.1||q.x<t.x-1||q.x+q.w>t.r+1||
             Math.min(q.x-t.x,t.r-q.x-q.w)>em)continue;
          const across=Math.abs(p.y-q.y)<em*.9&&q.x>p.x+em;
          const down=Math.abs(p.x-q.x)<em*.9&&q.y>p.y+em;
          if(!across&&!down)continue;
          const axis=across?'x':'y',other=across?'y':'x';
          if(!anchors.some(v=>v!==p&&v[axis]>p[axis]&&v[axis]<q[axis]&&Math.abs(v[other]-p[other])<em))
            labels.add(q.id);
        }
        if(labels.size===1)id=[...labels][0];
      }
      if(id===undefined){
        const votes=new Uint16Array(anchors.length);
        for(let i=0;i<12;i++)for(let j=0;j<12;j++){
          const x=Math.floor(t.x+(i+.5)/12*(t.r-t.x)),y=Math.floor(t.y+(j+.5)/12*(t.b-t.y));
          votes[owners[y*a.w+x]]++;
        }
        const best=Math.max(...votes);
        if(best<144*.64)continue;
        id=votes.indexOf(best);
      }
      for(let y=t.y;y<t.b;y++)owners.fill(id,y*a.w+t.x,y*a.w+t.r);
    }
  }
  function enclosedFrame(a,p,t,dark=false){
    const em=p.h;
    // Test a light rule against the pixels on both sides. Verify the entire
    // perimeter so an arrow, axis or scale bar cannot establish an inset.
    function line(vertical,c,start,end){
      let hit=0,n=0;
      if(c<1||c>=(vertical?a.w:a.h)-1)return 0;
      const stride=vertical?1:a.w;
      for(let i=Math.max(0,start+1);i<Math.min(vertical?a.h:a.w,end-1);i++){
        const k=vertical?i*a.w+c:c*a.w+i;
        const low=a.tileTone[k-stride],high=a.tileTone[k+stride],v=a.tileTone[k];
        if(dark?v<Math.max(low,high)-8&&v<(low+high)/2-4:
          v>Math.min(low,high)+8&&v>(low+high)/2+4)hit++;
        n++;
      }
      return n?hit/n:0;
    }
    function peaks(vertical,lo,hi,start,end){
      const scores=[];
      for(let c=lo;c<=hi;c++){
        const value=line(vertical,c,start,end);
        if(value>.55)scores.push({c,value});
      }
      return scores.sort((p,q)=>q.value-p.value).slice(0,9).map(v=>v.c);
    }
    const step=Math.ceil(em*1.6),x=p.x,y=p.y;
    const left=peaks(true,Math.max(t.x-1,x-step),x,y+p.h,y+p.h+em);
    const top=peaks(false,Math.max(t.y-1,y-step),y,x+p.w,x+p.w+em);
    if(!left.length||!top.length)return null;
    const reach=em*(dark?42:22);
    const right=peaks(true,x+p.w+Math.ceil(em*.65),Math.min(t.r-1,x+reach),y+p.h,y+p.h+em);
    const bottom=peaks(false,y+p.h+Math.ceil(em*.65),Math.min(t.b-1,y+reach),x+p.w,x+p.w+em);
    let best=null;
    for(const l of left)for(const u of top)for(const r of right)for(const b of bottom){
      if((r-l)*(b-u)>(t.r-t.x)*(t.b-t.y)*.6)continue;
      if(dark&&(r-l<em*8||b-u<em*4))continue;
      const sides=[line(true,l,u,b),line(false,u,l,r),line(true,r,u,b),line(false,b,l,r)];
      const score=sides.reduce((n,s)=>n+s,0);
      if(Math.min(...sides)>.65&&score>3.25&&(!best||score>best.score))best={box:[l,u,r+1,b+1],score};
    }
    return best?.box;
  }
  function keepPlotFrames(a,anchors){
    const changes=[];
    for(const [id,p] of anchors.entries()){
      if(p.light)continue;
      const box=enclosedFrame(a,p,{x:0,y:0,r:a.w,b:a.h},true);
      if(!box)continue;
      const [l,t,r,b]=box;
      if(anchors.some(q=>q!==p&&q.x+q.w/2>=l&&q.x+q.w/2<r&&q.y+q.h/2>=t&&q.y+q.h/2<b))continue;
      let ink=0,foreign=0;
      for(let y=t;y<b;y+=2)for(let x=l;x<r;x+=2){
        const i=y*a.w+x;if(a.ink[i]){ink++;if(a.owners[i]!==id)foreign++;}
      }
      if(ink>(r-l)*(b-t)*.13||foreign<Math.max(5,ink*.025))continue;
      for(let y=t;y<b;y++)a.owners.fill(id,y*a.w+l,y*a.w+r);
      changes.push(p.letter);
    }
    return changes;
  }
  function keepInsets(model,anchors,tiles,source){
    const {w,h,owners,items}=model,touched=new Set(),frames=[],plans=[];
    const inside=(p,t)=>p.x+p.w/2>=t.x&&p.x+p.w/2<t.r&&p.y+p.h/2>=t.y&&p.y+p.h/2<t.b;
    for(const t of tiles){
      const group=anchors.filter(p=>inside(p,t));
      if(group.length<2||group.length>4||group.some(p=>p.y>t.y+p.h*1.8))continue;
      const children=[],unframed=[];
      for(const p of group){
        const box=enclosedFrame(model,p,t);
        if(box&&!group.some(q=>q!==p&&inside(q,{x:box[0],y:box[1],r:box[2],b:box[3]})))children.push({p,box});
        else unframed.push(p);
      }
      if(!children.length||unframed.length!==1)continue;
      const parent=unframed[0],id=anchors.indexOf(parent);
      // A row of peer tiles separated by a full-height gutter is not an inset.
      const hasGutter=children.some(({box})=>box[3]>=t.b-parent.h*.5||box[2]-box[0]>=t.r-t.x-parent.w*.5);
      if(hasGutter)continue;
      plans.push({group,children,parent,id,t,area:(t.r-t.x)*(t.b-t.y)});
    }
    plans.sort((p,q)=>q.children.length-p.children.length||p.area-q.area);
    for(const {group,children,parent,id,t} of plans){
      if(group.some(p=>touched.has(p)))continue;
      const childIds=new Set(children.map(({p})=>anchors.indexOf(p)));
      for(let i=0;i<owners.length;i++)if(childIds.has(owners[i]))owners[i]=id;
      for(let y=t.y;y<t.b;y++)owners.fill(id,y*w+t.x,y*w+t.r);
      for(const {p,box} of children){
        const child=anchors.indexOf(p),[l,u,r,b]=box;
        for(let y=u;y<b;y++)owners.fill(child,y*w+l,y*w+r);
        // Manual corrections and the PNG/PPTX exporters already support
        // overlapping native regions through the same addition mask.
        (items[id].additions??=[]).push([Math.floor(l*source.width/w),Math.floor(u*source.height/h),
          Math.ceil(r*source.width/w),Math.ceil(b*source.height/h)]);
        items[child].insetOf=parent.letter;frames.push({label:p.letter,parent:parent.letter});
      }
      group.forEach(p=>touched.add(p));
    }
    model.frames=frames;
  }
  // A short schematic immediately above the next label can touch a drawing
  // below. Follow the wide band of aligned, coloured boxes to its lower edge.
  function keepDiagrams(a,anchors,tiles){
    const changes=[];
    for(const [id,p] of anchors.entries()){
      if(p.light)continue;
      const em=p.h;
      const next=anchors.filter(q=>q.y>p.y+em*1.3&&q.y<p.y+em*8&&Math.abs(p.x-q.x)<em*1.6).sort((u,v)=>u.y-v.y)[0];
      if(!next)continue;
      const peers=anchors.filter(q=>q.x>p.x+em*2&&Math.abs(q.y-p.y)<em*1.5);
      let l=Math.max(0,p.x-Math.ceil(em*1.4)),r=Math.min(a.w,...peers.map(q=>q.x-1));
      const top=Math.max(0,p.y-Math.ceil(em*.8));
      for(const t of tiles){
        if(t.y>p.y+em||t.b<next.y-em)continue;
        if(t.r<=p.x)l=Math.max(l,t.r);
        if(t.x>p.x+em*3&&peers.some(q=>q.x>=t.x&&q.x<t.r))r=Math.min(r,t.x);
      }
      if(r-l<em*7)continue;
      const rows=[];
      for(let y=top;y<next.y;y++){
        let ink=0,color=0,wide=0,x=l;
        while(x<r){
          if(!a.ink[y*a.w+x]){x++;continue;}
          const start=x;
          while(x<r&&a.ink[y*a.w+x]){if(a.tone[y*a.w+x]>=5)color++;x++;}
          ink+=x-start;if(x-start>em*1.5)wide++;
        }
        rows.push({density:ink/(r-l),box:wide>=2&&ink>(r-l)*.47,color});
      }
      for(let i=0;i<rows.length;){
        if(!rows[i].box){i++;continue;}
        const start=i;
        while(i<rows.length&&rows[i].box)i++;
        const end=i;
        if(end-start<em*.4||end-start>em*2.15||end>=rows.length||rows[start].density-(rows[start-1]?.density??0)<.18||
           rows[end-1].density-rows[end].density<.15||rows.slice(start,end).reduce((n,s)=>n+s.color,0)<(r-l)*.35)continue;
        let bottom=end,safeTop=top;
        while(bottom<rows.length&&rows[bottom].density>.2&&rows[bottom].density<=rows[end-1].density*.75&&bottom-end<em*.22)bottom++;
        for(let y=top;y<p.y;y++)if(rows[y-top].density<.012)safeTop=y+1;
        let changed=0;
        for(let y=safeTop;y<top+bottom;y++)for(let x=l;x<r;x++){
          const k=y*a.w+x;if(a.ink[k]&&a.owners[k]!==id)changed++;
          a.owners[k]=id;
        }
        if(changed>em)changes.push(p.letter);
        break;
      }
    }
    return changes;
  }
  function sharedHeadings(a,anchors,tiles,source){
    const changes=[],done=new Set();
    for(const p of anchors){
      if(!p.light||done.has(p))continue;
      const em=p.h,group=anchors.filter(q=>q.light&&Math.abs(q.y-p.y)<em*.75);
      // Only share a title when a printed rule actually spans separate panels.
      for(const t of tiles.filter(t=>p.x>=t.x-1&&p.x<t.r&&p.y>=t.y&&p.y-t.y<em*1.2)){
        const min=Math.max(0,t.y-Math.ceil(em*1.4));
        for(let y=t.y-2;y>=min;y--){
          if(!a.ink[y*a.w+p.x])continue;
          let l=p.x,r=p.x+1;
          while(l>0&&a.ink[y*a.w+l-1])l--;
          while(r<a.w&&a.ink[y*a.w+r])r++;
          const members=group.filter(q=>q.x+q.w/2>=l&&q.x+q.w/2<r&&Math.abs(q.y-t.y)<em*1.25);
          if(r-l<em*9||members.length<2||members.some(q=>done.has(q)))continue;
          const density=row=>{
            let sum=0;for(let x=l;x<r;x++)sum+=a.ink[row*a.w+x];return sum/(r-l);
          };
          let u=y;while(u>min&&density(u-1)>.8)u--;
          if(y-u>em*.24)continue;
          let text=0,gap=0,top=u;
          for(let j=u-1;j>=Math.max(0,u-Math.ceil(em*2));j--){
            const d=density(j);
            if(d>.55)break;
            if(d>.016){text++;gap=0;top=j;}else if(++gap>em*.33)break;
          }
          if(text<em*.33)continue;
          const b=Math.min(t.y,y+2);
          for(let v=top;v<b;v++)a.owners.fill(anchors.indexOf(p),v*a.w+l,v*a.w+r);
          const rect=[Math.floor(l*source.width/a.w),Math.floor(Math.max(0,top-1)*source.height/a.h),
            Math.ceil(r*source.width/a.w),Math.ceil(b*source.height/a.h)];
          for(const q of members){done.add(q);(a.items[anchors.indexOf(q)].additions??=[]).push(rect.slice());}
          changes.push(members.map(q=>q.letter));break;
        }
        if(done.has(p))break;
      }
    }
    return changes;
  }
  // Two stable endpoints and a third aligned label can disambiguate characters
  // in a table from the panel run down a column (or across a row).
  function alignedRun(anchors,pool,height){
    const result=anchors.slice(),changes=[];
    for(const vertical of [true,false]){
      const axis=vertical?'y':'x',cross=vertical?'x':'y';
      for(let i=0;i<result.length-3;i++)for(let j=i+3;j<Math.min(result.length,i+7);j++){
        const first=result[i],last=result[j],length=last[axis]-first[axis];
        if(first.light||last.light||Math.abs(first[cross]-last[cross])>height*.40||length<(j-i)*height*2)continue;
        const support=result.some((p,k)=>(k===i-1||k===j+1||k>i&&k<j)&&!p.light&&
          Math.abs(p[cross]-first[cross])<height*.45&&(k<i?p[axis]<first[axis]:k>j?p[axis]>last[axis]:p[axis]>first[axis]&&p[axis]<last[axis]));
        if(!support)continue;
        const path=[first];let corrected=0;
        for(let k=i+1;k<j;k++){
          const old=result[k],step=length/(j-i),prior=first[axis]+step*(k-i);
          const slots=(pool.get(old.letter)||[]).filter(p=>!p.light&&!p.corner&&p.error<.31&&p.ambiguity<.09&&
            Math.abs(p[cross]-first[cross])<height*.6&&Math.abs(p.h-first.h)<height*.25&&
            p[axis]>path.at(-1)[axis]+height&&Math.abs(p[axis]-prior)<step*.51);
          if(!slots.length)break;
          const best=slots.sort((a,b)=>a.error-b.error)[0];
          if(Math.abs(old[cross]-first[cross])>height*2&&
             (old[axis]<first[axis]||old[axis]>last[axis]))corrected++;
          else if(Math.hypot(old.x-best.x,old.y-best.y)>height)break;
          path.push(best);
        }
        if(corrected<2||path.length!==j-i)continue;
        path.forEach((p,k)=>{if(Math.hypot(result[i+k].x-p.x,result[i+k].y-p.y)>height)changes.push(p.letter);result[i+k]=p;});
      }
    }
    return {anchors:result,changes};
  }
  return {rectangles,cornerLetters,sequence,assignTiles,alignedRun,keepInsets,keepPlotFrames,keepDiagrams,sharedHeadings};
})();
