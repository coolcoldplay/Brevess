/* Reconcile independent visual and author-caption evidence. All rectangles are
   displayed PDF page points until converted by PaperPDF.hints. */
const PaperFusion=(()=>{
  const upper=s=>String(s||'').toUpperCase();
  const letters=m=>m.items.map(p=>p.label).join('');
  const dispose=c=>{c.width=c.height=1;};
  const glyphBox=(p,m,box)=>p.anchor&&[
    box[0]+p.anchor[0]/m.w*(box[2]-box[0]),box[1]+p.anchor[1]/m.h*(box[3]-box[1]),
    box[0]+(p.anchor[0]+p.anchor[2])/m.w*(box[2]-box[0]),box[1]+(p.anchor[1]+p.anchor[3])/m.h*(box[3]-box[1])];
  async function analyze(doc,rec,pages,alive=()=>true){
    const evidence=rec.evidence,original=rec.box.slice(),meta=pages[rec.page-1];
    const expected=evidence?.expected.join('')||'',run=evidence?.run||'';
    const issues=[],changes=[];let best,initial;
    const issue=(code,message,extra={})=>issues.push({code,message,page:rec.page,...extra});
    async function read(box,captionRun='',scale=rec.resolution||3,neutralGlyphs=false,plate=false){
      const source=await PaperPDF.render(doc,rec.page,box,scale);
      try{
        if(!alive())throw Error('已取消');
        const h=PaperPDF.hints(meta,box,source);
        const detached=rec.resolution&&rec.captionPage!==rec.page?(rec.panelRun||''):'';
        const model=PanelEngine.analyze(source,h.letters,h.words,captionRun||detached,{captionCandidates:!!captionRun,diagnostics:true,neutralGlyphs,plate});
        return {source,model,box,captionRun,scale,neutralGlyphs,plate};
      }catch(error){dispose(source);throw error;}
    }
    try{
      // Reopening an edited Figure must reproduce its analysis raster exactly.
      if(rec.fusion){return await read(rec.box,rec.fusion.captionRun,rec.fusion.scale,rec.fusion.neutralGlyphs,rec.fusion.plate);}
      best=initial=await read(original);
      const baseline=letters(initial.model);
      const captionBox=evidence?.sources.find(s=>s.page===rec.captionPage)?.box;
      const samePage=rec.page===rec.captionPage&&captionBox;
      const groups=new Map();
      for(const p of meta.letters.filter(p=>samePage&&p.b[0]>=original[0]-3&&p.b[2]<=original[2]+3&&
        p.b[1]<captionBox[1]-4&&expected.includes(upper(p.s))&&(!run||run.includes(p.s))&&p.size>=4)){
        const key=p.font+'-'+Math.round(p.size*4);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
      }
      const alternatives=[...groups.values()].filter(g=>g.length===expected.length&&[...expected].every(l=>g.filter(p=>upper(p.s)===l).length===1));
      const coherent=alternatives.length===1?alternatives[0]:[];
      if(!rec.manualRegion&&evidence?.complete&&samePage&&evidence.sequential&&run&&coherent.length>=3&&
        upper(baseline)!==expected&&coherent.some(p=>p.b[1]>=original[1]&&p.b[3]<=original[3])&&
        coherent.some(p=>p.b[1]<original[1]-p.size)){
        const top=Math.max(0,Math.min(...coherent.map(p=>p.b[1]-.75*p.size)));
        // Do not cross another caption/figure boundary in the same column.
        const crosses=meta.caps.some(c=>c.n!==rec.n&&c.b[1]>top&&c.b[1]<original[1]&&c.b[0]<original[2]&&c.b[2]>original[0]);
        if(!crosses){
          const alt=await read([original[0],top,original[2],original[3]],'',3);
          const bound=coherent.every(p=>alt.model.items.some(i=>{
            const b=glyphBox(i,alt.model,alt.box);return i.label===p.s&&b&&Math.abs(b[0]-p.b[0])<p.size&&Math.abs(b[1]-p.b[1])<p.size;
          }));
          if(upper(letters(alt.model))===expected&&bound){best=alt;changes.push({code:'expanded',message:'图注与原页字母一致，已向上扩大整图范围，找回 '+run+'。',before:original,after:alt.box});}
          else{dispose(alt.source);issue('expansion-conflict','原框外有图注所列字母，但新范围的分割仍有冲突。',{box:[original[0],top,original[2],original[3]]});}
        }
      }
      if(evidence?.complete&&run&&evidence.sequential&&baseline.length>=2*expected.length&&best===initial){
        const alt=await read(original,run);
        if(letters(alt.model)===run){best=alt;changes.push({code:'candidates',message:'按作者图注和原页字形重新选择候选：'+baseline.length+' 块 → '+run+'。'});}
        else{dispose(alt.source);issue('candidate-conflict','图内候选过多，按图注仍无法得到完整且一致的字母。');}
      }
      if(evidence?.complete&&run&&evidence.sequential&&letters(best.model)===run&&best.model.items.some(p=>p.error>.30)){
        const alt=await read(best.box,run,best.scale,true),moves=[];
        const valid=letters(alt.model)===run&&alt.model.items.every((p,i)=>{
          const old=best.model.items[i],a=p.anchor,b=old.anchor;
          if(!a||!b)return false;
          if(Math.hypot(a[0]-b[0],a[1]-b[1])<b[3])return true;
          const peers=alt.model.items.filter(q=>q!==p&&q.error<.26),r=old.rough;
          const aligned=peers.some(q=>Math.abs(q.anchor[0]-a[0])<a[3]*.65)&&peers.some(q=>Math.abs(q.anchor[1]-a[1])<a[3]*.65);
          if(old.error<=.30||p.error>=.23||old.error-p.error<.07||!aligned||
             a[0]<r[0]||a[1]<r[1]||a[0]+a[2]>r[2]||a[1]+a[3]>r[3])return false;
          moves.push({code:'anchor-corrected',label:p.label,message:'Panel '+p.label+' 的原字母候选落在图内；已用中性墨色字形与相邻标签对齐位置校正。',
            before:glyphBox(old,best.model,best.box),after:glyphBox(p,alt.model,alt.box)});return true;
        });
        if(valid&&moves.length){if(best!==initial)dispose(best.source);best=alt;changes.push(...moves);}
        else dispose(alt.source);
      }
      // Remove repeated publisher furniture only with two matching peer pages and
      // a clear white gap before the Figure. Never trim because text alone says so.
      if(!rec.manualRegion&&samePage&&coherent.length>=3&&[...expected].every(l=>upper(letters(best.model)).includes(l))){
        const highest=Math.min(...coherent.map(p=>p.b[1])),em=coherent[0].size,start=Math.max(0,Math.floor(best.box[1])-1);
        if(highest-best.box[1]>3*em&&start<meta.h*.16){
          const rect=[Math.floor(best.box[0]),start,Math.ceil(best.box[2]),Math.ceil(highest)];
          async function bits(page){
            const c=await PaperPDF.render(doc,page,rect,1);
            try{
              if(!alive())throw Error('已取消');
              const {data}=c.getContext('2d').getImageData(0,0,c.width,c.height),ink=new Uint8Array(c.width*c.height);
              for(let i=0;i<ink.length;i++)ink[i]=Math.min(data[i*4],data[i*4+1],data[i*4+2])<218?1:0;
              return {ink,width:c.width,height:c.height};
            }finally{dispose(c);}
          }
          const ref=await bits(rec.page),rows=[];
          for(let y=0;y<ref.height;y++)if(ref.ink.subarray(y*ref.width,(y+1)*ref.width).some(Boolean))rows.push(y);
          const spans=[];for(const y of rows){if(!spans.length||spans.at(-1)[1]+4<y)spans.push([y,y]);else spans.at(-1)[1]=y;}
          const peers=[];for(const offset of [-4,-2,2,4]){
            const n=rec.page+offset,p=pages[n-1];if(p&&Math.abs(p.w-meta.w)<1&&Math.abs(p.h-meta.h)<1)peers.push(await bits(n));
          }
          let last=-1;
          for(const [top,bottom] of spans){
            const matches=peers.filter(p=>{
              if(p.width!==ref.width||p.height!==ref.height)return false;
              let both=0,either=0;for(let i=top*ref.width;i<(bottom+1)*ref.width;i++){if(p.ink[i]||ref.ink[i])either++;if(p.ink[i]&&ref.ink[i])both++;}
              return either>10&&both/either>.90;
            }).length;
            if(matches<2)break;last=bottom;
          }
          const next=rows.find(r=>r>last)??ref.height;
          if(last>=0&&next-last>=Math.max(5,em*.8)){
            const box=[best.box[0],start+last+Math.min(8,Math.floor((next-last)/2)),best.box[2],best.box[3]],alt=await read(box,best.captionRun,best.scale,best.neutralGlyphs);
            if(letters(alt.model)===letters(best.model)){
              if(best!==initial)dispose(best.source);best=alt;
              changes.push({code:'header',message:'已排除在多页相同位置重复的刊头；字母保持不变。',after:box});
            }else dispose(alt.source);
          }
        }
      }
      // Whole raster plates have no positioned PDF letters inside photographs.
      // Read their actual pixels, preserving an observed run beyond a partial legend.
      const visual=letters(best.model),inventory=run&&evidence.sequential?run:'';
      const plateRun=inventory&&visual.startsWith(inventory)?visual:
        inventory&&evidence.complete?inventory:visual;
      if(rec.resolution&&evidence?.expected?.length>=2&&plateRun.length>=4&&best.model.coverage>.22&&
         /^[A-Z]+$|^[a-z]+$/.test(plateRun)&&plateRun.startsWith(visual)){
        const alt=await read(best.box,plateRun,best.scale,best.neutralGlyphs,true);
        if((alt.model.plate||alt.model.aligned.length)&&letters(alt.model)===plateRun){
          const moved=alt.model.items.filter(p=>{
            const old=best.model.items.find(q=>q.label===p.label);
            return !old||Math.hypot(old.anchor[0]-p.anchor[0],old.anchor[1]-p.anchor[1])>p.anchor[3];
          }).map(p=>p.label);
          changes.push(alt.model.plate?
            {code:'photo-plate',message:'已按原图字形、照片边缘和图注重新划分。'+(moved.length?'新增或重新定位 '+moved.join('、')+'。':'')}:
            {code:'aligned-labels',message:'按原图同行或同列的连续字母校正了 '+alt.model.aligned.join('、')+' 的位置。'});
          if(best!==initial)dispose(best.source);
          best=alt;
        }else dispose(alt.source);
      }
      const observed=letters(best.model);
      if(evidence?.continuationPage)changes.push({code:'continued-legend',page:evidence.continuationPage,
        message:'已按作者的续页提示，从第 '+evidence.continuationPage+' 页接续逐 Panel 图注。'});
      for(const frame of best.model.frames||[]){
        changes.push({code:'inset',label:frame.label,message:'Panel '+frame.label+' 有独立插图边框，已单独提取。Panel '+frame.parent+' 同时保留原位插图。'});
      }
      for(const label of best.model.diagrams||[])
        changes.push({code:'diagram-strip',label,message:'Panel '+label+' 已按横向示意图的上下边缘取回图块。'});
      for(const label of best.model.plotFrames||[])
        changes.push({code:'plot-frame',label,message:'Panel '+label+' 已按原图的完整图框保留框内标题、坐标轴和图例。'});
      for(const labels of best.model.sharedHeadings||[])
        changes.push({code:'shared-heading',label:labels[0],message:'跨越 '+labels.join('、')+' 的带横线标题已在这些 Panel 中共同保留。'});
      for(const label of evidence?.expected||[])if(!upper(observed).includes(label))issue('missing-label','图注列出 '+label+'，图中尚未可靠定位。',{label});
      for(const p of best.model.items){
        const text=PaperCaption.forItem(evidence,p),box=glyphBox(p,best.model,best.box);
        if(text.recovered.length)changes.push({code:'caption-recovered',label:p.label,message:'图像找到 '+p.label+'，已按此字母从完整作者图注回填原文。'});
        else if(evidence?.text&&!text.matched)issue('caption-missing','Panel '+p.label+' 未找到独立作者图注，请核对完整原文。',{label:p.label,box});
        // Pixel candidates can have a plausible letter sequence at the wrong
        // location. Flag alternatives, separately from crop-boundary checks.
        const [x,y,w,h]=p.anchor||[];
        const competitors=(best.model.candidates||[]).filter(c=>c.letter===p.label&&c.error<.30&&
          Math.abs(Math.log(c.h/h))<.4&&Math.hypot(c.x-x,c.y-y)>h*2&&
          c.x>=p.rough?.[0]&&c.y>=p.rough?.[1]&&c.x+c.w<=p.rough?.[2]&&c.y+c.h<=p.rough?.[3]);
        if(p.error>.30||p.error>.25&&competitors.length)issue('anchor-ambiguous','Panel '+p.label+' 的字形置信度偏低，可能位于图内文字或纹理，请核对实际位置。',{label:p.label,box});
      }
      if(evidence&&!evidence.complete)issue('caption-incomplete','作者图注可能不完整；未用文字目录强制限制 Panel。');
      if(rec.uncertain)issue('figure-location','整图与图注的位置对应仍需人工确认。',{box:best.box});
      rec.box=best.box.slice();
      rec.fusion={version:2,baseline,observed,originalBox:original,captionRun:best.captionRun,scale:best.scale,neutralGlyphs:best.neutralGlyphs,plate:!!best.plate,changes,issues,
        anchors:best.model.items.map(p=>({label:p.label,box:glyphBox(p,best.model,best.box)}))};
      if(best!==initial)dispose(initial.source);
      delete best.model.candidates;delete best.model.tiles;
      return best;
    }catch(error){if(initial)dispose(initial.source);if(best&&best!==initial)dispose(best.source);throw error;}
  }
  return {analyze};
})();
