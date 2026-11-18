(() => {
  'use strict';
  if(globalThis.BrevessWebReadingPage?.version===5)return;
  globalThis.BrevessWebReadingPage?.stop();
  // Native annotation marks are interactive wrappers around original text.
  // Their button role must not erase that text from snapshots or anchor reads.
  const excluded='.bili-dyn-item__footer,.bili-dyn-item__avatar,.bili-dyn-item__ornament,.bili-dyn-item__more,.bili-dyn-card-video__stat,.bili-album__watch,.bili-rich-text__action,.dyn-orig-author__right,nav,aside,footer,form,textarea,input,[contenteditable]:not([contenteditable="false"]),button,[role="button"]:not(mark.sci-manual-highlight):not(mark.sci-llm-highlight):not(.sci-highlight),[role="navigation"],[role="dialog"],[hidden],[aria-hidden="true"],script,style,noscript,.sr-only,.comments,.related-articles,.recommended,.c-article-recommendations,.app-explore-related-subjects,.modal,.article-section__sharers,.asset-viewer-inline,.additional-assets,[data-sci-plugin-ui],[data-sci-translation],[data-wfg-reading-owned],[id^="brevess"],[id^="sci-"]';
  const headingSelector='h1,h2,h3,h4,h5,h6,[role="heading"]';
  let dirty=true,cached=null,refs=new Map(),observer=null,lease=null,debounce=null;
  const token=crypto.randomUUID();
  const url=()=>{const u=new URL(location.href);u.hash='';return u.href;};
  const hash=text=>{let a=2166136261,b=2246822519;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489917);}return(a>>>0).toString(16)+(b>>>0).toString(16);};
  const clean=value=>String(value||'').replace(/\r\n/g,'\n').trim();
  function eligible(e){if(!e||e.closest(excluded))return false;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||s.contentVisibility==='hidden')return false;}return true;}
  function text(e){if(!e)return'';const copy=e.cloneNode(true),original=e.querySelectorAll('*'),cloned=copy.querySelectorAll('*');for(let i=original.length-1;i>=0;i--)if(!eligible(original[i]))cloned[i].remove();return clean(copy.textContent);}
  function mainRoot(){return Array.from(document.querySelectorAll('main,[role="main"],article')).find(eligible)||document.body;}
  function chatRoots(){
    const modern=Array.from(document.querySelectorAll('[data-chatgpt-search-unit-key]')).filter(e=>/:(user|assistant)$/.test(e.getAttribute('data-chatgpt-search-unit-key')||'')&&eligible(e));
    if(modern.length)return modern.map(e=>{
      const role=e.getAttribute('data-chatgpt-search-unit-key').split(':').pop();
      const ids=[...new Set((e.getAttribute('data-chatgpt-search-message-ids')||'').split(/\s+/).filter(Boolean))];
      const selected=e.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id');
      const id=selected||(ids.length===1?ids[0]:'');
      const node=role==='assistant'?e.querySelector('[data-markdown-text-style="assistant-message"]'):e;
      return{node,role,id,turnId:e.closest('[data-turn-key]')?.getAttribute('data-turn-key')||''};
    }).filter(x=>x.node);
    return Array.from(document.querySelectorAll('[data-message-author-role]')).filter(eligible).map(e=>({node:e.querySelector('.markdown')||e,role:e.getAttribute('data-message-author-role'),id:e.getAttribute('data-message-id')||'',turnId:e.closest('[data-turn-key]')?.getAttribute('data-turn-key')||''})).filter(x=>['user','assistant'].includes(x.role));
  }
  function r18SiteInfo(value) {
  let u; try { u = new URL(value); } catch { return { family: '', conversation: false, saved: false }; }
  const host = u.hostname.toLowerCase(), path = u.pathname;
  let family = '', saved = false;
  if (['chatgpt.com', 'chat.openai.com'].includes(host)) { family = 'chatgpt'; saved = /\/(?:c)\/[^/]+\/?$/.test(path); }
  else if (host === 'chat.deepseek.com') { family = 'deepseek'; saved = /^\/a\/chat\/s\/[^/]+\/?$/.test(path); }
  else if (host === 'yuanbao.tencent.com') { family = 'yuanbao'; saved = /^\/chat\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{6,80}\/?$/.test(path); }
  else if (['www.doubao.com', 'doubao.com'].includes(host)) { family = 'doubao'; saved = /^\/chat\/[^/]+\/?$/.test(path); }
  else if (['www.kimi.com', 'kimi.com', 'kimi.moonshot.cn'].includes(host)) { family = 'kimi'; saved = /^\/chat\/[^/]+\/?$/.test(path); }
  else if (host === 'gemini.google.com') { family = 'gemini'; saved = /^\/app\/[^/]+\/?$/.test(path); }
  else if (host === 'grok.com') { family = 'grok'; saved = /^\/c\/[^/]+\/?$/.test(path); }
  else if (host === 'chatglm.cn') { family = 'zhipu'; }
  const feed = host === 't.bilibili.com' || (host === 'space.bilibili.com' && /^\/\d+\/dynamic\/?$/.test(path));
  return { family: family || (feed ? 'bilibili' : ''), conversation: Boolean(family), saved, feed };
}

  // Selectors are evidence-based adapters, not text/order guesses. Their
  // source/version and live-site verification boundaries accompany the patch.
  let r18NodeIds = new WeakMap(), r18NodeSequence = 0, r18IdentityUrl = '';
  function r18NodeId(node) {
    if (!r18NodeIds.has(node)) r18NodeIds.set(node, 'local-' + (++r18NodeSequence));
    return r18NodeIds.get(node);
  }
  function r18FeedRoots() {
    return [...document.querySelectorAll('.bili-dyn-list__item')].filter(eligible).filter(e => !e.parentElement?.closest('.bili-dyn-list__item'));
  }
  function r18FeedParts(root) {
    const parts = [], content = root.querySelector('.bili-dyn-item__body');
    const split = (node, forwarded = false) => {
      if (!eligible(node) || !text(node)) return;
      if (node.matches('.bili-dyn-content__orig.reference') || node.matches('.bili-dyn-content__orig') && node.querySelector('.dyn-orig-author')) forwarded = true;
      if (node.matches('.dyn-orig-author')) { parts.push({node:node.querySelector('.dyn-orig-author__name')||node,field:'forwardAuthor',forwarded:true}); return; }
      if(node.matches('.dyn-card-opus')){const summary=node.querySelector('.dyn-card-opus__summary');if(summary&&eligible(summary))parts.push({node:summary,field:'body',forwarded});return;}
      if (node.matches('.bili-dyn-card-video')) {
        const title=node.querySelector('.bili-dyn-card-video__title');
        if(title&&eligible(title))parts.push({node:title,field:'card',forwarded});return;
      }
      if(node.matches('.bili-dyn-card-courses')){const title=node.querySelector('.bili-dyn-card-courses__title');if(title&&eligible(title))parts.push({node:title,field:'card',forwarded});return;}
      if (node.querySelector('.dyn-orig-author,.bili-dyn-card-video,.bili-dyn-card-courses,.dyn-card-opus,.bili-dyn-content__orig.reference')) { for(const child of node.children)split(child,forwarded); return; }
      parts.push({node,field:'body',forwarded});
    };
    if(content)split(content);
    return parts;
  }
  function r18MessageRoots(family) {
    if (family === 'chatgpt') return chatRoots();
    const found = [], push = (root, role, content, id = '') => {
      if (!root || !content || !eligible(root) || !eligible(content) || !['user','assistant','assistant-thought'].includes(role)) return;
      found.push({ node: content, owner: root, role, id: id ? family + ':' + role + ':' + id : '', turnId: '' });
    };
    const stable = e => e.getAttribute('data-message-id') || e.id || '';
    if (family === 'deepseek') {
      for(const e of document.querySelectorAll('.ds-virtual-list-visible-items > [data-virtual-list-item-key] .ds-message')){
        const item=e.closest('[data-virtual-list-item-key]'),key=item?.getAttribute('data-virtual-list-item-key')||stable(e);
        const answer=e.querySelector('.ds-assistant-message-main-content');
        const thought=e.querySelector('.ds-think-content .ds-markdown');
        const user=e.matches('.d29f3d7d')?e.querySelector('.ds-collapsible-text'):null;
        if(user&&!answer&&!thought)push(e,'user',user,key);
        if(thought)push(e,'assistant-thought',thought,key);
        if(answer)push(e,'assistant',answer,key);
      }
    } else if (family === 'yuanbao') {
      for (const e of document.querySelectorAll('.agent-chat__list__item--human,.agent-chat__list__item--ai')) {
        const ai = e.classList.contains('agent-chat__list__item--ai');
        const content = e.querySelector(ai ? '.hyc-content-md-done,.hyc-content-md,.agent-chat__speech-text,.agent-chat__bubble__content' : '.hyc-component-text .hyc-content-text,.hyc-content-text,.agent-chat__bubble__content');
        push(e, ai ? 'assistant' : 'user', content, e.getAttribute('data-conv-id') || stable(e));
      }
    } else if (family === 'grok') {
      for (const e of document.querySelectorAll('[data-testid="user-message"],[data-testid="assistant-message"]'))
        push(e, e.getAttribute('data-testid') === 'user-message' ? 'user' : 'assistant', e, e.closest('[id^="response-"]')?.id || stable(e));
    } else if (family === 'kimi') {
      const list = document.querySelector('.chat-content-list,.message-list,.chat-detail-content');
      for (const e of list?.querySelectorAll('.chat-content-item,.segment') || []) {
        const role = e.matches('.chat-content-item-user,.segment-user') ? 'user' : e.matches('.chat-content-item-assistant,.segment-assistant') ? 'assistant' : '';
        push(e, role, e, stable(e));
      }
    } else if (family === 'doubao') {
      const list = document.querySelector('[data-testid="message-list"],[class*="message-list-"],.container-PvPoAn,.scroll-view-OEiNXD');
      const candidates = [...(list?.querySelectorAll('[data-testid="union_message"],[data-testid="message-block-container"],[class*="inner-item-"],[class*="top-item-"]') || [])].filter(eligible);
      for (const e of candidates.filter(node => !candidates.some(other => other !== node && other.contains(node)))) {
        const user = e.matches('[data-testid="send_message"],[class*="bg-g-send-msg-bubble"]') || e.querySelector('[data-testid="send_message"],[class*="bg-g-send-msg-bubble"],[data-foundation-type="send-message-action-bar"]');
        const assistant = e.matches('[data-testid="receive_message"],[class*="bg-g-receive-msg-bubble"]') || e.querySelector('[data-testid="receive_message"],[class*="bg-g-receive-msg-bubble"],[data-foundation-type="receive-message-action-bar"]') || (e.matches('[class*="inner-item-"],[class*="top-item-"]') && e.querySelector('.flow-markdown-body,.md-box-root'));
        if (user && assistant) continue;
        const content = e.querySelector('[data-testid="message_text_content"],[data-testid="message_content"],.flow-markdown-body,.md-box-root,[class*="bg-g-send-msg-bubble"],[class*="bg-g-receive-msg-bubble"]');
        push(e, user ? 'user' : assistant ? 'assistant' : '', content, stable(e));
      }
    } else if (family === 'gemini') {
      const list = document.querySelector('#chat-history,[data-test-id="chat-history-container"]');
      for (const e of list?.querySelectorAll('user-query,model-response') || []) {
        const user = e.tagName.toLowerCase() === 'user-query';
        push(e, user ? 'user' : 'assistant', e.querySelector(user ? 'user-query-content .query-text,user-query-content' : 'message-content .markdown-main-panel,message-content'), stable(e));
      }
    }
    // DOM order, never deduplicate by text: the same question can occur twice.
    return found.filter((m, i) => !found.some((other, j) => i !== j && other.node.contains(m.node)))
      .sort((a, b) => a.node === b.node ? 0 : a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  // Shared with the native selection/highlight tools. Keep every supported
  // conversation adapter on the same message boundaries; omit app navigation.
  function manualSourceRoots(){
    const site=r18SiteInfo(url());
    return site.conversation ? r18MessageRoots(site.family).map(message=>message.node) : null;
  }

  function collect(){
    const sourceUrl=url(),site=r18SiteInfo(sourceUrl),isChat=site.conversation,isFeed=site.feed,main=mainRoot();
    if(r18IdentityUrl!==sourceUrl){r18NodeIds=new WeakMap();r18NodeSequence=0;r18IdentityUrl=sourceUrl;}
    const scholarly=!!document.querySelector('meta[name="citation_doi"],meta[name="citation_journal_title"]');
    const kind=isChat?'conversation':isFeed?'article':scholarly?'paper':'article';
    const outline=[],blocks=[],map=new Map(),ids=new Map();let total=0,truncated=false,lastUser=null;
    const base={sourceUrl,kind,documentToken:token,title:document.title,loadedOnly:true,...(isChat||isFeed?{site:site.family,outlineKind:isChat?'conversation':'feed'}:{})};
    const make=(node,prefix,extra={})=>{
      const raw=text(node);if(!raw)return null;
      if(total+raw.length>2000000||blocks.length>=10000){truncated=true;return null;}
      const stable=node.id||(isChat||isFeed?r18NodeId(node):''),key=prefix+':'+(stable?'dom:'+stable:'text:'+hash(raw));const count=(ids.get(key)||0)+1;ids.set(key,count);
      const id=key+':'+count;const row={id,text:raw,sourceUrl,...(isChat||isFeed?{documentToken:token}:{}),role:extra.role||'author',...extra};
      total+=raw.length;map.set(id,{node,row,uniqueKey:key,stable:Boolean(stable||extra.messageId)});return row;
    };
    function body(node,prefix,role,turnId,messageId,parentId){
      const sectionStack=[];let sectionId=parentId||'';
      let nodes=Array.from(node.querySelectorAll(headingSelector+',p,li,pre,table,blockquote')).filter(eligible);
      nodes=nodes.filter(e=>{
        if(e.closest('pre,table,blockquote')!==e&&e.closest('pre,table,blockquote')&&node.contains(e.closest('pre,table,blockquote')))return false;
        if(e.matches('li')&&e.querySelector('p,li'))return false;
        return true;
      });
      if(!nodes.length&&text(node))nodes=[node];
      for(const e of nodes){
        const isHeading=e.matches(headingSelector),level=Number(e.getAttribute('aria-level')||e.tagName.slice(1))||2;
        if(isHeading){while(sectionStack.length&&sectionStack.at(-1).level>=level)sectionStack.pop();}
        const row=make(e,prefix,{role,turnId,messageId,sectionId,sectionPath:[...(parentId?[parentId]:[]),...sectionStack.map(h=>h.id)]});if(!row)continue;
        if(isHeading){
          const h={...row,title:row.text,level:kind==='conversation'?Math.min(6,level+2):level,parentId:sectionStack.at(-1)?.id||parentId||null};
          outline.push(h);sectionId=h.id;sectionStack.push({id:h.id,level});row.sectionId=h.id;row.sectionPath=[...(parentId?[parentId]:[]),...sectionStack.map(h=>h.id)];
        }
        blocks.push(row);
      }
    }
    if(isChat){
      for(const m of r18MessageRoots(site.family)){
        const raw=text(m.node);if(!raw)continue;
        const messageId=m.id||site.family+':'+m.role+':'+r18NodeId(m.owner||m.node);if(m.role==='user')lastUser={id:'message:'+messageId,turnId:m.turnId||messageId};
        const turnId=m.turnId||lastUser?.turnId||messageId,id='message:'+messageId;
        const title=m.role==='user'?'提问：'+raw.replace(/\s+/g,' ').slice(0,100):m.role==='assistant-thought'?'思考（AI生成）':'回答（AI生成）';
        const row={id,title,text:raw,role:m.role,sourceUrl,documentToken:token,messageId,turnId,level:m.role==='user'?1:2,parentId:m.role!=='user'?lastUser?.id||null:null};
        outline.push(row);map.set(id,{node:m.node,row,uniqueKey:id,stable:Boolean(m.id)});
        body(m.node,id,m.role,turnId,messageId,id);
      }
    }else if(isFeed){
      const seen=new Set();
      for(const root of r18FeedRoots()){
        const postId=root.getAttribute('data-did')||'node:'+r18NodeId(root);if(seen.has(postId))continue;seen.add(postId);
        const authorNode=root.querySelector('.bili-dyn-item__header .bili-dyn-title__text'),timeNode=root.querySelector('.bili-dyn-item__header .bili-dyn-time');
        const author=authorNode&&eligible(authorNode)?text(authorNode):'',postedAt=timeNode&&eligible(timeNode)?text(timeNode):'';
        const parts=r18FeedParts(root);if(!author&&!parts.length)continue;
        const id='dynamic:'+postId,raw=text(root),row={id,title:[author||'动态',postedAt].filter(Boolean).join(' · '),text:raw,author,postedAt,postId,role:'author',sourceUrl,documentToken:token,level:1,parentId:null};
        outline.push(row);map.set(id,{node:root,row,uniqueKey:id,stable:true});
        for(const [index,part] of parts.entries()){
          const child=make(part.node,id+':'+part.field,{role:part.forwarded?'forwarded-author':'author',postId,sectionId:id,sectionPath:[id]});if(!child)continue;
          const label=part.field==='forwardAuthor'?'转发来源：':part.field==='card'?'卡片：':part.forwarded?'转发正文：':'正文：';
          outline.push({...child,title:label+child.text.replace(/\s+/g,' ').slice(0,140),field:part.field,level:2,parentId:id});blocks.push(child);
        }
      }
    }else if(main){body(main,'article','author','','',null);}
    for(const entry of map.values())entry.ambiguous=!entry.stable&&ids.get(entry.uniqueKey)>1;
    const images=Array.from(new Set((isFeed?r18FeedRoots():isChat?r18MessageRoots(site.family).map(m=>m.node):[main||document.body]).flatMap(root=>Array.from(root.querySelectorAll('img'))))).filter(eligible).map((node,i)=>{const src=node.currentSrc||node.src;if(!/^https?:|^data:image\//.test(src))return null;const row={id:'image:'+hash(src)+':'+i,src,title:node.alt||'图片 '+(i+1),caption:text(node.closest('figure')?.querySelector('figcaption'))||node.alt||'',sourceUrl};map.set(row.id,{node,row,stable:true});return row;}).filter(Boolean);
    refs=map;
    return{...base,outline,blocks,images,truncated,revision:hash(JSON.stringify(isChat||isFeed?[blocks.map(b=>[b.id,b.text]),outline.map(r=>[r.id,r.title,r.text,r.parentId])]:blocks.map(b=>[b.id,b.text]))),adapterStatus:isChat?(outline.length?'matched':'unrecognized'):'generic',reason:kind==='conversation'?(outline.length?'仅当前会话已加载的提问与回答；未加载历史不在范围内':'当前站点消息结构尚未识别；没有将页面标题冒充对话'):blocks.length?'本地原生内容；不自动调用模型':'当前未发现可读取的正文',selection:null};
  }
  function position(){
    const source=cached;if(!source)return null;
    let best=null;
    for(const row of source.outline){const e=refs.get(row.id)?.node;if(!e?.isConnected)continue;const y=e.getBoundingClientRect().top;if(y<=130)best=row.id;else if(!best){best=row.id;break;}else break;}
    return best;
  }
  function selection(){
    const s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return null;
    const parent=n=>n?.nodeType===1?n:n?.parentElement;
    if(!parent(s.anchorNode)||!eligible(parent(s.anchorNode))||!eligible(parent(s.focusNode)))return null;
    const chosen=s.toString();if(!chosen.trim()||chosen.length>120000)return null;
    const matches=cached.blocks.filter(b=>{const e=refs.get(b.id)?.node;return e?.contains(s.anchorNode)&&e.contains(s.focusNode)&&b.text.includes(chosen);});
    if(matches.length===1)return{blockId:matches[0].id,text:chosen};
    const selected=s.getRangeAt(0),parts=[];
    for(const b of cached.blocks){const e=refs.get(b.id)?.node;if(!e||!eligible(e)||!selected.intersectsNode(e))continue;
      const segment=document.createRange();segment.selectNodeContents(e);
      if(e.contains(selected.startContainer))segment.setStart(selected.startContainer,selected.startOffset);
      if(e.contains(selected.endContainer))segment.setEnd(selected.endContainer,selected.endOffset);
      const exact=segment.toString();if(exact.trim()&&b.text.includes(exact))parts.push({blockId:b.id,text:exact});
    }
    return parts.length?{parts,text:parts.map(p=>p.text).join('\n\n')}:null;
  }
  let annotations=[];
  function textNodes(node){const nodes=[],walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);while(walker.nextNode())if(eligible(walker.currentNode.parentElement))nodes.push(walker.currentNode);return nodes;}
  function rangeAt(node,start,end){const nodes=textNodes(node),range=document.createRange();let offset=0,started=false;for(const n of nodes){const next=offset+n.length;if(!started&&start<next){range.setStart(n,start-offset);started=true;}if(started&&end<=next){range.setEnd(n,end-offset);return range;}offset=next;}return null;}
  function anchorMatches(anchor){
    if(anchor.sourceUrl!==url()||typeof anchor.quote!=='string'||!anchor.quote)return[];
    const found=[];
    for(const b of cached.blocks){const entry=refs.get(b.id);if(!entry?.node?.isConnected)continue;const raw=textNodes(entry.node).map(n=>n.data).join('');let from=0,index;
      while((index=raw.indexOf(anchor.quote,from))>=0){const range=rangeAt(entry.node,index,index+anchor.quote.length);if(range)found.push({range,node:entry.node,context:(!anchor.prefix||raw.slice(Math.max(0,index-anchor.prefix.length),index)===anchor.prefix)&&(!anchor.suffix||raw.slice(index+anchor.quote.length,index+anchor.quote.length+anchor.suffix.length)===anchor.suffix),stable:!!anchor.domId&&entry.node.id===anchor.domId||!!anchor.messageId&&b.messageId===anchor.messageId});from=index+Math.max(1,anchor.quote.length);}
    }
    const contextual=found.filter(x=>x.context),stable=contextual.filter(x=>x.stable);return stable.length?stable:contextual.length?contextual:found;
  }
  function paint(){const ranges=[],results=[];for(const a of annotations){const matches=anchorMatches(a),found=matches.length===1;if(found)ranges.push(matches[0].range);results.push({id:a.id,found,reason:found?'':matches.length?'原句有多处相同位置，请重新定位':'当前已加载内容中未找到原句'});}if(globalThis.Highlight&&CSS.highlights){let style=document.getElementById('brevess-web-annotations-style');if(!style){style=document.createElement('style');style.id='brevess-web-annotations-style';style.textContent='::highlight(brevess-web-annotations){background:#ffe89b;color:inherit}';document.head.append(style);}CSS.highlights.set('brevess-web-annotations',new Highlight(...ranges));}return results;}
  async function capture(){await read();const selected=selection();if(!selected)throw Error('SELECTION_STALE');return(selected.parts||[selected]).map(part=>{const b=cached.blocks.find(b=>b.id===part.blockId),node=refs.get(part.blockId)?.node,raw=textNodes(node).map(n=>n.data).join(''),index=raw.indexOf(part.text);if(index<0||raw.indexOf(part.text,index+1)>=0)throw Error('WEB_ANCHOR_AMBIGUOUS');return{id:crypto.randomUUID(),sourceUrl:url(),quote:part.text,prefix:raw.slice(Math.max(0,index-48),index),suffix:raw.slice(index+part.text.length,index+part.text.length+48),blockId:part.blockId,domId:node.id||'',messageId:b.messageId||'',note:'',createdAt:new Date().toISOString()};});}
  async function restore(items){await read();annotations=Array.isArray(items)?items:[];return paint();}
  async function locateAnchor(anchor){await read();const matches=anchorMatches(anchor);if(matches.length!==1)return{found:false,reason:matches.length?'原句有多处相同位置，请重新定位':'当前已加载内容中未找到原句'};matches[0].node.scrollIntoView({behavior:'smooth',block:'center'});return{found:true};}
  function redactSnapshot(html){if(typeof html!=='string'||html.length>100000000)throw Error('WEB_SNAPSHOT_INVALID');const doc=new DOMParser().parseFromString(html,'text/html');for(const e of doc.querySelectorAll('[data-brevess-export-snapshot-version],.brevess-static-note-link,[data-sci-translation]'))e.remove();for(const e of doc.querySelectorAll('.sci-highlight,.sci-llm-highlight,.sci-manual-highlight,[data-annotation-id]'))e.replaceWith(...e.childNodes);return'<!doctype html>\n'+doc.documentElement.outerHTML;}
  async function read(){if(dirty||cached?.sourceUrl!==url()){cached=collect();dirty=false;if(annotations.length)paint();}renew();return{...cached,selection:selection(),currentId:position()};}
  async function locate(ref){
    await read();if(!ref||ref.sourceUrl!==cached.sourceUrl||ref.documentToken&&ref.documentToken!==token)return{found:false,reason:'来源页面已改变；保留原引用'};
    const entry=refs.get(ref.id);if(!entry||!entry.node.isConnected||entry.ambiguous)return{found:false,reason:'原文不在当前加载内容中，或存在重复来源'};
    if(ref.src){if(entry.row.src!==ref.src)return{found:false,reason:'图片来源已变化'};entry.node.scrollIntoView({behavior:'smooth',block:'center'});return{found:true};}
    const expected=ref.sourceText??ref.text??ref.title;if(expected&&text(entry.node)!==expected)return{found:false,reason:'原消息或段落已编辑；保留原引用，未跳转到其他内容'};
    entry.node.scrollIntoView({behavior:'smooth',block:'center'});
    try{const range=document.createRange();range.selectNodeContents(entry.node);if(globalThis.Highlight&&CSS.highlights){let style=document.getElementById('brevess-web-source-style');if(!style){style=document.createElement('style');style.id='brevess-web-source-style';style.textContent='::highlight(brevess-web-source){background:#ffe89b;color:inherit}';document.head.append(style);}CSS.highlights.set('brevess-web-source',new Highlight(range));setTimeout(()=>CSS.highlights.delete('brevess-web-source'),1400);}}catch(_){}
    return{found:true,id:ref.id};
  }
  let positionTimer=null;
  function positionChanged(){clearTimeout(positionTimer);positionTimer=setTimeout(()=>{if(cached)chrome.runtime.sendMessage({type:'BREVESS_WEB_READING_CHANGED',documentToken:token,sourceUrl:url(),position:true,currentId:position()}).catch(()=>stop());},200);}
  function stop(){observer?.disconnect();observer=null;clearTimeout(lease);clearTimeout(debounce);clearTimeout(positionTimer);document.removeEventListener('scroll',positionChanged,true);}
  function renew(){
    if(!globalThis.chrome?.runtime?.id)return;
    clearTimeout(lease);lease=setTimeout(stop,90000);
    if(observer)return;
    document.addEventListener('scroll',positionChanged,{capture:true,passive:true});
    observer=new MutationObserver(records=>{
      if(!records.some(r=>!r.target?.parentElement?.closest(excluded)))return;
      dirty=true;clearTimeout(debounce);debounce=setTimeout(()=>chrome.runtime.sendMessage({type:'BREVESS_WEB_READING_CHANGED',documentToken:token,sourceUrl:url()}).catch(()=>stop()),450);
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['id','data-did','data-conv-id','data-virtual-list-item-key','data-testid','data-foundation-type','data-message-author-role','data-turn-key','data-chatgpt-search-unit-key','data-message-id','data-chatgpt-selection-message-id','data-chatgpt-search-message-ids','hidden','aria-hidden','style','class']});
  }
  // Local tests can call read/locate directly; the real content endpoint only
  // serves the extension's background, never website postMessage events.
  if(globalThis.chrome?.runtime?.id)chrome.runtime.onMessage.addListener((m,sender,respond)=>{
    if(m?.type!=='BREVESS_WEB_READING_PAGE'||sender.id!==chrome.runtime.id)return false;
    const job=m.command==='READ'?read():m.command==='LOCATE'?locate(m.ref):m.command==='CAPTURE'?capture():m.command==='RESTORE'?restore(m.annotations):m.command==='ANCHOR'?locateAnchor(m.anchor):m.command==='REDACT_SNAPSHOT'?Promise.resolve(redactSnapshot(m.html)):m.command==='STOP'?Promise.resolve(stop()):Promise.reject(Error('WEB_PAGE_COMMAND'));
    Promise.resolve(job).then(data=>respond({success:true,data}),e=>respond({success:false,error:String(e.message)}));return true;
  });
  // Pure DOM tests do not have chrome, but still need mutation invalidation.
  if(!globalThis.chrome?.runtime?.id){observer=new MutationObserver(()=>{dirty=true;});observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});}
  globalThis.BrevessWebReadingPage={version:5,read,locate,stop,capture,restore,locateAnchor,redactSnapshot,manualSourceRoots};
})();
