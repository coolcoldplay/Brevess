/* One language boundary for the website, lazy native views and nested frames. */
(() => {
 'use strict';
 const native=Boolean(window.__websiteDemo),catalog={...window.BV_DEMO_TRANSLATIONS};
 let language=document.documentElement.lang==='en'?'en':'zh-CN';
 try{if(parent!==window)language=parent.document.documentElement.lang==='en'?'en':'zh-CN';}catch{}
 const reverse=new Map(),sources=new WeakMap();let applied=false,active=!native;
 const canonical=value=>reverse.get(value)||value;
 const text=(value,lang=language)=>{
  const source=canonical(String(value??''));
  return lang==='en'?(catalog[source]||window.SciLLM?.translateInterfaceText?.(source,'en')||source):source;
 };
 const pick=values=>Array.isArray(values)?values[language==='en'&&values[1]?1:0]:values;
 function register(entries){Object.assign(catalog,entries);for(const [zh,en] of Object.entries(entries))if(en&&!reverse.has(en))reverse.set(en,zh);window.SciLLM?.registerInterfaceTranslations?.(entries);}
 register(catalog);
 const templates=[
  ['{0}：单击定位 · 双击解图 · 长按 0.5 秒查看原图/核对 PDF 页码；图片加载另行提示；键盘 Enter / Shift+Enter / Alt+Enter','{0}: click to locate; double-click to analyze; hold for 0.5 seconds to view the original or check PDF pages. Keys: Enter / Shift+Enter / Alt+Enter'],
  ['{0}：Selected; click to deselect, double-click or Shift+Enter to generate this field','{0}: selected; click to deselect, double-click or Shift+Enter to generate',[0]],
  ['{0}：Not selected; click to select, double-click or Shift+Enter to generate this field','{0}: not selected; click to select, double-click or Shift+Enter to generate',[0]],
  ['已激活 · {0} · 网页滤镜','Active · {0} · Page filter'],['{0} · 完整正文','{0} · Full text'],
  ['{0} / {1} 篇','{0} / {1} papers'],['添加日期：{0}','Date added: {0}'],
  ['添加 Figure 到 {0}','Add a figure to {0}'],['选择 {0}','Select {0}'],['编辑 {0} 的旧标签','Edit legacy tags for {0}'],
  ['放大查看 Figure {0}','Enlarge Figure {0}'],['正则已匹配 {0} 处，可切换短语或整句','{0} regex matches; switch between terms and whole sentences'],
  ['已展示 {0} 处预置语义高亮；未调用在线模型','Showing {0} prepared semantic highlights; no online model was called'],
  ['正则匹配 · {0} 处','Regex matches · {0}'],['预置语义高亮 · {0} 处','Prepared semantic highlights · {0}'],
  ['范围为本页展示的 {0} 段内容。','Search covers the {0} passages displayed on this page.'],
  ['{0} 项缩略词示例；可编辑或补齐空白释义。','{0} example abbreviations; edit or fill blank definitions.'],
  ['已加入本页缩略词表：{0}','Added to this page’s abbreviations: {0}']
 ];
 if(window.SciLLM?.compileInterfaceTemplate)SciLLM.registerInterfaceTranslations({},templates.map(pair=>SciLLM.compileInterfaceTemplate(pair)));
 const d=window.BV_DEMO_DATA;
 if(d){const pairs={};for(const p of d.paragraphs||[])if(p.summary?.[1])pairs[p.summary[0]]=p.summary[1];for(const f of d.figures||[]){if(f.takeaway?.[1])pairs[f.takeaway[0]]=f.takeaway[1];for(const row of f.panels||[])if(row[3]){pairs[row[1]]=row[3];pairs[row[2]]=row[4];}}for(const q of d.questions||[])for(const key of ['q','answer','details'])if(q[key]?.[1])pairs[q[key][0]]=q[key][1];register(pairs);}
 const scope='#reading-demo,#workbench-demo,#web-demo,.deck-nav,.bv-mobile-shell,[id^="sci-"],[class^="sci-"],.bv-image-dialog,.bv-table-dialog';
 const ignored='script,style,pre,code,textarea,[contenteditable], [translate="no"],[data-i18n-ignore],[data-paragraph],#web-source-content,.chat-question,.equation-cn,[data-en]';
 function localize(node){
  if(native||!node||node.nodeType===3&&node.parentElement?.closest(ignored))return;
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let item=node;
  while(item){
   const el=item.nodeType===3?item.parentElement:item;
   if(el?.closest?.(scope)&&!el.closest(ignored)){
    if(item.nodeType===3){
     const current=item.nodeValue,trim=current.trim();
     if(trim){let record=sources.get(item);if(!record||current!==record.last)record={source:canonical(trim),last:current};const next=current.replace(trim,text(record.source));record.last=next;sources.set(item,record);if(current!==next)item.nodeValue=next;}
    }else for(const attr of ['aria-label','title','placeholder','alt'])if(item.hasAttribute?.(attr)){const current=item.getAttribute(attr),next=text(current);if(next!==current)item.setAttribute(attr,next);}
   }
   item=walker.nextNode();
  }
 }
 function send(frame){try{if(frame.contentWindow&&frame.getAttribute('src'))frame.contentWindow.postMessage({source:'brevess-website',type:'language',language},location.origin);}catch{}}
 function set(value){
  const next=value==='en'?'en':'zh-CN';
  if(!active){language=next;return;}
  if(applied&&next===language&&(!native||SciLLM.getInterfaceLanguage?.()===next))return;
  applied=true;language=next;document.documentElement.lang=language;
  if(window.__websiteDemo?.profile?.settings)__websiteDemo.profile.settings.language=language;
  window.SciLLM?.setInterfaceLanguage?.(language,native?document:null);
  localize(document.documentElement);
  document.querySelectorAll('iframe').forEach(send);
  document.dispatchEvent(new CustomEvent('brevess-demo-languagechange',{detail:{language}}));
 }
 function activate(){active=true;applied=false;set(language);}
 window.BV_I18N={text,pick,register,set,activate,get language(){return language;}};
 addEventListener('message',e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.source==='brevess-website'&&e.data.type==='language')set(e.data.language);});
 document.addEventListener('brevess-languagechange',()=>set(document.documentElement.lang));
 document.addEventListener('load',e=>{if(e.target.tagName==='IFRAME')send(e.target);},true);
 if(!native){
  const observer=new MutationObserver(records=>{for(const r of records){if(!r.target.isConnected)continue;if(r.type==='characterData'||r.type==='attributes')localize(r.target);else r.addedNodes.forEach(n=>{if(n.isConnected)localize(n);});}});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','placeholder','alt']});
  // Clicks inside a nested web preview do not bubble to the surrounding page.
  if(parent!==window)document.addEventListener('pointerdown',()=>parent.postMessage({source:'brevess-native-demo',type:'pointerdown'},location.origin),true);
 }
 set(language);
 if(native&&!/\/(?:popup\.html|workbench\/index\.html)$/.test(location.pathname))addEventListener('load',activate,{once:true});
})();
