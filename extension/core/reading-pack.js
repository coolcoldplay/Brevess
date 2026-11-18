(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.BrevessReadingAgent ||= {},api);})(globalThis,()=>{
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function buildReadingPackEntries(input,{rendererScript='' }={}){
    if(!input?.workspace?.workspaceId||!Array.isArray(input.assets))throw Error('READING_PACK_INVALID');
    let snapshot=input.assets.find(a=>a.relativePath==='article/offline-snapshot.html')?.content;
    if(typeof snapshot!=='string'||!snapshot.trim())throw Object.assign(Error('请先保存包含网页的完整离线副本。'),{code:'READING_PACK_SNAPSHOT_REQUIRED'});
    // A full-size image can be saved after the HTML snapshot. Keep the original
    // layout carrier and embed its latest verified local original into the pack.
    const structure=input.assets.find(a=>a.relativePath==='article/structure.json')?.content;
    const originals=input.assets.filter(a=>/^figures\/originals\/[a-f0-9]{64}\.json$/.test(a.relativePath)).map(a=>a.content)
      .filter(record=>record?.schema==='brevess-figure-original-v1'&&record.documentHash===structure?.documentHash&&
        /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/i.test(record.dataUrl||''));
    if(originals.length)snapshot=snapshot.replace(/<img\b[^>]*>/gi,tag=>{
      const record=originals.find(item=>tag.includes('data-brevess-figure-id="'+escape(item.figureId)+'"')&&tag.includes('data-brevess-image-index="'+item.imageIndex+'"'));
      if(!record)return tag;
      const paint='background-image:url(&quot;'+record.dataUrl+'&quot;)!important;background-size:100% 100%!important;background-position:center!important;background-repeat:no-repeat!important;background-origin:content-box!important;background-clip:content-box!important;object-position:-1000000px -1000000px!important;';
      tag=tag.replace(/\sdata-brevess-original-image="[^"]*"/i,'');
      tag=/\sstyle="/i.test(tag)?tag.replace(/\sstyle="([^"]*)"/i,(_,style)=>' style="'+style+';'+paint+'"'):tag.replace(/\s*\/?>$/,' style="'+paint+'">');
      return tag.replace(/\s*\/?>$/,' data-brevess-original-image="'+record.dataUrl+'">');
    });
    let metadata={complete:false};try{const marker=/name=["']brevess-offline-snapshot["']\s+content=["']([^"']+)["']/i.exec(snapshot);if(marker)metadata=JSON.parse(decodeURIComponent(marker[1]));}catch{}
    // The input is the public single-workspace projection, not a browser backup.
    const payload={schema:'brevess-reading-pack-v1',workspace:input.workspace,assets:input.assets.filter(a=>!a.relativePath.startsWith('internal/')&&!a.relativePath.startsWith('exports/')).map(asset=>asset.relativePath==='article/offline-snapshot.html'?{...asset,content:undefined,externalFile:'snapshot.html'}:asset),turns:input.turns||[],offline:metadata};
    const data=JSON.stringify({...payload,assets:payload.assets.filter(a=>! /^(article\/|legacy\/|chat\/)/.test(a.relativePath))}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    const viewer=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(input.workspace.title)} · BREVESS</title><style>*{box-sizing:border-box}body{margin:0;color:#242424;background:#fff;font:15px/1.7 system-ui}header{height:56px;display:flex;align-items:center;gap:24px;padding:12px 24px;border-bottom:1px solid #eee}header strong{letter-spacing:.08em}header span{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}main{display:grid;grid-template-columns:minmax(0,1fr) 400px;height:calc(100dvh - 56px)}iframe{width:100%;height:100%;border:0}aside{border-left:1px solid #eee;padding:20px;overflow:auto}nav{display:flex;gap:4px;flex-wrap:wrap;position:sticky;top:-20px;background:white;padding:10px 0}button{font:inherit;border:0;border-radius:6px;background:#f3f3f5;padding:6px 12px;cursor:pointer}button[aria-selected=true]{background:#242424;color:white}article{margin:16px 0 24px}h2{font-size:18px}h3{font-size:15px}p{overflow-wrap:anywhere}.muted,summary{font-size:12px;color:#777}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fafafa;padding:12px;font-size:12px}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}details{margin:12px 0}a{color:inherit}#view{overflow:auto}.article-chat-markdown-table-scroll{overflow:auto}@media(max-width:800px){main{display:block;height:auto}iframe{height:65vh}aside{border:0;border-top:1px solid #eee}}</style><header><strong>BREVESS</strong><span>${escape(input.workspace.title)}</span></header><main><iframe title="保存的原文" src="snapshot.html" sandbox></iframe><aside><p class="muted">离线阅读包 · ${metadata.complete===true?'网页资源已完整保存':'部分网页资源未保存，详见原始数据'}<br>保存于 ${escape(metadata.savedAt||'')}</p><nav aria-label="阅读记录"><button data-section="notes" aria-selected="true">笔记</button><button data-section="figures">解图</button><button data-section="chat">问答</button><button data-section="annotations">高亮</button><button data-section="translations">译文</button><button data-section="other">其他</button></nav><div id="view"></div><p class="muted"><a href="reading-data.json" download>下载完整可编辑数据</a></p></aside></main><script src="reader.js"></script><script>const pack=${data};(${readingPackViewer.toString()})(pack);</script></html>`;
    return {complete:metadata.complete===true,assetCount:payload.assets.length,turnCount:payload.turns.length,entries:[{path:'index.html',data:viewer},{path:'snapshot.html',data:snapshot},{path:'reading-data.json',data:JSON.stringify(payload,null,2)},{path:'reader.js',data:rendererScript},{path:'README.txt',data:'解压后打开 index.html，无需安装 BREVESS 或联网。原文、图片与既有阅读成果来自保存时的副本。新问答、翻译、朗读及出版社在线交互仍需相应服务。reading-data.json 保留原始可编辑记录；原文授权范围由分享者核对。'}]};
  }
  function readingPackViewer(pack){
    const view=document.getElementById('view'),renderer=globalThis.BrevessChatMessageUI?.createRenderer({document});
    const add=(parent,tag,text)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
    const ignored=/^(?:schemaVersion|version|revision|workspaceId|workspaceGeneration|documentHash|textHash|contentHash|sourceHash|cacheKey|updatedAt|createdAt|turnId|providerId|profileId|requestId|operationId|inputHash|navigationIdentity|documentIdentity)$/;
    const labels={coreConclusion:'核心结论',summary:'总结',question:'问题',answer:'回答',text:'正文',note:'备注',title:'标题',figureLabel:'Figure',panelId:'Panel',method:'方法',result:'结果',interpretation:'解读',limitation:'局限',conclusion:'结论',research_background:'研究背景',experimental_design:'实验设计',important_methods:'关键方法',innovations:'创新点',limitations:'局限',research_question:'研究问题',results:'主要结果',figureQuestion:'本图回答的问题',argumentChain:'证据链',claimBoundary:'结论边界',remainingQuestion:'待解问题',panelGroups:'Panel 关系',panels:'Panel 解读',authorAssembly:'作者组图逻辑'};
    function render(parent,value,key='',depth=0){
      if(value===null||value===undefined||depth>12)return;
      if(typeof value==='string'){
        if(!value.trim()||/^data:/i.test(value)||value.length>200000)return;
        if(key&&labels[key])add(parent,'h3',labels[key]);
        if(renderer)parent.append(renderer.renderArticleChatMarkdown(value));else add(parent,'p',value);return;
      }
      if(Array.isArray(value)){value.forEach(item=>{const article=document.createElement('article');render(article,item,key,depth+1);if(article.childElementCount)parent.append(article);});return;}
      if(typeof value==='object')for(const [k,v] of Object.entries(value))if(!ignored.test(k))render(parent,v,k,depth+1);
    }
    function section(asset){const p=asset.relativePath;if(p.startsWith('notes/')||p.startsWith('literature-notes/')||/literature-note/.test(p))return'notes';if(p.startsWith('figures/'))return'figures';if(p.startsWith('chat/'))return'chat';if(p.startsWith('annotations/'))return'annotations';if(p.startsWith('translations/'))return'translations';return'other';}
    function show(name){view.replaceChildren();for(const button of document.querySelectorAll('[data-section]'))button.setAttribute('aria-selected',String(button.dataset.section===name));
      if(name==='chat')for(const turn of pack.turns){const article=document.createElement('article');render(article,{question:turn.question,answer:turn.answerBlocks?.map(block=>block.markdown||block.text||'').filter(Boolean).join('\n\n')||turn.answer||turn.response||turn.content});view.append(article);}
      else for(const asset of pack.assets.filter(a=>section(a)===name&&!/^(article\/|legacy\/)/.test(a.relativePath))){const article=document.createElement('article');
        if(name==='notes'&&asset.content?.valuesByTemplate){const note=asset.content;render(article,note.valuesByTemplate[note.templateId]||note.valuesByTemplate);}
        else if(name==='figures'&&asset.relativePath==='figures/inventory.json'){for(const figure of asset.content?.figures||[]){const row=document.createElement('details');add(row,'summary',(figure.figureLabel||figure.figureId)+' · '+(figure.figureTitle||'解图'));const result=figure[figure.activeDepth]||figure.deep||figure.standard;if(result)render(row,result);else add(row,'p','尚无已保存解读。');article.append(row);}}
        else if(name==='figures'&&asset.relativePath==='figures/workspace-draft.json'){add(article,'h3','图表梳理');render(article,asset.content);}
        else if(name!=='figures')render(article,asset.content);
        if(article.childElementCount)view.append(article);}
      if(!view.childElementCount)add(view,'p','暂无已保存内容。');
    }
    document.querySelector('nav').addEventListener('click',event=>{const button=event.target.closest('[data-section]');if(button)show(button.dataset.section);});show('notes');
  }
  return{buildReadingPackEntries};
});
