/* Author evidence is read from the imported PDF only. No inferred text is written
   into the original caption. BREVESS parsers are pinned in vendor/brevess/. */
const PaperCaption=(()=>{
  const upper=s=>String(s||'').toUpperCase();
  function title(text,label){
    let value=SciLLM.extractFigureTitle(text,label).title.replace(/^[|｜\s]+/u,'');
    const group=value.search(/\s*[（(][A-Z](?:\s*(?:[-–—,&]|\band\b|\bor\b)\s*[A-Z])*[）)]\s*/u);
    if(group>=0)value=value.slice(0,group).trim();
    // PDF captions often keep the title and "a," in the same line. The
    // publisher-DOM helper has no sentence boundary there; retain the title.
    return value.match(/^(.+?[.!?])(?:\s|$)/u)?.[1]||value;
  }
  function panel(evidence,label){
    if(!evidence?.text)return {targetText:'',sharedLegend:'',matched:false};
    const sections=evidence.lineSections?.filter(s=>s.labels.some(l=>upper(l)===upper(label)));
    if(sections?.length)return {targetText:sections.map(s=>s.text).join('\n'),sharedLegend:evidence.lineLegend,matched:true};
    const value=SciLLM.extractFigurePanelCaption(evidence.text,label);
    // The upstream fallback returns the entire caption when no markers exist.
    const matched=!!value.targetText&&value.targetText!==evidence.text.slice(0,6000);
    return {...value,matched};
  }
  // Some printed legends use A) and D–G) at the beginning of a PDF line.
  // Parenthetical references within the paragraph do not start a new entry.
  function bareSections(sources){
    const sections=[],intro=[];
    for(const text of sources.flatMap(s=>s.text.split(/(?<=[.!?])\s+(?=[A-Za-z](?:\s*[-–—]\s*[A-Za-z])?\)\s+\S)/u))){
      const match=/^([A-Za-z])(?:\s*[-–—]\s*([A-Za-z]))?\)\s+\S/u.exec(text);
      if(match){
        const first=match[1].charCodeAt(0),last=(match[2]||match[1]).charCodeAt(0);
        if(last>=first&&last-first<26)sections.push({labels:Array.from({length:last-first+1},(_,i)=>String.fromCharCode(first+i)),lines:[]});
      }
      (sections.at(-1)?.lines||intro).push(text);
    }
    if(!/^[Aa]$/.test(sections[0]?.labels[0]||'')||sections.length<2)return null;
    return {lineLegend:intro.join(' '),lineSections:sections.map(({labels,lines})=>({labels,text:lines.join(' ')}))};
  }
  function attach(entries,pages,fingerprint=''){
    const inputs=pages.map(p=>p.captionInput).filter(Boolean);
    const figures=SciLLM.extractNativePdfFigures(inputs,{sourceFingerprint:fingerprint});
    const lineCache=new Map();
    function lines(n){
      const input=pages[n-1]?.captionInput;
      if(input&&!lineCache.has(n))lineCache.set(n,SciLLM.nativePdfPageLines(input));
      return lineCache.get(n)||[];
    }
    const kind={main:'main',supp:'supplemental',ed:'extended-data'};
    for(const rec of entries){
      const matches=figures.filter(f=>f.figureNumber===rec.n&&f.figureSeries===kind[rec.kind]&&
        f.captionPageNumbers.includes(rec.captionPage));
      const f=matches.length===1?matches[0]:null;
      if(!f){rec.evidence={text:rec.caption||'',title:'',expected:[],complete:false,sources:[],issues:['未能唯一对应完整作者图注。']};continue;}
      const provenance=e=>{
        const line=lines(e.pageNumber)[e.lineIndex];
        const r=line?.pdfRect,t=pages[e.pageNumber-1]?.transform;
        let box=null;
        if(r&&t){
          const ps=[[r.left,r.bottom],[r.right,r.bottom],[r.left,r.top],[r.right,r.top]]
            .map(([x,y])=>[t[0]*x+t[2]*y+t[4],t[1]*x+t[3]*y+t[5]]);
          box=[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))];
        }
        return {page:e.pageNumber,text:e.text,box};
      };
      const sources=f.captionLineEvidence.map(provenance);
      let bare=bareSections(sources),continuation=[];
      const end=f.captionLineEvidence.at(-1);
      if(bare&&end&&!f.captionComplete&&pages[end.pageNumber-1]?.caps?.length===1&&
         /^\(?\s*(?:figure\s+)?legend continued on (?:the )?next page\s*\)?\.?$/i.test(lines(end.pageNumber).filter(l=>l.text).at(-1)?.text||'')){
        const next=pages[end.pageNumber],lastLabel=bare.lineSections.at(-1).labels.at(-1);
        const band=lines(end.pageNumber+1).map((l,i)=>({...l,i})).filter(l=>l.text?.trim());
        const matches=band.flatMap(l=>l.text.match(/^([a-z])\)\s+/i)?.slice(1)||[]);
        const em=lines(end.pageNumber)[end.lineIndex]?.height;
        // Accept only a page consisting of a single caption paragraph in the
        // original type size, starting with the next explicitly printed label.
        if(next&&!next.caps?.length&&!next.tables?.length&&!next.blocks?.length&&band.length<=52&&matches.length>=2&&
           band[0].text.startsWith(matches[0]+')')&&matches.every((l,i)=>l.charCodeAt(0)===lastLabel.charCodeAt(0)+i+1)&&
           band.every((l,i)=>Math.abs(l.height-em)<em*.29&&(!i||Math.abs(l.y-band[i-1].y)<em*2.5))){
          continuation=band.map(l=>provenance({pageNumber:end.pageNumber+1,lineIndex:l.i,text:l.text}));
          sources.push(...continuation);bare=bareSections(sources);
        }
      }
      const e=rec.evidence={figureId:f.figureId,figureLabel:f.figureLabel,fingerprint,
        text:[f.caption,...continuation.map(s=>s.text)].join(' '),title:title(f.caption,f.figureLabel),
        expected:f.panelHints.filter(l=>/^[A-Z]$/.test(l)),complete:f.captionComplete,
        sources,issues:f.captionComplete?[]:['图注可能跨页或截断，请核对完整原文。']};
      if(continuation.length)e.continuationPage=continuation[0].page;
      if(bare){
        Object.assign(e,bare);
        const declared=bare.lineSections.flatMap(s=>s.labels);
        e.expected=[...new Set([...e.expected,...declared.map(upper)])].sort();
        const repeats=[...new Set(declared.filter((v,i)=>declared.indexOf(v)!==i))];
        if(repeats.length)e.issues.push('作者原图注重复标注 '+repeats.join('、')+'，请从原页核对对应段落。');
        if(bare.lineLegend)e.title=title(bare.lineLegend,f.figureLabel);
      }
      // Use author punctuation/case, never manufacture a run from missing letters.
      const forms=e.expected.map(l=>panel(e,l).targetText.match(/^\s*\(?([A-Za-z])(?:\b|,|–|\))/u)?.[1]).filter(Boolean);
      const expected=e.expected.join('');
      e.run=forms.length&&forms.every(l=>l===l.toUpperCase())?expected:
        forms.length&&forms.every(l=>l===l.toLowerCase())?expected.toLowerCase():'';
      e.sequential=expected.length>=2&&expected==='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0,expected.length);
    }
    // Text items can be large; the durable evidence above retains only caption lines.
    for(const p of pages)delete p.captionInput;
  }
  function forItem(evidence,item){
    const labels=item.members||[item.label];
    const values=labels.map(l=>({label:l,...panel(evidence,l)}));
    return {labels,matched:values.some(v=>v.matched),
      targetText:[...new Set(values.filter(v=>v.matched).map(v=>v.targetText))].join('\n\n'),
      sharedLegend:[...new Set(values.map(v=>v.sharedLegend).filter(Boolean))].join('\n\n'),
      recovered:values.filter(v=>v.matched&&!evidence?.expected.includes(upper(v.label))).map(v=>v.label)};
  }
  return {attach,panel,forItem};
})();
