(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./library-catalog-model.js'):root.BrevessLibraryCatalog);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SciLLM=Object.assign(root.SciLLM||{},api);
})(globalThis,function(model){
  'use strict';
  const PATH='library-html-reader.html';
  const fail=(code='LIBRARY_HTML_CONTEXT_STALE')=>{throw Object.assign(new Error(code),{code});};
  const check=(value,code)=>{if(!value)fail(code);};
  const keys=['entryId','attachmentId','documentHash'];
  function validBinding(b){return b&&/^entry:[A-Za-z0-9_-]{1,100}$/.test(b.entryId)&&
    /^attachment:[A-Za-z0-9_-]{1,100}$/.test(b.attachmentId)&&/^[a-f0-9]{64}$/.test(b.documentHash);}
  function parseLibraryHtmlReaderUrl(value,base){
    try{
      const url=new URL(value),own=new URL(PATH,base);
      if(!/^(chrome|moz)-extension:$/.test(own.protocol)||url.protocol!==own.protocol||url.host!==own.host||
        url.pathname!==own.pathname||url.username||url.password||url.hash||[...url.searchParams].length!==3)return null;
      const binding=Object.fromEntries(keys.map(k=>[k,url.searchParams.get(k)]));
      return validBinding(binding)?binding:null;
    }catch(_){return null;}
  }
  function buildLibraryHtmlReaderUrl(base,binding){
    check(validBinding(binding),'LIBRARY_HTML_BINDING_INVALID');
    const url=new URL(PATH,base);for(const key of keys)url.searchParams.set(key,binding[key]);
    check(parseLibraryHtmlReaderUrl(url.href,base),'LIBRARY_HTML_BINDING_INVALID');return url.href;
  }
  function findSource(state,binding){
    const entry=state?.entries?.find(e=>e.id===binding.entryId&&!e.removedAt);
    const attachment=entry?.attachments?.find(a=>a.id===binding.attachmentId&&!a.removedAt);
    check(attachment&&attachment.kind==='html'&&attachment.sha256===binding.documentHash&&
      attachment.locator?.type==='catalog-blob'&&attachment.locator.sha256===binding.documentHash&&
      attachment.availability==='available','LIBRARY_HTML_SOURCE_UNAVAILABLE');
    return {entry,attachment};
  }
  async function readLibraryHtmlSource({catalogStore,attachmentStore,binding}){
    check(validBinding(binding),'LIBRARY_HTML_BINDING_INVALID');
    const first=findSource(await catalogStore.read(),binding);
    // load() independently verifies local bytes, SHA256, type and size.
    const blob=await attachmentStore.load(first.attachment);
    const current=findSource(await catalogStore.read(),binding);
    check(JSON.stringify(first)===JSON.stringify(current));
    const fields=current.entry.fields||{},aliases=current.entry.aliases||[];
    const doi=model.normalizeCatalogDoi(Object.hasOwn(fields,'doi')?fields.doi:aliases.find(a=>a.startsWith('doi:'))?.slice(4));
    return {...binding,documentId:'sha256:'+binding.documentHash,blob,
      title:Object.hasOwn(fields,'title')?fields.title??'':current.attachment.name,
      doi,canonicalUrl:doi?'https://doi.org/'+doi:'',name:current.attachment.name};
  }
  function createLibraryHtmlOwnerGuard({chromeApi,sender,catalogStore,attachmentStore}){
    let pinned=null;
    return async function assertCurrent(){
      const base=chromeApi.runtime.getURL(''),binding=parseLibraryHtmlReaderUrl(sender?.url,base);
      check(binding&&sender.id===chromeApi.runtime.id&&Number.isSafeInteger(sender.tab?.id)&&sender.tab.id>=0&&
        sender.frameId===0&&typeof sender.documentId==='string'&&sender.documentId.length>0);
      const receipt=async()=>{
        let frame=null;
        try { frame=await chromeApi.webNavigation.getFrame({tabId:sender.tab.id,frameId:0}); } catch (_) { /* Extension-owned frames may be omitted. */ }
        if(frame)check(frame.documentId===sender.documentId&&frame.documentLifecycle==='active'&&frame.url===sender.url);
        // Exact documentId addressing also handles Chromium omitting extension frames.
        const value=await chromeApi.tabs.sendMessage(sender.tab.id,{action:'validateLibraryHtmlReader'},
          {frameId:0,documentId:sender.documentId});
        check(value?.success===true&&value.navigationIdentity===sender.url&&
          keys.every(k=>value.binding?.[k]===binding[k])&&Number.isSafeInteger(value.binding?.generation)&&value.binding.generation>0);
        return {...binding,generation:value.binding.generation};
      };
      const before=await receipt();if(pinned)check(JSON.stringify(pinned)===JSON.stringify(before));
      const source=await readLibraryHtmlSource({catalogStore,attachmentStore,binding});
      check(JSON.stringify(before)===JSON.stringify(await receipt()));pinned=before;
      const {blob,...identity}=source;return {...identity,generation:before.generation};
    };
  }
  function extractLegacyLibraryHtmlText(html,{document}){
    // Parse only into inert template contents. Never move source nodes/attributes to the reader.
    const inert=document.implementation.createHTMLDocument(''),template=inert.createElement('template');
    template.innerHTML=html;
    check(template.content.querySelectorAll('*').length<=50000,'LIBRARY_ATTACHMENT_HTML_TOO_COMPLEX');
    template.content.querySelectorAll('script,style,link,meta,base,iframe,frame,object,embed,form,template,noscript,nav,footer,[hidden],[aria-hidden="true"]').forEach(n=>n.remove());
    const root=template.content.querySelector('article')||template.content.querySelector('main')||template.content;
    const records=[];let text='',sectionTitle='',pendingTag='p';
    const blocks=new Set('address article aside blockquote div section main header h1 h2 h3 h4 h5 h6 p li dt dd pre caption figcaption tr'.split(' '));
    function flush(){
      const value=text.replace(/\s+/gu,' ').trim();text='';if(!value)return;
      const tag=/^h[1-6]$/.test(pendingTag)?pendingTag:'p';
      if(tag!=='p')sectionTitle=value;
      records.push({paragraphId:'html-original-'+records.length,text:value,sectionTitle,tag,recordType:tag==='p'?'body':'heading'});
    }
    function visit(node){
      if(node.nodeType===3){text+=node.nodeValue||'';return;}
      if(node.nodeType!==1&&node.nodeType!==11)return;
      const tag=node.localName||'';
      if(tag==='br'){text+='\n';return;}
      if(tag==='img'){return;} // Original remote resources remain in the downloadable original, never fetched here.
      const boundary=blocks.has(tag);if(boundary){flush();pendingTag=tag;}
      for(const child of node.childNodes)visit(child);
      if(boundary){flush();pendingTag='p';}
      if(tag==='td'||tag==='th')text+='\t';
    }
    visit(root);flush();check(records.length>0,'LIBRARY_HTML_TEXT_EMPTY');return records;
  }
  const projections=new WeakMap(),linkedContainers=new WeakSet(),vectorImages=new WeakMap();
  function isLibraryHtmlVectorImage(image){
    const source=vectorImages.get(image);
    return Boolean(source&&image.getAttribute('src')===source&&(!image.currentSrc||image.currentSrc===source)&&!image.hasAttribute('srcset'));
  }
  const MATH_NS='http://www.w3.org/1998/Math/MathML';
  const mathTags=new Set('math mrow mi mn mo mtext mspace ms mfrac msqrt mroot msup msub msubsup munder mover munderover mtable mtr mtd menclose mpadded mphantom mfenced mstyle semantics'.split(' '));
  const safeTags=new Set('article section div span p h1 h2 h3 h4 h5 h6 figure figcaption table caption thead tbody tfoot tr td th colgroup col ul ol li dl dt dd blockquote pre code em strong b i u s sub sup small mark abbr cite q time a br hr'.split(' '));
  const blockTags=new Set('article section div p h1 h2 h3 h4 h5 h6 figure figcaption table caption thead tbody tfoot tr ul ol li dl dt dd blockquote pre'.split(' '));
  const normalize=value=>String(value||'').replace(/\s+/gu,' ').trim();
  // A display/model companion only. Never use this string for DOM offsets,
  // paragraph IDs, content hashes or exact evidence quotes.
  function libraryHtmlScientificText(element){
    let remaining=50000;
    const visit=(node,depth=0)=>{
      if(!node)return '';
      if(--remaining<0||depth>200)throw Error('MATH_REPRESENTATION_LIMIT');
      if(node.nodeType===3)return String(node.nodeValue||'');
      const tag=String(node.localName||node.tagName||'').toLowerCase();
      if(node.hasAttribute?.('data-sci-plugin-ui')||['annotation','annotation-xml','script','style','img'].includes(tag))return '';
      const children=[...(node.childNodes||[])],parts=children.map(child=>visit(child,depth+1));
      const content=parts.join('');
      if(node.namespaceURI!==MATH_NS){
        if(tag==='br')return ' ';
        if(tag==='sup'||tag==='sub')return content?`<${tag}>${content}</${tag}>`:'';
        return content;
      }
      const operands=children.flatMap((child,index)=>child.nodeType===1&&!['annotation','annotation-xml'].includes(child.localName)?[parts[index]]:[]);
      // Explicit attributes can change mathematical meaning (bold vectors,
      // zero-thickness fractions, accents). Retain them as structural notation.
      const attrs=['mathvariant','linethickness','notation','accent','accentunder','stretchy','fence','separator','columnspan','rowspan']
        .flatMap(name=>{const value=node.getAttribute?.(name);return value!==null&&value!==undefined?[`${name}=${value}`]:[];});
      if(attrs.length)return `${tag}[${attrs.join(', ')}](${operands.length?operands.join('; '):content})`;
      if(tag==='mspace')return ' ';
      if(['math','mrow','semantics','mi','mn','mo','mtext','ms','mtd'].includes(tag))return content;
      if(tag==='mfrac'&&operands.length===2)return `(${operands[0]})/(${operands[1]})`;
      if(tag==='msqrt')return `sqrt(${content})`;
      if(tag==='mroot'&&operands.length===2)return `root(${operands[1]}; ${operands[0]})`;
      if((tag==='msup'||tag==='msub')&&operands.length===2)return `(${operands[0]})${tag==='msup'?'^':'_'}(${operands[1]})`;
      if(tag==='msubsup'&&operands.length===3)return `(${operands[0]})_(${operands[1]})^(${operands[2]})`;
      if(tag==='mtable')return `matrix(${operands.join('; ')})`;
      if(tag==='mtr')return `[${operands.join(', ')}]`;
      if(tag==='mfenced'){
        const separators=String(node.getAttribute?.('separators')??',').replace(/\s/gu,'');
        const body=operands.map((value,index)=>(index&&separators?separators[Math.min(index-1,separators.length-1)]:'')+value).join('');
        return (node.getAttribute?.('open')??'(')+body+(node.getAttribute?.('close')??')');
      }
      // Under/over accents and unusual layouts stay explicit, without guessing
      // an algebraic operation or silently concatenating their operands.
      return `${tag}(${operands.length?operands.join('; '):content})`;
    };
    try{return normalize(visit(element));}catch(_){return '[MathML representation unavailable]';}
  }
  function safeExternalUrl(value,base){
    if(!String(value||'').trim())return '';
    try{const url=new URL(value,base||undefined);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:'';}catch(_){return '';}
  }
  function embeddedRaster(value){
    // No SVG/HTML, filesystem/blob references, srcset or lazy remote URL is activated.
    return /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(value)?value:'';
  }
  function staticSvgImage(source,document){
    // Preserve only complete, self-contained static vectors. Rebuild into a
    // separate SVG image document, never into the active reader DOM. Unknown
    // styling/geometry fails as a whole rather than showing a misleading chart.
    const ns='http://www.w3.org/2000/svg';
    const attrs={svg:'viewBox width height preserveAspectRatio version',g:'',defs:'',title:'',desc:'',
      path:'d pathLength',rect:'x y width height rx ry pathLength',circle:'cx cy r pathLength',
      ellipse:'cx cy rx ry pathLength',line:'x1 y1 x2 y2 pathLength',polyline:'points pathLength',polygon:'points pathLength',
      text:'x y dx dy rotate textLength lengthAdjust',tspan:'x y dx dy rotate textLength lengthAdjust',
      linearGradient:'x1 y1 x2 y2 gradientUnits gradientTransform spreadMethod',
      radialGradient:'cx cy r fx fy fr gradientUnits gradientTransform spreadMethod',
      stop:'offset stop-color stop-opacity',clipPath:'clipPathUnits'};
    const common=new Set('id transform fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule font-family font-size font-weight font-style text-anchor dominant-baseline'.split(' '));
    const number='[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?';
    const length=new RegExp('^'+number+'(?:px|pt|pc|mm|cm|in|em|ex|%)?$');
    const numbers=new RegExp('^'+number+'(?:[ ,]+'+number+')*$');
    const ids=new Map(),refs=[];let count=0,size=0;
    function color(value){return /^(?:#[a-f0-9]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([0-9.,%+\-\s]+\))$/i.test(value)&&! /^(?:inherit|currentcolor|context-fill|context-stroke)$/i.test(value);}
    function valueOk(name,value){
      if(value.length>200000)return false;
      if(name==='id')return /^[A-Za-z_][\w:.-]{0,100}$/.test(value)&&!ids.has(value);
      if(['fill','stroke','clip-path'].includes(name)){
        const ref=/^url\(#([A-Za-z_][\w:.-]{0,100})\)$/.exec(value);
        if(ref){refs.push({id:ref[1],kind:name});return true;}
        return name==='clip-path'?value==='none':color(value);
      }
      if(name==='stop-color')return color(value);
      if(['transform','gradientTransform'].includes(name))return /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([-+\d.eE ,]+\)\s*)+$/.test(value);
      if(name==='viewBox')return numbers.test(value)&&value.split(/[ ,]+/).length===4&&value.split(/[ ,]+/).every(n=>Number.isFinite(Number(n)))&&value.split(/[ ,]+/).slice(2).every(n=>Number(n)>0);
      if(name==='d')return /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(value);
      if(['points','rotate','stroke-dasharray'].includes(name))return value==='none'&&name==='stroke-dasharray'||numbers.test(value);
      if(['x','y','dx','dy'].includes(name))return length.test(value)||numbers.test(value);
      const enums={version:['1.0','1.1','2.0'],
        'fill-rule':['nonzero','evenodd'],'clip-rule':['nonzero','evenodd'],
        'stroke-linecap':['butt','round','square'],'stroke-linejoin':['miter','round','bevel'],
        gradientUnits:['userSpaceOnUse','objectBoundingBox'],clipPathUnits:['userSpaceOnUse','objectBoundingBox'],
        spreadMethod:['pad','reflect','repeat'],lengthAdjust:['spacing','spacingAndGlyphs'],
        'font-style':['normal','italic','oblique'],'text-anchor':['start','middle','end'],
        'dominant-baseline':['auto','alphabetic','middle','central','hanging','text-before-edge','text-after-edge']};
      if(enums[name])return enums[name].includes(value);
      if(name==='font-family')return /^(?:sans-serif|serif|monospace)$/.test(value);
      if(name==='font-weight')return /^(?:normal|bold|[1-9]00)$/.test(value);
      if(name==='preserveAspectRatio')return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value);
      return length.test(value)&&Number.isFinite(parseFloat(value));
    }
    function copy(node,depth=0){
      if(depth>100||++count>5000)throw Error('complex vector');
      if(node.nodeType===3){size+=node.nodeValue.length;if(size>1000000)throw Error('large vector');return document.createTextNode(node.nodeValue);}
      if(node.nodeType===8)return null;
      const tag=node.localName;
      if(node.namespaceURI!==ns||!Object.hasOwn(attrs,tag)||(tag==='svg'&&node!==source))throw Error('unsupported vector element');
      const allowed=new Set(attrs[tag].split(' ')),out=document.createElementNS(ns,tag);
      for(const attr of node.attributes){
        if(attr.name==='xmlns'&&node===source&&attr.value===ns)continue;
        const value=attr.value.trim(),name=attr.name;size+=value.length;
        // Nested clipping can introduce cycles or unsupported compound masks.
        if(name==='clip-path'&&node.closest('clipPath'))throw Error('nested clipping');
        if(size>1000000||attr.namespaceURI||(!allowed.has(name)&&!common.has(name))||!valueOk(name,value))throw Error('unsupported vector attribute');
        if(name==='id')ids.set(value,tag);
        out.setAttribute(name,value);
      }
      for(const child of node.childNodes){const safe=copy(child,depth+1);if(safe)out.append(safe);}
      return out;
    }
    try{
      const safe=copy(source);
      for(const ref of refs)if(ref.kind==='clip-path'?ids.get(ref.id)!=='clipPath':!['linearGradient','radialGradient'].includes(ids.get(ref.id)))return null;
      const viewBox=(safe.getAttribute('viewBox')||'').split(/[ ,]+/).map(Number);
      for(const [name,index] of [['width',2],['height',3]]){
        const value=safe.getAttribute(name)||String(viewBox[index]||'');
        if(!/^(?:\d*\.\d+|\d+)(?:px)?$/.test(value)||!(parseFloat(value)>0&&parseFloat(value)<=16384))return null;
        if(!safe.hasAttribute(name))safe.setAttribute(name,value);
      }
      const serialized=new XMLSerializer().serializeToString(safe);
      return {src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(serialized),title:source.querySelector('title')?.textContent||''};
    }catch(_){return null;}
  }
  function extractLibraryHtmlText(html,{document}){
    const legacy=extractLegacyLibraryHtmlText(html,{document}),legacyIds=new Map();
    for(const record of legacy){const queue=legacyIds.get(record.text)||[];queue.push(record.paragraphId);legacyIds.set(record.text,queue);}
    const inert=document.implementation.createHTMLDocument(''),template=inert.createElement('template');
    template.innerHTML=html;
    check(template.content.querySelectorAll('*').length<=50000,'LIBRARY_ATTACHMENT_HTML_TOO_COMPLEX');
    // Inspect untouched SVG before generic HTML removal can hide unsupported parts.
    const svgImages=new Map([...template.content.querySelectorAll('svg')].filter(node=>!node.parentElement?.closest('svg')).map(node=>[node,staticSvgImage(node,document)]));
    const sourceBase=safeExternalUrl(template.content.querySelector('link[rel="canonical"]')?.getAttribute('href'));
    template.content.querySelectorAll('script:not([type="math/tex"]):not([type="math/tex; mode=display"]),style,link,meta,base,iframe,frame,object,embed,form,input,button,select,textarea,template,noscript,nav,footer,[hidden],[aria-hidden="true"]').forEach(n=>n.remove());
    const source=template.content.querySelector('article')||template.content.querySelector('main')||template.content;
    // PLOS stores a caption title and its prose as sibling blocks. Keep their explicit owner.
    for(const title of source.querySelectorAll('.figure > .figcaption')){
      const caption=inert.createElement('figcaption');title.before(caption);
      let sibling=title.nextSibling;caption.append(title);
      while(sibling){const next=sibling.nextSibling;
        if(sibling.nodeType===3||sibling.matches?.('p:not(.caption_object),.caption_target'))caption.append(sibling);
        sibling=next;
      }
    }
    const anchors=new Map(),duplicates=new Set();let anchorIndex=0;
    for(const node of source.querySelectorAll('[id],a[name]')){
      const target='library-source-'+anchorIndex++;
      for(const key of new Set([node.getAttribute('id'),node.getAttribute('name')].filter(Boolean))){
        if(anchors.has(key)){duplicates.add(key);continue;}anchors.set(key,target);
      }
    }
    const summary={embeddedImages:0,embeddedVectors:0,unavailableImages:0,unsupportedVectors:0};
    function copy(node,depth=0){
      check(depth<=200,'LIBRARY_ATTACHMENT_HTML_TOO_COMPLEX');
      if(node.nodeType===3)return document.createTextNode(node.nodeValue||'');
      if(node.nodeType!==1)return null;
      const tag=node.localName.toLowerCase();
      if(tag==='annotation'||tag==='annotation-xml')return null;
      if(tag==='img'||tag==='svg'){
        const vector=tag==='svg'?svgImages.get(node):null;
        const image=tag==='img'?embeddedRaster(node.getAttribute('src')||''):vector?.src;
        if(image){const out=document.createElement('img');out.src=image;out.alt=node.getAttribute('alt')||vector?.title||'';out.decoding='async';
          for(const name of ['width','height'])if(/^[1-9]\d{0,4}$/.test(node.getAttribute(name)||''))out.setAttribute(name,node.getAttribute(name));
          if(vector){vectorImages.set(out,image);summary.embeddedVectors++;}else summary.embeddedImages++;return out;
        }
        const out=document.createElement('span');out.className='library-html-missing-image';out.dataset.sciPluginUi='';
        const label=node.getAttribute('alt')||node.querySelector('title')?.textContent||'';
        out.textContent=tag==='svg'?'此矢量图尚不支持安全研读显示。':'此图像未嵌入原件，未联网加载。';
        if(label)out.append(document.createTextNode(' '+label));
        const raw=node.getAttribute('src')||node.getAttribute('data-src')||'';
        if(raw){const address=document.createElement('code');address.textContent=raw.length>500?raw.slice(0,500)+'…':raw;out.append(address);
          const url=safeExternalUrl(raw,sourceBase);if(url){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='打开图像来源（联网）';out.append(link);}}
        if(tag==='svg')summary.unsupportedVectors++;else summary.unavailableImages++;
        return out;
      }
      if(tag==='script'){const out=document.createElement('code');out.className='library-html-equation';out.textContent=node.textContent||'';return out;}
      let safeTag=safeTags.has(tag)?tag:'span';
      if(tag==='div'&&node.classList.contains('figure'))safeTag='figure';
      const math=node.namespaceURI===MATH_NS&&mathTags.has(tag);
      const out=math?document.createElementNS(MATH_NS,tag):document.createElement(safeTag);
      const sourceId=[node.getAttribute('id'),node.getAttribute('name')].find(key=>key&&!duplicates.has(key));
      if(sourceId&&anchors.has(sourceId)&&!duplicates.has(sourceId))out.id=anchors.get(sourceId);
      if(node.matches('.references,.bibliography,[role="doc-bibliography"]')){out.className='references';out.setAttribute('role','doc-bibliography');}
      if(tag==='ol'&&node.matches('.references')&&[...node.children].every(li=>/^\s*\d+\./.test(li.querySelector('.order')?.textContent||'')))out.classList.add('library-html-numbered-references');
      if(tag==='a'){
        const href=node.getAttribute('href')||'';let target='';
        if(href.startsWith('#')){let key;try{key=decodeURIComponent(href.slice(1));}catch(_){key='';}
          if(anchors.has(key)&&!duplicates.has(key))target='#'+anchors.get(key);
        }else{target=safeExternalUrl(href,sourceBase);if(target){out.target='_blank';out.rel='noopener noreferrer';}}
        if(target)out.setAttribute('href',target);
      }
      if(['td','th'].includes(tag)){
        for(const attr of ['rowspan','colspan'])if(/^[1-9]\d{0,2}$/.test(node.getAttribute(attr)||''))out.setAttribute(attr,node.getAttribute(attr));
        if(['row','col','rowgroup','colgroup'].includes(node.getAttribute('scope')))out.setAttribute('scope',node.getAttribute('scope'));
      }
      if(tag==='ol'&&/^-?\d{1,6}$/.test(node.getAttribute('start')||''))out.setAttribute('start',node.getAttribute('start'));
      if(math){
        // Only presentational MathML attributes, never href/style/event attributes.
        for(const attr of ['display','mathvariant','stretchy','fence','separator','accent','accentunder','columnalign','rowalign','columnspan','rowspan','linethickness','notation','open','close','separators']){
          const value=node.getAttribute(attr);if(value&&value.length<=80&&/^[\w\s.,+()\[\]{}|/\-]*$/.test(value))out.setAttribute(attr,value);
        }
      }
      for(const child of node.childNodes){const safe=copy(child,depth+1);if(safe)out.append(safe);}
      if(tag==='br')out.append(document.createTextNode(' '));
      return out;
    }
    const tree=document.createElement('div');
    for(const child of source.childNodes){const safe=copy(child);if(safe)tree.append(safe);}
    // A space in each non-final cell separates raw text offsets without flattening the table.
    for(const row of tree.querySelectorAll('tr')){
      for(const cell of row.children)for(const block of cell.querySelectorAll('p,div,li,blockquote,pre'))block.append(document.createTextNode(' '));
      for(const cell of [...row.children].slice(0,-1))cell.append(document.createTextNode(' '));
    }
    const records=[];let sectionTitle='';
    const isUi=node=>node.nodeType===1&&node.hasAttribute('data-sci-plugin-ui');
    function hasBlock(node){return node.nodeType===1&&!isUi(node)&&(blockTags.has(node.localName)||[...node.children].some(hasBlock));}
    function addRecord(node){
      const texts=[];function collect(current){if(isUi(current)||current.localName==='img')return;
        if(current.nodeType===3)texts.push(current);else for(const child of current.childNodes)collect(child);}
      collect(node);let trailingSpace=true;
      for(const text of texts){let value=text.nodeValue.replace(/\s+/gu,' ');if(trailingSpace)value=value.replace(/^ /,'');
        text.nodeValue=value;if(value)trailingSpace=value.endsWith(' ');}
      for(let i=texts.length-1;i>=0;i--){if(texts[i].nodeValue){texts[i].nodeValue=texts[i].nodeValue.replace(/ $/,'');break;}}
      const text=texts.map(n=>n.nodeValue).join('');if(!text)return;
      const heading=/^h[1-6]$/.test(node.localName);if(heading)sectionTitle=text;
      const recordType=heading?'heading':node.closest('figcaption')?'figure-caption':node.closest('caption')?'table-caption':node.closest('[role="doc-bibliography"]')?'reference':'body';
      const paragraphId=legacyIds.get(text)?.shift()||'html-structure-'+records.length;
      node.dataset.sciLlmParagraphId=paragraphId;node.dataset.sciManualBlockId=paragraphId;
      const displayText=libraryHtmlScientificText(node);
      records.push({paragraphId,text,displayText,sectionTitle,tag:heading?node.localName:'p',recordType});
    }
    function index(node){
      if(isUi(node))return;
      const children=[...node.childNodes];
      if(node.localName==='tr'||(node!==tree&&!children.some(hasBlock))){addRecord(node);return;}
      let run=[];
      function flush(){if(!run.length)return;
        if(run.some(n=>normalize(n.textContent)&&!isUi(n))){const span=document.createElement('span');run[0].before(span);for(const child of run)span.append(child);addRecord(span);}
        run=[];
      }
      for(const child of children){if(hasBlock(child)){flush();index(child);}else run.push(child);}flush();
    }
    index(tree);check(records.length>0,'LIBRARY_HTML_TEXT_EMPTY');
    projections.set(records,{tree,summary});return records;
  }
  function libraryHtmlProjectionSummary(records){return {...(projections.get(records)?.summary||{})};}
  function renderLibraryHtmlText(container,records,{document}){
    const projection=projections.get(records);
    if(projection){
      const tree=projection.tree.cloneNode(true),originals=projection.tree.querySelectorAll('img');
      tree.querySelectorAll('img').forEach((image,index)=>{const source=vectorImages.get(originals[index]);if(source)vectorImages.set(image,source);});
      container.replaceChildren(...tree.childNodes);
      if(!linkedContainers.has(container)){
        container.addEventListener('click',event=>{
          const link=event.target.closest?.('a[href]'),href=link?.getAttribute('href')||'';
          if(!container.contains(link)||!/^#library-source-\d+$/.test(href))return;
          // Fragment navigation must not change the strict reader URL/owner identity.
          event.preventDefault();container.querySelector(href)?.scrollIntoView({block:'center'});
        });linkedContainers.add(container);
      }
      return;
    }
    const fragment=document.createDocumentFragment();
    for(const record of records){
      const node=document.createElement(/^h[1-6]$/.test(record.tag)?record.tag:'p');
      node.textContent=record.text;node.dataset.sciLlmParagraphId=record.paragraphId;
      node.dataset.sciManualBlockId=record.paragraphId;fragment.append(node);
    }
    container.replaceChildren(fragment);
  }
  return {parseLibraryHtmlReaderUrl,buildLibraryHtmlReaderUrl,readLibraryHtmlSource,createLibraryHtmlOwnerGuard,
    extractLibraryHtmlText,renderLibraryHtmlText,libraryHtmlProjectionSummary,isLibraryHtmlVectorImage,libraryHtmlScientificText};
});
