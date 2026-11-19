(function(g){'use strict';
function create({document:doc,loadAbstract,cancelAbstract=()=>{},onChange=()=>{}}){
 const M=g.WFGReadingModules,P=g.WFGReadingPubmed,win=doc.defaultView;
 const own='[data-wfg-owned],[data-wfg-reading-owned]',interactive='input,textarea,select,[contenteditable]:not([contenteditable="false"]),canvas,[role="application"]',media='img,svg,math,video,audio,iframe,table';
 const abstractStyles=new Map();
 let previewAbstracts=false;
 let originalView=false,originalViewState=null,outlineDefault=false;
 let session=crypto.randomUUID(),href=doc.location.href,version=0,epoch=0,config=null,root=null,extract=null,modules=[],notices=[],groups=[],currentId=null,styles=new Map(),aux=new Map(),ids=new WeakMap(),serial=0,outlineNodes=new Map(),timer=null,scrollTimer=null,preview=false,pending=false,destroyed=false;
 const id=n=>{if(!ids.has(n))ids.set(n,'n'+(++serial));return ids.get(n);};
 function selector(n){if(n.id&&doc.querySelectorAll('#'+win.CSS.escape(n.id)).length===1)return '#'+win.CSS.escape(n.id);const parts=[];for(let p=n;p&&p.nodeType===1;p=p.parentElement){let s=p.localName;const siblings=[...(p.parentElement?.children||[])].filter(e=>e.localName===p.localName);if(siblings.length>1)s+=':nth-of-type('+(siblings.indexOf(p)+1)+')';parts.unshift(s);}return parts.join(' > ');}
 const target=n=>({frame:'top',roots:[],selector:selector(n)});
 const clean=n=>(n?.textContent||'').replace(/\s+/g,' ').trim();
 function visible(n){for(let p=n;p&&p.nodeType===1;p=p.parentElement){const s=win.getComputedStyle(p);if(p.hidden||s.display==='none'||s.visibility==='hidden'||p.getAttribute('aria-hidden')==='true')return false;}return true;}
 function query(scope,s){return [...scope.querySelectorAll(s)].filter(n=>!n.closest(own));}
 function note(code,message){if(!notices.some(n=>n.code===code))notices.push({code,message});}
 function write(n,k,v,ledger=styles){let props=ledger.get(n);if(!props){props=new Map();ledger.set(n,props);}if(!props.has(k))props.set(k,{before:n.style.getPropertyValue(k),priority:n.style.getPropertyPriority(k)});n.style.setProperty(k,v,'important');Object.assign(props.get(k),{written:n.style.getPropertyValue(k),writtenPriority:n.style.getPropertyPriority(k)});}
 function undoStyles(ledger=styles){let conflicts=0;for(const [n,props]of ledger)for(const [k,r]of props){if(n.style.getPropertyValue(k)===r.written&&n.style.getPropertyPriority(k)===r.writtenPriority){if(r.before)n.style.setProperty(k,r.before,r.priority);else n.style.removeProperty(k);}else conflicts++;}ledger.clear();return conflicts;}
 function clearAux(){epoch++;undoStyles(abstractStyles);cancelAbstract(session);for(const r of aux.values())if(r.owned)r.node?.remove();aux.clear();}
 function restore(){previewAbstracts=false;clearAux();const conflicts=undoStyles();groups=[];outlineNodes.clear();root=null;extract=null;modules=[];currentId=null;if(conflicts)note('PAGE_STYLE_CHANGED','网页自行更新了样式，已保留网页的新样式。');}
 function choose(entries){
  const matching=entries.filter(e=>e.enabled&&M.matches(e.module,href)).map(e=>M.validate(e.module));const candidates=matching.filter(m=>m.rules.kind==='extract').sort((a,b)=>b.priority-a.priority||Number(b.match.pathMode==='exact')-Number(a.match.pathMode==='exact')||Math.max(0,...b.match.pathPrefixes.map(p=>p.length))-Math.max(0,...a.match.pathPrefixes.map(p=>p.length))||a.id.localeCompare(b.id));
  for(const m of candidates){if(m.rules.required.some(s=>!query(doc,s).length))continue;let found=null;for(const s of m.rules.roots){const ns=query(doc,s).filter(visible);if(ns.length===1){found=ns[0];break;}if(ns.length>1)throw Error('CONTENT_ROOT_AMBIGUOUS');}if(!found)continue;
   if(found===doc.body||found===doc.documentElement||found.matches(interactive))throw Error('INTERACTIVE_PAGE');
   if(['article','document'].includes(m.rules.pageType)&&!(m.rules.operations.length&&m.rules.operations.every(op=>op.type==='outline'&&op.extraction))&&found.querySelector(interactive))throw Error('INTERACTIVE_PAGE');
   if(['article','document'].includes(m.rules.pageType)&&!m.rules.operations.some(op=>op.type==='outline'&&op.extraction)&&clean(found).length<80)throw Error('CONTENT_TOO_SHORT');
   return {root:found,extract:m,modules:[m,...matching.filter(x=>x.rules.kind==='display'&&(x.rules.pageType==='any'||x.rules.pageType===m.rules.pageType)).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))]};
  }if(candidates.some(m=>m.priority===100))throw Error('SAVED_STRUCTURE_UNMATCHED');return null;
 }
 function verifiedClutter(n,content=root){
  if(content&&!content.contains(n)&&!n.contains(content)&&n.matches('header.c-header,body > header,[role="banner"],footer.c-footer,body > footer,[role="contentinfo"],.c-article-sidebar'))return true;
  if(!n.matches('aside,section,div,nav,header,[role="complementary"],[role="navigation"]'))return false;
  // Publisher context bars often put the visible bar in an unlabelled child.
  // Inherit only a short, explicit navigation/clutter marker outside the content root.
  if(content&&!content.contains(n))for(let p=n,depth=0;p&&depth<3&&!p.contains(content);p=p.parentElement,depth++){
   const tokens=(p.id+' '+p.className+' '+(p.getAttribute('data-test')||'')).toLowerCase();
   if(/(?:^|[ _-])(context-bar|sticky-navigation|site-header|social-share)(?:$|[ _-])/.test(tokens))return true;
  }
if(n.matches('[data-sidebar-related-module]'))return true;if(content&&!content.contains(n)&&n.matches('aside.related,aside.recommendations,[role="complementary"].related'))return true;if(n.matches('nav,[role="navigation"]')&&!/pagination|pager/i.test(n.id+' '+n.className+' '+(n.getAttribute('aria-label')||'')))return true;const tokens=(n.id+' '+n.className+' '+(n.getAttribute('data-test')||'')+' '+(n.getAttribute('aria-label')||'')).toLowerCase();return /(?:^|[ _-])(ads?|advertisement|recommendations?|recommended|related-content|related-articles|site-navigation|mw-panel|vector-page-tools)(?:$|[ _-])/.test(tokens);}
 function protectHide(n,content=root){const annotation='mark,[data-highlight-id],[data-sci-highlight-id],.sci-highlight,.sci-manual-highlight';const protectedNodes=interactive+',h1,figure,figcaption,video,audio,math,table,[data-test="figure"],[role="doc-bibliography"],.c-article-references,.ref-list,'+annotation;
  const ad=n.matches('.c-ad,aside.advertisement,[data-ad-slot],.ad-banner');
  return n===content||n.contains(content)||!verifiedClutter(n,content)||n.matches(protectedNodes)||!!n.querySelector(protectedNodes)||(!ad&&!!n.querySelector('iframe'));}
 // Summarize only observed layout regions. No article text or form values are needed.
 // Keep the same paragraphs across a before/after measurement, even when a rule hides their parent.
 function sampleParagraphs(scope=doc) {
  const base=scope===doc?['.c-article-body','[itemprop="articleBody"]','.article-body','.markdown-body','article','main'].map(s=>doc.querySelector(s)).find(Boolean):scope;
  const samples=[];
  for(const p of base?.querySelectorAll('p')||[]){
   if(p.textContent.length<65||p.closest('figure,table,nav,aside,footer,[role="doc-bibliography"]')||!p.getClientRects().length)continue;
   samples.push(p);if(samples.length===5)break;
  }
  return samples;
 }
 function measureParagraphs(samples){
  const widths=samples.map(p=>{
   if(!p.isConnected||!p.getClientRects().length||!visible(p))return 0;
   for(let el=p;el;el=el.parentElement)if(win.getComputedStyle(el).opacity==='0')return 0;
   const css=win.getComputedStyle(p);
   return Math.max(0,Math.round(p.clientWidth-parseFloat(css.paddingLeft||0)-parseFloat(css.paddingRight||0)));
  }).sort((a,b)=>a-b);
  return widths[Math.floor(widths.length/2)]||0;
 }
 function pubmedCapability(){
  const u=new URL(doc.URL);
  if(u.origin!=='https://pubmed.ncbi.nlm.nih.gov'||u.pathname!=='/'||!(u.searchParams.has('term')||u.searchParams.has('page')))return null;
  const cards=query(doc,'article.full-docsum');
  if(!cards.some(card=>pmid(card)))return null;
  return {type:'pubmedAbstracts',count:cards.length,target:{frame:'top',roots:[],selector:'article.full-docsum'}};
 }
 function readingLayout(capabilitiesOnly=false){
  const capability=pubmedCapability();
  const capabilities=capability?[capability]:[];
  if(capabilitiesOnly)return capability?{regions:[],capabilities}:null;
  const contentSelectors=[...(extract?.rules.roots||[]),'.c-article-body','[itemprop="articleBody"]','.article-body','.markdown-body','article','main','[role="main"]'];
  let content,contentSelector;
  for(const s of new Set(contentSelectors)){
   const ns=query(doc,s);
   if(ns.length===1&&!(ns[0].matches('main,[role="main"]')&&ns[0].querySelectorAll('article').length>1)&&visible(ns[0])&&!ns[0].matches(interactive)&&!ns[0].querySelector('[contenteditable]:not([contenteditable="false"]),[role="application"]')&&ns[0].querySelector('p')&&!ns[0].closest('aside,nav,footer')){
    content=ns[0];contentSelector=s;break;
   }
  }
  if(!content)return capability?{regions:[],capabilities}:null;
  const regions=[],seen=new Set();
  function add(role,s,allowed){
   const nodes=query(doc,s);
   if(!nodes.length||nodes.length>80||!nodes.every(allowed)||nodes.every(n=>seen.has(n)))return;
   nodes.forEach(n=>seen.add(n));
   const bounds=nodes[0].getBoundingClientRect();
   regions.push({role,selector:s,count:nodes.length,width:Math.round(bounds.width),visible:visible(nodes[0]),...(role==='figures'?{visibleCount:nodes.filter(visible).length}:{})});
  }
  add('content',contentSelector,n=>n===content);
  for(const s of ['main.c-article-main-column','main[role="main"]','main'])add('column',s,n=>n!==content&&n.contains(content)&&n===content.closest('main'));
  for(const [role,selectors] of [
   ['advertisement',['.c-ad','[data-ad-slot]','aside.advertisement','.ad-banner']],
   ['site-header',['header.c-header','body > header','[role="banner"]']],
   ['sticky-navigation',['#js-enable-context-bar','.c-context-bar--sticky']],
   ['sidebar',['.c-article-sidebar','aside.recommendations','aside.related']],
   ['recommendations',['.c-article-recommendations','[data-test="recommendations"]','.related-articles']],
   ['footer',['body > footer','footer.c-footer','[role="contentinfo"]']]
  ])for(const s of selectors)add(role,s,n=>!n.contains(content)&&!protectHide(n,content));
  for(const [role,suffix] of [['paragraph','p'],['figures','figure'],['captions','figcaption'],['tables','table']]){
   add(role,contentSelector+' '+suffix,n=>content.contains(n));
  }
  return {regions,capabilities,textWidth:measureParagraphs(sampleParagraphs(content))};
 }
 function readingColorChanges(nodes,op){return g.WFGEngine.collectColorChanges(nodes,op,{window:win,exclude:n=>!!n.closest(own)||n.matches('script,style,noscript,meta,link,template,'+interactive)||/password|csrf|token|secret|credential/i.test([n.id,n.getAttribute('name'),n.getAttribute('autocomplete')].filter(Boolean).join(' '))||!visible(n)});}
 function prepare(){const writes=[],outlines=[];for(const m of [...modules].sort((a,b)=>a.priority-b.priority)){const r=m.rules,s=r.styleSelector==='content'?extract.rules.styleSelector:r.styleSelector;let nodes=s==='content'?[root]:query(root,s);if(s!=='content'&&root.matches(s))nodes.unshift(root);
   if(Object.keys(r.styles).length&&!nodes.length)throw Error('STYLE_TARGET_MISSING');for(const n of nodes){if(n.matches(interactive))throw Error('INTERACTIVE_STYLE_TARGET');for(const [k,v]of Object.entries(r.styles)){if(!win.CSS.supports(k,v))throw Error('CSS_UNSUPPORTED');writes.push([n,k,v]);}}
   for(const s of r.hide)for(const n of query(doc,s)){if(protectHide(n)){note('PROTECTED_CONTENT_HIDE','部分隐藏规则涉及正文、媒体或交互内容，该区域保持可见。');continue;}writes.push([n,'display','none']);}
   for(const o of r.outline)outlines.push({...o,moduleId:m.id,scope:root});
   for(const op of r.operations){if(op.type==='pubmedAbstracts'){if(!pubmedCapability())throw Error('PUBMED_RESULTS_REQUIRED');continue;}if(outlineDefault&&op.type==='outline'&&op.extraction)continue;if(!['replaceColor','style','hide','outline'].includes(op.type)||op.target.roots.length)throw Error('AUTOMATIC_OPERATION_UNSUPPORTED');const nodes=query(doc,op.target.selector);if(!nodes.length)throw Error('RULE_TARGET_MISSING');if(op.type==='replaceColor'){readingColorChanges(nodes,op);writes.push({colorOperation:op,nodes});continue;}if(op.type==='outline'){if(nodes.some(n=>!root.contains(n)&&n!==root))throw Error('OUTLINE_OUTSIDE_CONTENT');if(op.extraction)g.WFGEngine.collectOutlineEntries(nodes,op,{window:win,exclude:n=>!!n.closest(own)||n.matches(interactive),read:(n,max)=>g.WFGEngine.outlineSourceText(n,win,max)});outlines.push({selector:op.target.selector,label:op.label,moduleId:m.id,scope:doc,...(op.extraction?{extraction:op.extraction}:{})});continue;}
    for(const n of nodes){if(op.type==='hide'){if(protectHide(n))throw Error('PROTECTED_CONTENT_HIDE');writes.push([n,'display','none']);}else{const column=n===root.closest('main')&&Object.keys(op.styles).every(k=>['width','min-width','max-width','margin-left','margin-right','box-sizing','flex-basis'].includes(k));if((!root.contains(n)&&!column)||n.matches(interactive))throw Error('STYLE_OUTSIDE_CONTENT');for(const [k,v]of Object.entries(op.styles)){if(!win.CSS.supports(k,v))throw Error('CSS_UNSUPPORTED');writes.push([n,k,v]);}}}
   }
  }return {writes,outlines};
 }
 function inClutter(n){for(let p=n;p&&p!==root;p=p.parentElement)if(verifiedClutter(p))return true;return false;}
 function outline(specs){groups=[];outlineNodes.clear();for(const [operation,o]of specs.entries()){const nodes=query(o.scope,o.selector).filter(n=>visible(n)&&!inClutter(n)),items=[];if(o.extraction){const rows=g.WFGEngine.collectOutlineEntries(nodes,{extraction:o.extraction},{window:win,exclude:n=>!!n.closest(own)||n.matches(interactive),read:(n,max)=>g.WFGEngine.outlineSourceText(n,win,max)});for(const row of rows){const n=row.node,quote=row.quote,key='reading:'+o.moduleId+':'+id(n)+':'+(row.fieldKey||'item');items.push({id:key,title:row.title,fullText:row.fullText,textTruncated:row.textTruncated,quote,level:row.level,target:target(n),...g.WFGEngine.searchOutlineMetadata(n,win),fieldKey:row.fieldKey||'item'});outlineNodes.set(key,{node:n,quote,extraction:true});}if(items.length)groups.push({operation,label:o.label,items,extraction:true});continue;}for(const n of nodes.slice(0,500)){const quote=clean(n).slice(0,500);if(!quote)continue;const key='reading:'+o.moduleId+':'+id(n);items.push({id:key,title:quote.slice(0,180),quote,level:/^H[1-6]$/.test(n.tagName)?Number(n.tagName[1]):1,target:target(n),...g.WFGEngine.searchOutlineMetadata(n,win)});outlineNodes.set(key,{node:n,quote});}if(items.length)groups.push({operation,label:o.label,items});if(nodes.length>500)note('OUTLINE_LIMIT','当前大纲仅显示前 500 项。');}if(!groups.length&&specs.length&&extract.rules.pageType==='article'){const titles=query(root.closest('main')||doc,'h1').filter(n=>visible(n)&&!inClutter(n));if(titles.length===1){const n=titles[0],quote=clean(n).slice(0,500),key='reading:'+extract.id+':'+id(n);if(quote){groups.push({operation:0,label:'文章大纲',items:[{id:key,title:quote.slice(0,180),quote,level:1,target:target(n)}]});outlineNodes.set(key,{node:n,quote});}}}updateCurrent(false);}
 function updateCurrent(notify=true){let next=null;const atEnd=win.scrollY>0&&win.scrollY+win.innerHeight>=doc.documentElement.scrollHeight-4;for(const group of groups)for(const item of group.items){const n=outlineNodes.get(item.id)?.node;if(n?.isConnected){const rect=n.getBoundingClientRect();if(!next||rect.top<=120||atEnd&&rect.top<win.innerHeight)next=item.id;}}if(next!==currentId){currentId=next;if(notify)onChange();}}
 function pmid(card){const link=card.querySelector('a.docsum-title');if(!link)return null;let u;try{u=new URL(link.getAttribute('href'),href);}catch{return null;}const id=u.origin==='https://pubmed.ncbi.nlm.nih.gov'?/^\/([1-9]\d{0,8})\/$/.exec(u.pathname)?.[1]:null;if(!id||link.dataset.articleId&&link.dataset.articleId!==id)return null;const displayed=clean(card.querySelector('.docsum-pmid'));return displayed&&displayed!==id?null:id;}
 async function hash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 function abstractFailure(code){if(code==='ABSTRACT_HTTP_429')return 'NCBI 请求限流';if(/^ABSTRACT_HTTP_5/.test(code))return 'NCBI 服务暂时不可用';if(/^ABSTRACT_HTTP_/.test(code))return 'NCBI 拒绝请求（'+code.slice(14)+'）';return ({ABSTRACT_TIMEOUT:'请求超时',ABSTRACT_NETWORK:'网络连接失败',ABSTRACT_PMID_MISMATCH:'返回记录的 PMID 不匹配',ABSTRACT_NOT_PUBMED_XML:'返回内容不是有效的 PubMed 记录',ABSTRACT_ARTICLE_MISSING:'返回记录缺少文章信息',ABSTRACT_TOO_LARGE:'返回内容超过读取上限',ABSTRACT_PAYLOAD_INVALID:'返回内容未通过校验',READING_PAGE_CHANGED:'页面已变化'})[code]||'来源读取或校验失败';}
 function showAbstract(record){
  const writeAbstract=(n,k,v)=>write(n,k,v,abstractStyles);
  if(!record.owned){for(let n=record.node;n&&n!==record.card;n=n.parentElement){writeAbstract(n,'display','block');writeAbstract(n,'visibility','visible');writeAbstract(n,'max-height','none');writeAbstract(n,'height','auto');writeAbstract(n,'overflow','visible');}return;}
  if(!record.data||record.data.status!=='available')return;
  for(const item of record.originals)if(item.node.isConnected)writeAbstract(item.node,'display',record.expanded?'none':item.display);
  record.body.hidden=!record.expanded;record.button.setAttribute('aria-expanded',String(record.expanded));const glyph=record.expanded?'⌃':'⌄';if(record.button.textContent!==glyph)record.button.textContent=glyph;record.button.setAttribute('aria-label',record.expanded?'收起摘要':'展开摘要');record.button.title=record.expanded?'收起摘要':'展开摘要';
 }
 function automaticAbstracts(){return !originalView && modules.some(m=>m.rules.abstracts||m.rules.operations.some(op=>op.type==='pubmedAbstracts'));}
 async function abstracts(scope=root,force=false){if(!scope||!force&&!previewAbstracts&&!automaticAbstracts())return;const expected=epoch,seen=new Set(),cards=query(scope,'article.full-docsum');if(cards.length>500)note('RESULT_LIMIT','只展开当前页前 500 条已加载结果，不读取下一页。');
  for(const [key,r]of aux)if(!cards.includes(r.card)||pmid(r.card)!==key){if(r.owned)r.node?.remove();aux.delete(key);}
  await Promise.all(cards.slice(0,500).map(async card=>{const p=pmid(card);if(!p){note('PMID_UNVERIFIED','部分结果无法确认 PMID，保留原显示。');return;}if(seen.has(p)){note('DUPLICATE_PMID','当前页存在重复 PMID，仅在第一条结果展开摘要。');return;}seen.add(p);let record=aux.get(p);if(record&&record.card===card&&record.node?.isConnected){
    if(force&&record.error){if(record.owned)record.node.remove();aux.delete(p);}
    else{if(force)record.expanded=true;if(record.pending)await record.ready;if(record.data&&record.node.isConnected)showAbstract(record);return;}
   }if(record?.owned)record.node?.remove();aux.delete(p);
   const existing=query(card,'.abstract-content').find(n=>clean(n)&&!/(?:\.\.\.|…)\s*$/.test(clean(n))),snippet=card.querySelector('.docsum-snippet'),slot=snippet||card.querySelector('.docsum-content');
   if(!existing&&!slot){note('ABSTRACT_LOCATION_UNAVAILABLE','部分结果没有可确认的原摘要位置，保留原显示。');return;}
   const node=existing||doc.createElement('span');if(!existing){node.setAttribute('data-wfg-reading-owned','abstract');node.setAttribute('data-wfg-owned','reading-abstract');node.style.cssText='display:inline;font:inherit;color:inherit';slot.append(node);}
   record={card,node,owned:!existing,pmid:p,pending:true,body:null,expanded:true,originals:existing||!snippet?[]:[...snippet.children].filter(n=>n!==node).map(n=>({node:n,display:n.style.getPropertyValue('display')}))};aux.set(p,record);
   let settled;record.ready=new Promise(resolve=>{settled=resolve;});
   const valid=()=>!destroyed&&epoch===expected&&href===doc.location.href&&card.isConnected&&node.isConnected&&pmid(card)===p&&aux.get(p)===record;
   try{let data;if(existing){const text=clean(existing);data={pmid:p,status:'available',complete:true,text,sections:[{label:'',text}],sourceUrl:'https://pubmed.ncbi.nlm.nih.gov/'+p+'/'};}else data=P.parse(await loadAbstract(p,session),p,win.DOMParser);if(!valid())return;
    if(record.owned&&data.status==='available'){const body=doc.createElement('span');body.dataset.wfgAbstractBody='';body.style.whiteSpace='pre-wrap';for(const [index,section]of data.sections.entries()){if(index)body.append(doc.createTextNode('\n'));if(section.label){const label=doc.createElement('strong');label.textContent=section.label+' ';body.append(label);}body.append(doc.createTextNode(section.text));}const button=doc.createElement('button');button.type='button';button.style.cssText='display:inline;padding:0 4px;margin:0 0 0 4px;border:0;background:none;color:inherit;font:inherit;line-height:1;cursor:pointer';button.addEventListener('click',()=>{if(!valid())return;record.expanded=!record.expanded;showAbstract(record);});node.append(body,button);record.body=body;record.button=button;}
    else {record.body=existing||node;if(!existing&&data.status==='unavailable')node.textContent='PubMed 未收录摘要';}
    const sourceHash=await hash(data.text);if(!valid())return;Object.assign(record,{data,sourceHash,pending:false,rendered:record.body.textContent});if(record.owned){node.dataset.wfgPmid=p;node.dataset.wfgComplete='true';}showAbstract(record);onChange();
   }catch(e){if(valid()){record.pending=false;record.error=e.message;note('ABSTRACT_UNAVAILABLE','部分完整摘要读取失败，可重新加载本页重试。');onChange();}}finally{settled();}
  }));
 }
 async function previewFullAbstracts(){
  if(!pubmedCapability())throw Error('PUBMED_RESULTS_REQUIRED');
  const expected=epoch;previewAbstracts=true;
  await abstracts(doc,true);
  if(expected!==epoch||!previewAbstracts||href!==doc.location.href)throw Error('DOCUMENT_CHANGED');
  return abstractReceipt();
 }
 function abstractReceipt(){
  if(!pubmedCapability())throw Error('PUBMED_RESULTS_REQUIRED');
  const cards=query(doc,'article.full-docsum'),receipt={total:cards.length,shown:0,unavailable:0,failed:0};
  for(const card of cards){
   const record=aux.get(pmid(card));
   if(record?.card===card&&record.data?.status==='unavailable')receipt.unavailable++;
   else if(record?.card===card&&record.data?.status==='available'&&record.body.isConnected&&visible(record.body)&&record.body.textContent===record.rendered)receipt.shown++;
   else receipt.failed++;
  }
  return receipt;
 }
 function endAbstractPreview(){
  if(!previewAbstracts)return;
  previewAbstracts=false;
  clearAux();
  if(automaticAbstracts())void abstracts();
 }
 function run(){if(destroyed)return;if(preview){pending=true;if(previewAbstracts)void abstracts(doc);return;}if(!config||originalView)return;notices=[];const conflicts=undoStyles();if(conflicts){restore();note('PAGE_STYLE_CHANGED','页面布局已自行变化，保留原页面；请重新加载后再启用阅读偏好。');onChange();return;}
  try{const choice=choose(config.entries);if(!choice){restore();note('ORIGINAL_VIEW','未找到已启用且适合当前页面的阅读模块，保留原显示。');version++;onChange();return;}({root,extract,modules}=choice);const p=prepare();const paragraphs=p.writes.length?sampleParagraphs(root):[],before=measureParagraphs(paragraphs);for(const item of p.writes){if(Array.isArray(item))write(...item);else for(const entry of readingColorChanges(item.nodes,item.colorOperation).writes)write(...entry);}if(before&&!measureParagraphs(paragraphs))throw Error('READING_BODY_HIDDEN');outline(p.outlines);version++;onChange();void abstracts();}
  catch(e){restore();note(e.message,({'READING_BODY_HIDDEN':'滤镜遮住了正文，已恢复原页。','SAVED_STRUCTURE_UNMATCHED':'已保存的阅读规则未匹配当前结构，保留原显示','CONTENT_ROOT_AMBIGUOUS':'正文区域不唯一','INTERACTIVE_PAGE':'页面含编辑器、表单或工具画布','CONTENT_TOO_SHORT':'正文内容不足以可靠识别','PROTECTED_CONTENT_HIDE':'规则会隐藏正文、媒体或交互内容','RULE_TARGET_MISSING':'保存规则未匹配当前页面','AUTOMATIC_OPERATION_UNSUPPORTED':'该操作暂不支持自动应用'})[e.message]||'当前规则无法安全应用');version++;onChange();}
 }
 function source(ref){const r=[...aux.values()].find(r=>'pubmed-abstract:'+r.pmid===ref?.sourceId);if(ref?.session!==session||!r?.data||!r.node.isConnected||!r.card.isConnected||pmid(r.card)!==r.pmid||r.body.textContent!==r.rendered||ref.sourceHash!==r.sourceHash)throw Error('READING_SOURCE_CHANGED');return {sourceId:'pubmed-abstract:'+r.pmid,...r.data,displayText:r.rendered,sourceHash:r.sourceHash,session,originalCardSelector:selector(r.card),target:target(r.body)};}
 function block(ref){const data=source(ref),r=aux.get(data.pmid);if(data.status!=='available'||!data.complete)throw Error('READING_SOURCE_UNAVAILABLE');return {sourceId:data.sourceId,sourceHash:data.sourceHash,sourceUrl:data.sourceUrl,title:'PubMed 完整摘要 · PMID '+data.pmid,element:r.body};}
 function blocks(){return [...aux.values()].flatMap(r=>{try{return [block({sourceId:'pubmed-abstract:'+r.pmid,sourceHash:r.sourceHash,session})];}catch{return [];}});}
 function selection(){const selected=win.getSelection();if(!selected||selected.isCollapsed||selected.rangeCount!==1)return null;const range=selected.getRangeAt(0),r=[...aux.values()].find(r=>r.data&&r.body?.contains(range.startContainer)&&r.body.contains(range.endContainer));if(!r)return null;const data=source({sourceId:'pubmed-abstract:'+r.pmid,sourceHash:r.sourceHash,session}),prefix=doc.createRange();prefix.selectNodeContents(r.body);prefix.setEnd(range.startContainer,range.startOffset);const start=prefix.toString().length,quote=range.toString();return {...data,quote,range:{start,end:start+quote.length}};}
 function snapshot(){const failures=[...aux.values()].filter(r=>r.error),reported=notices.filter(n=>n.code!=='ABSTRACT_UNAVAILABLE');if(failures.length)reported.push({code:'ABSTRACT_UNAVAILABLE',message:failures.length+' 条完整摘要未读取：'+[...new Set(failures.map(r=>abstractFailure(r.error)))].join('、')+'；可稍后重新加载。'});return {abstractStatus:[...aux.values()].map(r=>({pmid:r.pmid,status:r.error?'error':r.pending?'pending':r.data?.status||'pending',...(r.error?{errorCode:r.error,message:abstractFailure(r.error)}:{})})),provider:'reading-module',temporary:false,url:href,session,version,currentId,groups,reading:{outlineDefault,originalView,...(originalView&&originalViewState?originalViewState:{}),phase:root?(reported.length?'partial':'applied'):'original',moduleIds:originalView?originalViewState?.moduleIds||[]:modules.map(m=>m.id),pageType:originalView?originalViewState?.pageType||null:extract?.rules.pageType||null,extractorId:originalView?originalViewState?.extractorId||null:extract?.id||null,notices:reported},contentRoots:root?[{id:id(root),target:target(root)}]:[],preservation:{originalNodes:true,originalText:true,media:true,limitations:reported.map(n=>n.message)},auxiliarySources:[...aux.values()].filter(r=>r.data).flatMap(r=>{try{return [source({sourceId:'pubmed-abstract:'+r.pmid,sourceHash:r.sourceHash,session})];}catch{return [];}})};}
 function schedule(){if(timer||destroyed)return;timer=setTimeout(()=>{timer=null;run();},180);}
 const observer=new win.MutationObserver(ms=>{if(ms.some(m=>!m.target.parentElement?.closest(own)&&!m.target.closest?.(own)&&!(m.type==='childList'&&[...m.addedNodes,...m.removedNodes].length&&[...m.addedNodes,...m.removedNodes].every(n=>n.nodeType===1&&n.matches(own)))))schedule();});
 observer.observe(doc,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href','data-article-id']});
 const navigation=setInterval(()=>{if(href!==doc.location.href){originalView=false;originalViewState=null;outlineDefault=false;restore();href=doc.location.href;session=crypto.randomUUID();version++;run();}},350);
 const scroll=()=>{if(!scrollTimer)scrollTimer=setTimeout(()=>{scrollTimer=null;updateCurrent();},160);};win.addEventListener('scroll',scroll,{passive:true});
 function destroy(){destroyed=true;clearInterval(navigation);clearTimeout(timer);clearTimeout(scrollTimer);observer.disconnect();win.removeEventListener('scroll',scroll);restore();}
 win.addEventListener('pagehide',()=>{clearAux();},{once:true});
 function validatePlan(plan,{reusable=true}={}){const previous={root,extract,modules};try{const u=new URL(href),publisher=u.hostname==='journals.plos.org'&&/^\/[a-z]+\/article$/.test(u.pathname)?'#artText.article-text':u.hostname==='elifesciences.org'&&/^\/articles\/\d+\/?$/.test(u.pathname)?'main#maincontent .main-content-grid':null;let binding=publisher?null:extract?.rules;
   if(!binding&&plan.operations.some(op=>op.type==='pubmedAbstracts')&&pubmedCapability())binding=M.builtins().find(e=>e.builtinId==='pubmed-results').module.rules;
   if(plan.operations.some(op=>op.type==='outline'&&op.extraction)){
   const targets=plan.operations.filter(op=>op.type==='outline'&&op.extraction).flatMap(op=>query(doc,op.target.selector));if(!targets.length)throw Error('OUTLINE_NO_MATCHES');let common=targets[0].parentElement;while(common&&!targets.every(n=>common.contains(n)))common=common.parentElement;if(!common||common===doc.body||common===doc.documentElement||common.matches(interactive))throw Error('READING_ROOT_REQUIRED');
   binding=M.baseRules({pageType:'document',roots:[selector(common)],required:[...new Set(plan.operations.filter(op=>op.type==='outline'&&op.extraction).map(op=>op.target.selector))],outline:[]});}
  if(!binding){const roots=query(doc,publisher||'main,article,[role="main"]').filter(n=>clean(n).length>=80&&!n.querySelector(interactive)&&plan.operations.filter(o=>o.type!=='hide').every(o=>query(doc,o.target.selector).every(t=>t===n||n.contains(t))));const unique=roots.filter(n=>!roots.some(other=>other!==n&&n.contains(other)));if(unique.length!==1)throw Error('READING_ROOT_REQUIRED');binding=M.baseRules({pageType:'document',roots:[publisher||selector(unique[0])],required:publisher?['h1']:[],outline:[]});}for(const op of plan.operations){if(!['outline','style'].includes(op.type))continue;const expanded=op.target.selector.replace(/:(?:nth-(?:of-type|child)\(\s*\d+\s*\)|first-(?:of-type|child)|last-(?:of-type|child))/gi,'');if(reusable&&expanded!==op.target.selector){let nodes=[];try{nodes=query(doc,expanded);}catch{}const roots=binding.roots.flatMap(s=>query(doc,s));if(nodes.length>1&&nodes.every(n=>roots.some(r=>r.contains(n))))throw Error('MODULE_POSITIONAL_GROUP_NOT_REUSABLE');}}const module=M.fromPlan(plan,href,binding.pageType,binding);const selected=choose([{module,enabled:true}]);if(!selected)throw Error('READING_REPLAY_UNVERIFIED');({root,extract,modules}=selected);prepare();const verifiedRoot=module.rules.roots.find(s=>{const nodes=query(doc,s).filter(visible);return nodes.length===1&&nodes[0]===root;});if(!verifiedRoot)throw Error('READING_REPLAY_UNVERIFIED');module.rules.roots=[verifiedRoot];return M.validate(module);}finally{({root,extract,modules}=previous);}}
 function validateModule(module){const previous={root,extract,modules};try{const selected=choose([{module:M.validate(module),enabled:true}]);if(!selected)throw Error('READING_REPLAY_UNVERIFIED');({root,extract,modules}=selected);prepare();return {verified:true};}finally{({root,extract,modules}=previous);}}
 return {previewFullAbstracts,abstractReceipt,endAbstractPreview,sampleParagraphs,measureParagraphs,readingLayout,validateModule,setOutlineDefault(active,expectedSession){if(typeof active!=='boolean'||expectedSession!==session)throw Error('READING_PAGE_CHANGED');outlineDefault=active;run();return snapshot();},setOriginalView(active,expectedSession){if(typeof active!=='boolean'||expectedSession!==session)throw Error('READING_PAGE_CHANGED');if(active!==originalView){if(active){originalViewState={moduleIds:modules.map(m=>m.id),pageType:extract?.rules.pageType||null,extractorId:extract?.id||null};originalView=true;restore();version++;onChange();}else{originalView=false;originalViewState=null;run();}}return snapshot();},configurationError(){config=null;restore();notices=[];note('READING_PREFERENCES_UNAVAILABLE','阅读偏好无法读取，已保留原网页；请在设置中检查偏好数据。');version++;onChange();},blocks,block,selection,locateSource(ref,quote){const data=source(ref);if(typeof quote!=='string'||!quote||!data.text.includes(quote))throw Error('READING_SOURCE_QUOTE_CHANGED');aux.get(data.pmid).body.scrollIntoView({block:'center',behavior:'instant'});return {located:true};},validatePlan,setConfig(s){config=M.store(s);if(preview){pending=true;return;}restore();run();},snapshot,source,locate(ref){const r=outlineNodes.get(ref?.id);if(ref?.session!==session||ref.version!==version||!r?.node.isConnected||(r.extraction?g.WFGEngine.outlineSourceText(r.node,win,150):clean(r.node).slice(0,500))!==r.quote)throw Error('OUTLINE_SOURCE_CHANGED');r.node.scrollIntoView({block:'center',behavior:'instant'});return {located:true};},setPreview(active){preview=active;if(!active)endAbstractPreview();if(!active&&pending){pending=false;restore();run();}},refresh:run,destroy};
}
g.WFGReadingPage={create};
})(globalThis);
