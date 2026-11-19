/* Complete public repository snapshot and authorized conversation. No live accounts. */
(() => {
 const repo='https://github.com/coolcoldplay/Brevess';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
 async function get(url){const r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('暂时无法读取演示素材（'+r.status+'）。');return r.json();}
 function safeHtml(html){
  const parsed=new DOMParser().parseFromString(html,'text/html');
  const allowed=new Set('ARTICLE DIV SPAN P H1 H2 H3 H4 H5 H6 A IMG STRONG B EM I S DEL CODE PRE UL OL LI TABLE THEAD TBODY TR TH TD BLOCKQUOTE HR BR DETAILS SUMMARY FIGURE FIGCAPTION KBD SUP SUB'.split(' '));
  const url=(value,image)=>{try{if(image){if(value==='extension/icons/Brevess-logo.svg')return new URL('../site/logo.svg',document.baseURI).href;if(value.startsWith('docs/assets/'))return new URL('../'+value.slice('docs/assets/'.length),document.baseURI).href;}const u=new URL(value,repo+'/blob/main/');return /^https?:$/.test(u.protocol)||(!image&&u.protocol==='mailto:')?u.href:'';}catch{return '';}};
  function clone(n){if(n.nodeType===3)return document.createTextNode(n.textContent);if(n.nodeType!==1)return document.createTextNode('');if(['SCRIPT','STYLE','IFRAME','FORM','INPUT','BUTTON','OBJECT','EMBED','SVG'].includes(n.tagName))return document.createTextNode('');const out=allowed.has(n.tagName)?document.createElement(n.tagName.toLowerCase()):document.createElement('span');
   if(n.tagName==='A'){const href=url(n.getAttribute('href')||'',false);if(href){out.href=href;out.target='_blank';out.rel='noopener noreferrer';}if(n.classList.contains('anchor'))return document.createTextNode('');}
   if(n.tagName==='IMG'){out.src=url(n.getAttribute('src')||'',true);out.alt=n.getAttribute('alt')||'';out.loading='lazy';out.referrerPolicy='no-referrer';if(/^\d+$/.test(n.getAttribute('width')||''))out.width=Number(n.getAttribute('width'));}
   if(['TH','TD'].includes(n.tagName))for(const a of ['colspan','rowspan'])if(/^\d+$/.test(n.getAttribute(a)||''))out.setAttribute(a,n.getAttribute(a));
   if(n.getAttribute('align')==='center')out.classList.add('source-centered');
   if(n.classList.contains('markdown-heading'))out.classList.add('markdown-heading');
   out.append(...[...n.childNodes].map(clone));return out;
  }
  const result=el('div','source-markdown');result.append(...[...(parsed.querySelector('article')||parsed.body).childNodes].map(clone));return result;
 }
 function corpus(content,d){
  const nodes=[],paragraphs=[];let current=null;
  for(const n of content.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote')){
   const text=n.textContent.trim();if(!text||n.querySelector('p,li,td,th,blockquote'))continue;
   const heading=/^H[1-6]$/.test(n.tagName),id=paragraphs.length?'p'+paragraphs.length:'overview';
   n.id='bv-'+id;n.dataset.paragraph=id;
   if(heading||!current){current={sectionId:id,title:text,level:heading?Number(n.tagName.slice(1)):1,order:nodes.length,children:[],paragraphCount:0,analysisSectionIds:[],analysisSelected:true};if(!heading)current.title=d.web==='chatgpt'?'回答':'README';nodes.push(current);}
   current.paragraphCount++;current.analysisSectionIds.push(id);
   paragraphs.push({id,heading:current.title,sectionId:current.sectionId,text:n.textContent,zh:'',summary:[n.textContent]});
  }
  const roots=[],stack=[];for(const node of nodes){while(stack.length&&stack.at(-1).level>=node.level)stack.pop();(stack.length?stack.at(-1).children:roots).push(node);stack.push(node);}
  d.paragraphs=paragraphs;d.outline=roots;
  const opening=paragraphs.find(p=>p.text.length>65&&!/^#/.test(p.text));d.sampleId=opening?.id||paragraphs[0]?.id;
  if(d.web==='chatgpt'&&opening)opening.zh='After reviewing the repository, I think BREVESS’s strongest advantage is connecting figure-by-figure paper reading, evidence checking, mechanism mapping, hypothesis building and experimental figure planning into a workflow that supports continuous accumulation and human revision. This direction has clear value for researchers reading mechanistic papers, preparing journal clubs, writing proposals and designing experiments.';
  if(d.web==='github')for(const p of paragraphs){if(p.text.trim()==='快速凝练真实、有用的信息，构建知识结构，推动科学研究。')p.zh='Quickly distill reliable, useful information, build a structure of knowledge, and advance scientific research.';if(p.text.includes('Manual and AI-assisted reading'))p.zh='人工阅读与 AI 辅助相结合，从论文与证据走向假说与组图规划。';}
  if(d.web==='github')d.sampleId=paragraphs.find(p=>p.zh)?.id||d.sampleId;
 }
 window.BVLoadWebSource=async kind=>{
  const d={web:kind,source:kind==='github'?repo:'https://chatgpt.com/',publisher:kind==='github'?'GitHub':'ChatGPT'};
  let content,meta={};
  if(kind==='github'){
   const snapshot=await get('github-repository.json');
   content=safeHtml(snapshot.readmeHtml);d.title=snapshot.title;meta=snapshot.meta;
  }else{
   const chat=await get('chatgpt-conversation.json');d.title=chat.title;d.prompt=chat.prompt;d.originalMarkdown=chat.markdown;
   const markdown=chat.markdown.replace(/:chatgpt-content-reference\{index="(\d+)"\}/g,(_,n)=>'〔来源 '+(Number(n)+1)+'〕');
   content=el('div','source-markdown');content.append(BrevessChatMessageUI.createRenderer().renderArticleChatMarkdown(markdown));
   const headings=[...chat.markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)];
   [...content.querySelectorAll('h3,h4')].forEach((h,i)=>{if(!headings[i])return;const real=el('h'+headings[i][1].length);real.append(...h.childNodes);h.replaceWith(real);});
  }
  corpus(content,d);if(!d.paragraphs.length)throw Error('来源正文尚未就绪，请重试。');
  return {data:window.BVPrepareWebData(d),content,meta};
 };
})();
