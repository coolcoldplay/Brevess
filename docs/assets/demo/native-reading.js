/* Adapts the exact shipping selection component to a public paper in memory. */
window.BVCreateReadingDemo = ({root,data:d,onChange,onToast,onPaint,onAbbreviation}) => {
 const t=value=>window.BV_I18N?.text(value)||value;
 const example=BVHighlightExamples(SciLLM,d),record={annotations:[]},manualDocument={documentId:d.documentId||'alphafold-example',record};
 const paragraphs=[...root.querySelectorAll('[data-paragraph]')];
 const originals=new Map(paragraphs.map(p=>[p,[...p.childNodes].map(n=>n.cloneNode(true))]));
 const blocks=paragraphs.map(element=>({blockId:element.dataset.paragraph,element}));
 const categories=Object.entries(example.catalog).map(([categoryId,c])=>({...c,categoryId}));
 document.addEventListener('brevess-demo-languagechange',()=>categories.forEach(c=>c.name=example.catalog[c.categoryId].name));
 let annotations=[],visibleSources=['regex','llm','manual'],threshold=.8,selectionUI;
 let activeMode='quick_story',spanMode='word',llmRan=false,regexRan=false;
 let currentEngine='regex',regexIds=new Set(example.views.paper_terms.categoryIds),llmIds=new Set(example.views.quick_story.categoryIds);
 const all=()=>annotations.filter(a=>(a.source!=='llm'||a.confidence>=threshold)&&((a.source==='manual'||a.source==='semantic')||(a.source==='regex'?regexIds:llmIds).has(a.categoryId)));
 const para=id=>d.paragraphs.find(p=>p.id===id);
 const annotationObject=a=>({annotationId:String(a.id),quote:a.segments.map(s=>para(s.p).text.slice(s.start,s.end)).join('\n'),categoryId:a.categoryId,categorySnapshot:example.catalog[a.categoryId],note:a.note||'',sourceType:a.source==='llm'?'manual':a.source,blockId:a.segments[0].p,startOffset:a.segments[0].start,endOffset:a.segments[0].end});
 function publish(){
  record.annotations=annotations.map(annotationObject);
  const items=all().flatMap(a=>a.segments.map(s=>({id:a.id,highlightId:String(a.id),source:a.source,p:s.p,paragraphId:s.p,sectionId:s.p,sourceStart:s.start,sourceEnd:s.end,quote:para(s.p).text.slice(s.start,s.end),text:para(s.p).text.slice(s.start,s.end),note:a.note||'',categoryId:a.categoryId,categoryName:example.catalog[a.categoryId]?.name,color:example.catalog[a.categoryId]?.color})));
  const groups=llmRan?example.llm.map(a=>({paragraphId:a.segments[0].p,start:a.segments[0].start,end:a.segments[0].end,sentenceKeys:[a.id],categories:[{categoryId:a.categoryId,confidence:a.confidence}]})):[];
  onChange({items,groups,llmRan,regexRan,activeMode,threshold});
 }
 function paint(){
  selectionUI?.highlighter.hideTooltip();
  for(const p of paragraphs){
   const text=para(p.dataset.paragraph).text;
   const marks=all().filter(a=>visibleSources.includes(a.source==='semantic'?'manual':a.source)).flatMap(a=>a.segments.filter(s=>s.p===p.dataset.paragraph).map(s=>({...s,a})));
   p.replaceChildren(...originals.get(p).map(n=>n.cloneNode(true)));
   const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT),runs=[];let cursor=0,leaf;
   while(leaf=walker.nextNode()){runs.push({leaf,start:cursor,end:cursor+leaf.length});cursor+=leaf.length;}
   for(const run of runs){
   const edges=[...new Set([run.start,run.end,...marks.flatMap(s=>[s.start,s.end]).filter(n=>n>run.start&&n<run.end)])].sort((a,b)=>a-b),frag=document.createDocumentFragment();
   for(let i=0;i<edges.length-1;i++){
    const start=edges[i],end=edges[i+1],cover=marks.filter(s=>s.start<=start&&s.end>=end).sort((x,y)=>(x.a.source==='manual')-(y.a.source==='manual'));
    let node=document.createTextNode(text.slice(start,end));
    // Preserve overlapping sources rather than replacing one with another.
    for(const {a} of cover){
     const c=example.catalog[a.categoryId];let mark;
     if(a.source==='regex')mark=selectionUI.highlighter.createHighlightSpan({...a.match,matchedText:a.text},spanMode);
     else{
      mark=document.createElement('mark');mark.className=a.source==='llm'?'sci-llm-highlight sci-llm-mode-inline-highlight':'sci-manual-highlight';
      mark.dataset.source=a.source;mark.dataset.categoryId=a.categoryId;mark.dataset.categoryName=c.name;mark.dataset.annotationId=String(a.id);mark.dataset.categoryColor=c.color;
      if(a.source==='llm')mark.style.borderBottomColor=c.color;else mark.style.setProperty('--sci-manual-color',selectionUI.pastel(c.color));
      mark.tabIndex=0;mark.setAttribute('role','button');mark.setAttribute('aria-label',c.name+'高亮：'+a.text);
      mark.title=[c.name,a.source==='llm'?'预置语义识别示例':'手动标注',a.note].filter(Boolean).join('\n');
      const open=e=>{if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;e.preventDefault();e.stopPropagation();openAnnotation(a.id,mark);};
      mark.addEventListener('click',open);mark.addEventListener('keydown',open);
      mark.addEventListener('mouseenter',()=>selectionUI.highlighter.showTooltip(mark,{name:c.name,color:c.color,matchedKeyword:a.source==='llm'?'语义匹配 · 预置示例':''}));
      mark.addEventListener('mouseleave',()=>selectionUI.highlighter.hideTooltip());
     }
     mark.dataset.demoAnnotation=String(a.id);mark.append(node);node=mark;
    }
    frag.append(node);
   }
   run.leaf.replaceWith(frag);
   }
  }
  onPaint?.();
 }
 const refresh=()=>{paint();publish();};
 const category=id=>example.catalog[id];
 const saveSurface=async(surface,c,note)=>{
  const descriptor=surface.descriptor;let a=annotations.find(a=>String(a.id)===String(descriptor.demoId));
  if(!a){a={id:crypto.randomUUID(),source:'manual',segments:descriptor.demoSegments.map(s=>({...s})),text:descriptor.text};annotations.push(a);descriptor.demoId=a.id;}
  a.categoryId=c.categoryId;a.note=note;surface.annotations=[annotationObject(a)];refresh();
 };
 const sentences=d.paragraphs.filter(p=>p.zh).flatMap(p=>{
  const en=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(p.text)].map(x=>x.segment.trim());
  const zh=[...new Intl.Segmenter('zh',{granularity:'sentence'}).segment(p.zh)].map(x=>x.segment.trim());
  return en.length===zh.length?en.map((text,i)=>[text,zh[i]]):[[p.text,p.zh]];
 });
 const dictionary={'msa':'多序列比对','msas':'多序列比对','alphafold':'AlphaFold','protein':'蛋白质','proteins':'蛋白质','atomic accuracy':'原子级精度'};
 window.__brevessBilingualTranslation={async translateSelection(text,{signal}){
  await new Promise(r=>setTimeout(r,180));if(signal.aborted)throw Object.assign(Error('已取消'),{code:'ABORTED'});
  const normalized=text.trim(),exact=sentences.find(([en])=>en===normalized)||d.paragraphs.map(p=>[p.text,p.zh]).find(([en,zh])=>en===normalized&&zh);
  return exact?exact[1]+'\n\n'+t('预置译文示例'):dictionary[normalized.toLowerCase()]||'所选片段暂无预置译文。可点击“试试划句”体验完整句子的翻译；安装插件后由浏览器翻译实际选区。';
 }};
 const sci={...SciLLM,getInterfaceLanguage:()=>document.documentElement.lang||'zh-CN',createSelectionTtsController({onState}){
  let status='idle',speech;const state=()=>({status});
  const stop=()=>{speechSynthesis.cancel();status='idle';onState(state());};
  return{getState:state,stop,destroy:()=>{if(status==='playing')stop();},async speak({text,automatic}){if(automatic)return;speech=new SpeechSynthesisUtterance(text);speech.lang='en-US';speech.onend=stop;speech.onerror=()=>{status='error';onState({...state(),errorMessage:'浏览器朗读不可用'});};status='playing';onState({...state(),noticeMessage:'浏览器示例朗读'});speechSynthesis.speak(speech);}};
 }};
 const sendManualMessage=async m=>{
  if(m.type==='LLM_ASK_SELECTION'){
   const a=example.llm.find(a=>a.text.includes(m.selectedText)||m.selectedText.includes(a.text));
   return{operationId:m.operationId,message:{status:'completed',answerBlocks:[{markdown:t(a?a.note:d.selectionExplanation||'作者把蛋白质结构预测的性能、方法和适用边界分开验证。请结合上下文和原图核对。')+'\n\n'+t('预置 AI 解读示例；未调用在线模型。')}]}};
  }
  if(m.type==='ANNOTATION_DELETE'){annotations=annotations.filter(a=>String(a.id)!==m.annotationId);publish();return{record};}
  throw Error('此操作请在安装后的插件中使用');
 };
 selectionUI=BVCreateSelectionUI({SciLLM:sci,source:d.source,chrome:{runtime:{sendMessage:async()=>({success:true})}},currentManualDocument:manualDocument,currentManualBlocks:blocks,currentManualCategories:categories,currentManualAnalysisModes:Object.entries(example.views).map(([id,v])=>({id,...v})),
  actions:[{id:'explain',name:'解释选中内容',enabled:true,prompt:'解释所选内容中的关键概念与证据边界。'}],saveSelectionSurfaceAnnotations:saveSurface,sendManualMessage,
  appendManualFixedPhrase:async(id,type,descriptor)=>{const c=category(id),list=type==='include'?'phrases':'excludePhrases';c.regex[list]||=[];if(!c.regex[list].includes(descriptor.text))c.regex[list].push(descriptor.text);onToast(type==='include'?'已加入本页示例白名单':'已加入本页示例黑名单');if(regexRan)runRegex();},
  addCurrentArticleAbbreviation:async entry=>{onAbbreviation?.(entry);onToast('已加入本页缩略词表：'+entry.abbreviation+' — '+entry.fullName);},showManualStatus:onToast,
  restoreManualAnnotations:refresh,updateCurrentManualRecord:()=>{},
  ensureAutomaticHighlightAnnotation:async mark=>mark,showHighlightContextPopover:mark=>openAnnotation(mark.dataset.demoAnnotation,mark)
 });
 // A popup lives at this document's root, outside the paper. Dismiss on
 // outside presses here, in the surrounding website, or inside native frames.
 const outside=event=>{
  const toolbar=document.getElementById('sci-manual-toolbar');
  if(toolbar&&!event.composedPath().includes(toolbar)&&!event.target.closest?.('[data-demo-annotation]'))selectionUI.close();
 };
 const dismissFromFrame=event=>{
  if(event.source!==window&&event.origin===location.origin&&event.data?.source==='brevess-native-demo'&&event.data.type==='pointerdown')selectionUI.close();
 };
 const contexts=[];let context=window;
 while(context){
  try{context.document.addEventListener('pointerdown',outside,true);context.addEventListener('message',dismissFromFrame);contexts.push(context);if(context===context.parent)break;context=context.parent;}catch{break;}
 }
 addEventListener('pagehide',()=>{for(const view of contexts){view.document.removeEventListener('pointerdown',outside,true);view.removeEventListener('message',dismissFromFrame);}}, {once:true});
 function open(segments,rect,existing){
  const text=segments.map(s=>para(s.p).text.slice(s.start,s.end)).join('\n');
  selectionUI.open({documentId:manualDocument.documentId,blockId:segments[0].p,text,rect,validation:{valid:true},demoSegments:segments,demoId:existing?.id,manualAnalysisModeId:activeMode,anchor:{quote:para(segments[0].p).text.slice(segments[0].start,segments[0].end),startOffset:segments[0].start,endOffset:segments[0].end},anchorSegments:segments.map(s=>({blockId:s.p,anchor:{quote:para(s.p).text.slice(s.start,s.end),startOffset:s.start,endOffset:s.end}})),...(existing?{existingAnnotation:annotationObject(existing),openNote:true}:{})});
 }
 function openAnnotation(id,mark){const a=annotations.find(a=>String(a.id)===String(id));if(!a)return;open(a.segments,mark.getBoundingClientRect(),a);}
 function runRegex(){
  regexRan=true;const h=selectionUI.highlighter;h.matchCounts={};annotations=annotations.filter(a=>a.source!=='regex');
  const rules=[];
  for(const id of regexIds){const c=category(id);if(!c)continue;const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),r=c.regex,flags=r.caseSensitive?'g':'gi',exclusions=r.excludePhrases.map(s=>new RegExp(esc(s),flags));
   for(const pattern of [...r.phrases.map(s=>r.wholeWord?'\\b'+esc(s)+'\\b':esc(s)),...r.expressions])rules.push({regex:new RegExp(pattern,flags),category:id,name:c.name,color:c.color,originalPattern:pattern,excludeRegexes:exclusions});
  }
  for(const p of d.paragraphs)for(const match of h.findMatches(p.text,rules,spanMode))annotations.push({id:'regex-'+p.id+'-'+match.category+'-'+match.start,source:'regex',categoryId:match.category,segments:[{p:p.id,start:match.start,end:match.end}],text:match.matchedText,note:'',match});
  refresh();return annotations.filter(a=>a.source==='regex').length;
 }
 function runLlm(){llmRan=true;annotations=annotations.filter(a=>a.source!=='llm').concat(structuredClone(example.llm));refresh();return all().filter(a=>a.source==='llm').length;}
 return{open,openAnnotation,close:()=>selectionUI.close(),sync:publish,example,runRegex,runLlm,
  setVisibility(sources){visibleSources=sources;paint();},
  configure({viewId,ids,confidence,mode,engine}={}){if(engine)currentEngine=engine;if(viewId){activeMode=viewId;selectionUI.setMode(viewId);}if(ids){if(currentEngine==='regex')regexIds=new Set(ids);else llmIds=new Set(ids);}if(confidence!==undefined)threshold=confidence;if(mode)spanMode=mode;refresh();},
  find(id){return annotations.find(a=>String(a.id)===String(id));},
  clear(source){selectionUI.close();annotations=annotations.filter(a=>source==='automatic'?a.source==='manual':a.source!=='manual');if(source==='automatic'){llmRan=false;regexRan=false;}refresh();},
  reset(){selectionUI.reset();annotations=[];visibleSources=['regex','llm','manual'];threshold=.8;spanMode='word';activeMode='quick_story';currentEngine='regex';regexIds=new Set(example.views.paper_terms.categoryIds);llmIds=new Set(example.views.quick_story.categoryIds);llmRan=regexRan=false;refresh();}
 };
};
