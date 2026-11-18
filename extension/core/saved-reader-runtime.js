(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  Object.assign(root.SciLLM||(root.SciLLM={}),api);
})(globalThis,function(){
  'use strict';
  const fail=()=>{throw Object.assign(new Error('本机文献版本已变化，请重新打开。'),{code:'SAVED_READER_CONTEXT_CHANGED'});};
  const bindingKeys=['workspaceId','workspaceGeneration','documentHash'];
  function assertSavedReaderMessage(message,identity){
    for(const value of [message?.workspaceId,message?.workspace?.workspaceId,message?.workspaceTarget?.workspaceId])
      if(value&&value!==identity.workspaceId)fail();
    for(const value of [message?.documentId,message?.document?.documentId])
      if(value&&value!==identity.documentId)fail();
    for(const value of [message?.workspaceGeneration,message?.workspaceTarget?.workspaceGeneration])
      if(value&&Number(value)!==identity.workspaceGeneration)fail();
    return true;
  }
  function createSavedReaderOwnerGuard({chromeApi,sender,store}){
    let pinned=null;
    return async function current(){
      const api=globalThis.SciLLM,base=chromeApi.runtime.getURL('');
      const parsed=api.parseOfflineArticleReaderUrl(sender?.url,base);
      if(!parsed||sender.id!==chromeApi.runtime.id||sender.frameId!==0||!Number.isInteger(sender.tab?.id)||!sender.documentId)fail();
      const receipt=async()=>{
        const tab=await chromeApi.tabs.get(sender.tab.id);
        if(tab?.url!==parsed.readerUrl)fail();
        const value=await chromeApi.tabs.sendMessage(sender.tab.id,{action:'validateSavedArticleReader'},
          {frameId:0,documentId:sender.documentId});
        if(!value?.success||value.navigationIdentity!==parsed.readerUrl||value.binding?.workspaceId!==parsed.workspaceId||
          (parsed.workspaceGeneration!==null&&value.binding.workspaceGeneration!==parsed.workspaceGeneration))fail();
        return value.binding;
      };
      const before=await receipt();
      if(pinned&&bindingKeys.some(key=>before[key]!==pinned[key]))fail();
      const workspace=await store.getWorkspace(parsed.workspaceId);
      const structure=await store.getAsset(parsed.workspaceId,'article/structure.json');
      if(!workspace||workspace.deletionPending||Number(workspace.workspaceGeneration||1)!==before.workspaceGeneration||
        !structure||Number(structure.workspaceGeneration||1)!==before.workspaceGeneration||
        !structure.content?.documentId||structure.content.documentHash!==before.documentHash)fail();
      const after=await receipt();if(bindingKeys.some(key=>before[key]!==after[key]))fail();
      pinned={...before};
      return {...before,documentId:structure.content.documentId,title:workspace.title,canonicalUrl:workspace.canonicalUrl,
        doi:(workspace.aliases||[]).find(row=>row.type==='doi')?.value||'',workspace};
    };
  }
  const htmlTags=new Set('div span main article section header footer nav aside p h1 h2 h3 h4 h5 h6 figure figcaption img picture table caption thead tbody tfoot tr td th col colgroup ul ol li dl dt dd blockquote pre code em strong b i u s sub sup small mark abbr cite q time a br hr details summary'.split(' '));
  const svgTags=new Set('svg g defs path rect circle ellipse line polyline polygon text tspan use symbol clipPath mask linearGradient radialGradient stop title desc'.split(' '));
  const mathTags=new Set('math mrow mi mn mo mtext mspace ms mfrac msqrt mroot msup msub msubsup munder mover munderover mtable mtr mtd menclose mpadded mphantom mfenced mstyle semantics annotation'.split(' '));
  function mountSavedArticleHtml(document,html){
    // Treat even an imported snapshot as untrusted. Only inert reading nodes
    // enter the extension document; no source script, event or network resource.
    const parsed=new DOMParser().parseFromString(String(html),'text/html');
    let count=0;
    const clone=node=>{
      if(++count>100000)throw Error('SAVED_READER_SOURCE_TOO_LARGE');
      if(node.nodeType===3)return document.createTextNode(node.textContent);
      if(node.nodeType!==1)return null;
      const tag=node.localName;
      const svg=node.namespaceURI==='http://www.w3.org/2000/svg',math=node.namespaceURI==='http://www.w3.org/1998/Math/MathML';
      if(!(svg?svgTags:math?mathTags:htmlTags).has(tag))return null;
      const copy=svg||math?document.createElementNS(node.namespaceURI,tag):document.createElement(tag);
      for(const attr of node.attributes){
        const name=attr.name.toLowerCase(),value=attr.value;
        if(/^on/.test(name)||['srcdoc','is','name','slot','contenteditable'].includes(name))continue;
        if(name==='src'){
          if(tag==='img'&&/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-z0-9+/]+=*$/i.test(value))copy.setAttribute('src',value);
        }else if(name==='href'||name==='xlink:href'){
          if(/^#[^\s]*$/.test(value))copy.setAttribute(attr.name,value);
          else if(tag==='a'&&/^https?:\/\//i.test(value)){copy.setAttribute('href',value);copy.setAttribute('target','_blank');copy.setAttribute('rel','noopener noreferrer');}
        }else if(/^data-(?:counter|theme|color-mode|layout|component|section|figure|db-target-of|brevess-layout-slot|brevess-original-image|brevess-figure-id|brevess-image-index)$/.test(name)||
          /^(?:id|class|style|lang|dir|role|title|alt|width|height|colspan|rowspan|scope|open|hidden)$/.test(name)||
          /^aria-[a-z-]+$/.test(name)||svg&&/^(?:viewbox|d|fill|stroke|stroke-width|transform|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|points|offset|stop-color|clip-path|preserveaspectratio|xmlns)$/.test(name)||math&&/^(?:display|mathvariant|columnalign|rowspan|columnspan)$/.test(name))copy.setAttribute(attr.name,value);
      }
      for(const child of node.childNodes){const next=clone(child);if(next)copy.append(next);}
      return copy;
    };
    for(const source of parsed.querySelectorAll('style')){
      const style=document.createElement('style');style.dataset.savedArticleStyle='';style.textContent=source.textContent;
      document.head.append(style);
    }
    for(const name of ['class','lang','dir','style']){
      if(parsed.body.hasAttribute(name))document.body.setAttribute(name,parsed.body.getAttribute(name));
      if(parsed.documentElement.hasAttribute(name))document.documentElement.setAttribute(name,parsed.documentElement.getAttribute(name));
    }
    const fragment=document.createDocumentFragment();
    for(const source of parsed.body.childNodes){const copy=clone(source);if(copy)fragment.append(copy);}
    document.body.replaceChildren(fragment);
    const responsive=document.createElement('style');
    responsive.dataset.savedArticleLayout='';
    responsive.textContent='html,body{max-width:100%!important;min-width:0!important}main,article,[role="main"]{box-sizing:border-box!important;min-width:0!important;max-width:100%!important}img{max-width:100%;height:auto}';
    document.head.append(responsive);
    return parsed.title;
  }
  function bindSavedArticleDom(document,snapshot){
    const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/gu,' ').trim();
    const candidates=new Map();
    for(const element of document.querySelectorAll('p,li,figcaption,h1,h2,h3,h4,h5,h6,td,blockquote')){
      const key=normalize(element.textContent);if(!key)continue;
      if(!candidates.has(key))candidates.set(key,[]);candidates.get(key).push(element);
    }
    const paragraphs=(snapshot.paragraphs||[]).map(record=>{
      let element=record.elementId?document.getElementById(record.elementId):null;
      if(!element)element=candidates.get(normalize(record.text))?.shift()||null;
      if(element){element.dataset.sciLlmParagraphId=record.paragraphId;element.dataset.sciManualBlockId=record.paragraphId;}
      return {...record,anchor:{...(record.anchor||{}),paragraphId:record.paragraphId}};
    });
    const nodes=(items)=>(items||[]).map(node=>{
      const element=document.getElementById(node.sourceKey||node.sectionId)||candidates.get(normalize(node.title))?.[0]||null;
      if(element)element.dataset.sciSectionId=node.sectionId;
      return {...node,anchor:{...(node.anchor||{}),...(element?.id?{domId:element.id}:{}),headingText:node.title},children:nodes(node.children)};
    });
    return {title:snapshot.title,url:snapshot.url,documentId:snapshot.documentId,documentHash:snapshot.documentHash,
      publisherFamily:snapshot.publisherFamily,diagnostics:snapshot.diagnostics,paragraphs,nodes:nodes(snapshot.nodes),revision:Math.max(1,Number(snapshot.revision)||1),
      adapterId:'saved-article',typedRecords:paragraphs};
  }
  return{createSavedReaderOwnerGuard,assertSavedReaderMessage,mountSavedArticleHtml,bindSavedArticleDom};
});
