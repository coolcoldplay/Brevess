/* Website-only data boundary around the shipping selection, search and sidebar UI. */
(async () => {
 const root=document.getElementById('web-demo'),kind=new URLSearchParams(location.search).get('web')==='chatgpt'?'chatgpt':'github';
 const sourceLink=web=>location.pathname+'?web='+web;
 let loaded;try{loaded=await BVLoadWebSource(kind);}catch(error){root.innerHTML='<div class="web-error"><h2>暂时无法载入网页</h2><p></p><button type="button">重新读取</button><a href="'+sourceLink('chatgpt')+'">查看 ChatGPT 对话</a></div>';root.querySelector('p').textContent=error.message;root.querySelector('button').onclick=()=>location.reload();return;}
 const d=window.BV_DEMO_DATA=loaded.data,chrome=BVWebChrome(d,loaded.meta);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pick=values=>BV_I18N.pick(values);
 const isChat=d.web==='chatgpt';let timer,readerTools,lastAnnotations={items:[]};
 window.__bvPageTools={supported:true,preferences:{selection:true,semantic:true,pageTranslation:true},translation:{enabled:false,phase:'idle'}};
 root.dataset.view='paper';
 root.innerHTML=`<div class="web-toolbar"><nav class="web-tabs" aria-label="切换示例网页"><a href="${sourceLink('github')}" ${!isChat?'aria-current="page"':''}>GitHub</a><a href="${sourceLink('chatgpt')}" ${isChat?'aria-current="page"':''}>ChatGPT</a></nav><span class="web-preview">${isChat?'完整对话':'仓库演示'}</span><button class="web-restart" aria-label="重新开始当前体验" data-action="reset">↻</button></div><div class="web-tools"><button data-action="sample">试试划句</button><button data-action="search">语义检索</button><button data-action="translate">翻译正文</button></div><div class="web-mobile"><button data-view="paper" aria-pressed="true">网页原文</button><button data-view="sidebar" aria-pressed="false">BREVESS 侧栏</button></div><div class="web-layout"><div class="web-reader ${d.web}">${chrome.rail}<div class="web-reader-main">${chrome.header}<article class="bv-paper ${d.web}" tabindex="0" aria-label="${isChat?'完整 ChatGPT 对话':'GitHub 仓库演示与完整 README'}，可选择文字"><div class="web-content">${chrome.before}<div id="web-source-content"></div>${chrome.after}</div></article>${chrome.composer}</div></div><aside class="bv-sidebar"><div class="web-brand"><img src="../site/logo.svg" alt="">BREVESS <span class="web-ready" role="status">正在加载</span></div><div class="web-suggestions" aria-label="示例网页问题">${d.questions.map((q,i)=>`<button data-question="${i}" disabled>${pick(q.q)}</button>`).join('')}</div><iframe id="web-sidebar" title="BREVESS 真实网页阅读侧栏" src="${document.documentElement.hasAttribute('data-bv-fast')?'fast':'native'}/popup.html?web=${d.web}&v=20261119-ui11"></iframe></aside></div><div class="web-guide"><strong>试着选中一句话</strong><p>翻译、高亮、备注。底部单击切换模块，双击启动 AI 示例。</p><button data-action="dismiss">开始体验</button></div><div class="web-toast" role="status" hidden></div>`;
 root.querySelector('#web-source-content').append(loaded.content);
 root.querySelector('.web-toolbar').append(root.querySelector('.web-tools'));
 if(isChat){const q=root.querySelector('.chat-question');q.id='bv-prompt';q.dataset.paragraph='prompt';d.paragraphs.unshift({id:'prompt',heading:'提问',sectionId:'prompt',text:q.textContent,zh:'Read the BREVESS repository and explain its advantages over similar products.',summary:[]});d.outline.unshift({sectionId:'prompt',title:'提问：'+d.prompt,level:1,children:[],paragraphCount:1,analysisSectionIds:['prompt'],analysisSelected:true});}
 const paper=root.querySelector('.bv-paper'),sidebar=root.querySelector('#web-sidebar');
 const send=(type,data={})=>sidebar.contentWindow.postMessage({source:'brevess-website',type,...data},location.origin);
 function toast(text){clearTimeout(timer);const el=root.querySelector('.web-toast');el.textContent=text;el.hidden=false;timer=setTimeout(()=>el.hidden=true,4000);}
 const dismiss=()=>root.querySelector('.web-guide').hidden=true;
 function view(v){if(v==='sidebar')reading.close();root.dataset.view=v;root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===v)));}
 function jump(id){dismiss();reading.close();view('paper');const el=root.querySelector('#bv-'+id)||root.querySelector('[data-paragraph="'+id+'"]');if(!el)return;paper.scrollTo({top:paper.scrollTop+el.getBoundingClientRect().top-paper.getBoundingClientRect().top-(isChat?65:22),behavior:'instant'});el.classList.remove('web-flash');requestAnimationFrame(()=>el.classList.add('web-flash'));}
 const reading=BVCreateReadingDemo({root,data:d,onToast:toast,onPaint:()=>readerTools?.refresh(),onAbbreviation:entry=>send('abbreviation-add',{entry}),onChange:state=>{lastAnnotations=state;send('annotations',state);}});
 readerTools=BVCreateReaderTools({root,data:d,reading,onToast:toast,onView:view});
 function sample(){dismiss();const id=d.sampleId,p=root.querySelector('[data-paragraph="'+id+'"]'),text=d.paragraphs.find(x=>x.id===id).text;jump(id);reading.open([{p:id,start:0,end:text.length}],p.getBoundingClientRect());}
 function offset(p,node,o){const r=document.createRange();r.selectNodeContents(p);r.setEnd(node,o);return r.toString().length;}
 function selection(){const s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;const r=s.getRangeAt(0);if(!paper.contains(r.startContainer)||!paper.contains(r.endContainer))return;const parts=[];for(const p of paper.querySelectorAll('[data-paragraph]'))if(r.intersectsNode(p)){const start=p.contains(r.startContainer)?offset(p,r.startContainer,r.startOffset):0,end=p.contains(r.endContainer)?offset(p,r.endContainer,r.endOffset):p.textContent.length;if(end>start)parts.push({p:p.dataset.paragraph,start,end});}if(parts.length){dismiss();reading.open(parts,r.getBoundingClientRect());}}
 paper.addEventListener('pointerup',()=>setTimeout(selection,0));paper.addEventListener('keyup',e=>{if(e.shiftKey)selection();});paper.addEventListener('wheel',()=>reading.close(),{passive:true});
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.view){dismiss();view(b.dataset.view);}if(b.dataset.question){dismiss();view('sidebar');send('ask',{question:pick(d.questions[Number(b.dataset.question)].q)});}switch(b.dataset.action){case'dismiss':dismiss();break;case'sample':sample();break;case'search':dismiss();readerTools.openSearch();break;case'translate':dismiss();readerTools.translate();break;case'reset':location.reload();break;}});
 root.querySelector('.chat-composer form')?.addEventListener('submit',e=>{e.preventDefault();const input=e.target.querySelector('input');dismiss();view('sidebar');send('ask',{question:input.value.trim()||pick(d.questions[0].q)});input.value='';});
 root.addEventListener('click',async e=>{const action=e.target.closest('[data-action]')?.dataset.action;
  if(action==='chat-menu'){const drawer=root.querySelector('.chat-drawer');drawer.hidden=!drawer.hidden;}
  if(action==='chat-copy'){try{await navigator.clipboard.writeText(d.originalMarkdown);toast('已复制完整回答');}catch{toast('浏览器未允许复制，请选择正文复制。');}}
  if(action==='share'){try{await navigator.clipboard.writeText(new URL('../../#beyond-papers',document.baseURI).href);toast('已复制体验链接');}catch{toast('请复制浏览器地址栏中的官网链接。');}}
  if(action==='chat-speak'){if(speechSynthesis.speaking){speechSynthesis.cancel();return;}const speech=new SpeechSynthesisUtterance(d.paragraphs.map(p=>p.text).join('。'));speech.lang='zh-CN';speechSynthesis.speak(speech);}
  if(action==='chat-open')window.open('https://chatgpt.com/','_blank','noopener');
  if(action==='chat-model'||action==='feedback')toast('这是完整对话的阅读预览，可在 BREVESS 侧栏继续提问。');
  if(action==='chat-followup'){view('sidebar');send('ask',{question:pick(d.questions[0].q)});}
 });
 addEventListener('keydown',e=>{if(e.key==='Escape'){reading.close();dismiss();}readerTools.keydown(e);});
 addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==sidebar.contentWindow||e.data?.source!=='brevess-native-demo')return;
  const m=e.data;
  if(m.type==='ready'){send('language',{language:document.documentElement.lang});root.dataset.ready='true';root.querySelector('.web-ready').textContent='已激活';root.querySelectorAll('[data-question]').forEach(b=>b.disabled=false);reading.sync();}
  if(m.type==='jump')jump(m.id);
  if(m.type==='toast')toast(m.message);
  if(m.type==='highlight-config')reading.configure(m.config);
  if(m.type==='highlight-clear')reading.clear(m.target);
  if(m.type==='highlight-visibility')reading.setVisibility(m.sources);
  if(m.type==='highlight-run'){dismiss();reading.configure(m.config);const count=m.engine==='regex'?reading.runRegex():reading.runLlm();send('highlight-complete',{engine:m.engine,count});const hit=lastAnnotations.items.find(a=>a.source===m.engine);if(hit)jump(hit.p);toast((m.engine==='regex'?'正则匹配':'预置语义高亮')+' · '+count+' 处');}
  if(m.type==='annotation'){const a=reading.find(m.id);if(a){jump(a.segments[0].p);const mark=root.querySelector('[data-demo-annotation="'+a.id+'"]');if(mark)reading.openAnnotation(a.id,mark);}}
  if(m.type==='generated')toast('示例已生成，可继续阅读、展开和编辑');
  if(m.type==='module'&&root.dataset.ready==='true')dismiss();
  if(m.type==='save')toast('此体验中的备注与生成内容保留在当前页面；安装插件后可保存到本地文件夹。');
  if(m.type==='install')parent.postMessage({source:'brevess-web-demo',type:'install'},location.origin);
 });
 document.addEventListener('brevess-demo-languagechange',()=>root.querySelectorAll('[data-question]').forEach(b=>b.textContent=pick(d.questions[Number(b.dataset.question)].q)));
 window.BV_WEB_API={reading,readerTools,jump,sample,send,sidebar,snapshot:()=>lastAnnotations};
})();
