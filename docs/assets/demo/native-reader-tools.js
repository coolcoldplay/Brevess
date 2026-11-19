/* Production search controller and translation renderer with public data adapters. */
window.BVCreateReaderTools=({root,data:d,reading,onToast,onView})=>{
 const t=value=>window.BV_I18N?.text(value)||value;
 const examples=d.readerExamples||BV_READER_EXAMPLES,paper=root.querySelector('.bv-paper'),translationUI=BVCreateTranslationUI();
 const translated=new Map();let epoch=0,searchHits=[],hovered=null,altSource=null;
 const names=Array.from({length:101},(_,i)=>'sci-semantic-search-'+i),currentName='sci-semantic-search-current';
 const style=document.createElement('style');style.textContent=names.map((name,i)=>`::highlight(${name}){background-color:rgba(255,187,35,${SciLLM.semanticFindScoreAlpha(i/100)});color:inherit;}`).join('\n')+`::highlight(${currentName}){text-decoration:underline;text-decoration-color:#915600;text-decoration-thickness:2px;}`;document.head.append(style);
 function rangeFor(hit){
  const element=paper.querySelector('[data-paragraph="'+hit.paragraphId+'"]');if(!element)return null;
  const walk=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),range=document.createRange();let node,offset=0,started=false;
  while(node=walk.nextNode()){const end=offset+node.length;if(!started&&hit.start<end){range.setStart(node,Math.max(0,hit.start-offset));started=true;}if(started&&hit.end<=end){range.setEnd(node,hit.end-offset);return range;}offset=end;}return null;
 }
 const clear=()=>{searchHits=[];for(const name of [...names,currentName])CSS.highlights?.delete(name);};
 const controller=SciLLM.createSemanticFindController({document,window,
  openSettings:()=>onToast('官网使用预置匹配分数；安装插件后可配置语义检索模型。'),
  adapter:{
   buildCorpus:async()=>{const paragraphs=d.paragraphs.map(p=>({paragraphId:p.id,text:p.text,sectionTitle:p.heading}));return {identity:{kind:'html'},sourceKey:(d.documentId||'public-alphafold')+'-'+epoch,epoch,paragraphs,sentences:SciLLM.createSemanticFindSentences(paragraphs),coverage:'full',coverageMessage:'范围为本页展示的 '+d.paragraphs.length+' 段内容。',sourceNotice:'预置语义检索示例；分数由演示预设，未调用在线模型。'};},
   isCurrent:corpus=>corpus.epoch===epoch,
   isHitCurrent:(corpus,hit)=>d.paragraphs.find(p=>p.id===hit.paragraphId)?.text.slice(hit.start,hit.end)===hit.text,
   paint(corpus,hits,id){clear();searchHits=hits;for(const hit of hits){const range=rangeFor(hit);if(!range)continue;const name=names[Math.round(hit.score*100)];let group=CSS.highlights.get(name);if(!group){group=new Highlight();CSS.highlights.set(name,group);}group.add(range);if(hit.id===id)CSS.highlights.set(currentName,new Highlight(range));}},
   focus:async(corpus,hit)=>{onView('paper');const range=rangeFor(hit);if(!range)return;const rect=range.getBoundingClientRect();paper.scrollTo({top:paper.scrollTop+rect.top-paper.getBoundingClientRect().top-60,behavior:'instant'});},
   clear,
   confirm:async(corpus,hit,rect)=>{reading.open([{p:hit.paragraphId,start:hit.start,end:hit.end}],rect);return true;}
  },
  sendMessage:async message=>{
   if(message.type==='LLM_SEMANTIC_FIND_CANCEL')return {success:true};
   const example=examples.semanticQueries.find(q=>q.query===message.query||t(q.query)===message.query||q.aliases.test(message.query));
   if(!example)return {success:false,error:{message:(document.documentElement.lang==='en'?'Try: ':'可尝试：')+examples.semanticQueries.map(q=>t(q.query)).join('; ')+(document.documentElement.lang==='en'?'. Install BREVESS to search any meaning.':'。安装插件后可自由描述任意语义。')}};
   const sentences=SciLLM.createSemanticFindSentences(message.paragraphs);
   return {success:true,data:{operationId:message.operationId,sourceKey:message.sourceKey,scores:sentences.map(s=>({id:s.id,score:example.score(s)})),processed:sentences.length,total:sentences.length,skipped:0,done:true}};
  }
 });
 paper.addEventListener('click',event=>{if(!controller.isOpen()||!getSelection()?.isCollapsed||event.target.closest('button,a'))return;for(const hit of searchHits){const range=rangeFor(hit);if(range&&[...range.getClientRects()].some(r=>event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom)){void controller.confirm(hit.id,range.getBoundingClientRect());break;}}});
 const translationEntries=()=>[[paper.querySelector('h1'),d.web?'':examples.title],...d.paragraphs.flatMap(p=>[[paper.querySelector('#bv-'+p.id),examples.headings[p.id]],[paper.querySelector('[data-paragraph="'+p.id+'"]'),p.zh]]),...d.figures.map(f=>[paper.querySelector('#bv-figure-'+f.id+' figcaption'),'图 '+f.id+'：'+examples.figures[f.id-1]])];
 function paintTranslation(element,text){let record=translated.get(element);if(!record){record={element,anchor:element,text:element.textContent,epoch:0};translated.set(element,record);}translationUI.paint(record,text);return record;}
 function translate(enabled=true){
  reading.close();onView('paper');
  if(!enabled){onToast('已停止整页翻译；保留已有译文。');return;}
  for(const [element,text] of translationEntries())if(element&&text&&text!==element.textContent)paintTranslation(element,text);
  onToast('已显示预置双语译文，英文原文与高亮保留。');
 }
 paper.addEventListener('pointerover',event=>{hovered=event.target.closest('h1,h2,[data-paragraph],figcaption');});
 paper.addEventListener('pointerleave',()=>{hovered=altSource=null;});
 const editing=event=>event.target.closest?.('input,textarea,select,button,a,[contenteditable],dialog')||document.activeElement?.closest('input,textarea,select,button,a,[contenteditable],dialog');
 addEventListener('keydown',event=>{if(event.key!=='Alt'){altSource=null;return;}if(!event.repeat)altSource=window.__bvPageTools.preferences.pageTranslation&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!editing(event)?hovered:null;});
 addEventListener('keyup',event=>{if(event.key!=='Alt')return;const source=altSource;altSource=null;if(!source||source!==hovered||editing(event)||event.ctrlKey||event.metaKey||event.shiftKey||!window.__bvPageTools.preferences.pageTranslation)return;const entry=translationEntries().find(([el])=>el===source);if(!entry?.[1])return;event.preventDefault();const record=translated.get(source);if(record?.translation?.isConnected)record.translation.hidden=!record.translation.hidden;else paintTranslation(...entry);});
 function openSearch(){reading.close();onView('paper');controller.open();const query=document.querySelector('[data-semantic-find-role="query"]');if(!query.value)query.value=t(examples.semanticQueries[0].query);onToast((document.documentElement.lang==='en'?'Try: ':'试试：')+examples.semanticQueries.map(q=>t(q.query)).join(' · '));}
 function keydown(event){if(controller.handleKeydown(event))return true;if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,textarea,select,[contenteditable],dialog'))return false;const bounds=root.getBoundingClientRect();if(event.key.toLowerCase()==='j'&&bounds.bottom>0&&bounds.top<innerHeight&&window.__bvPageTools.preferences.semantic){event.preventDefault();openSearch();return true;}return false;}
 return {openSearch,translate,keydown,refresh:()=>controller.refreshSourceHits(),isSearchOpen:controller.isOpen,
  reset(){epoch++;controller.close();hovered=altSource=null;for(const r of translated.values())r.translation?.remove();translated.clear();},
  closeSearch:controller.close};
};
