(async function () {
  const $ = s => document.querySelector(s), results = [];
  const renderer = BrevessChatMessageUI.createRenderer();
  const wide = '| Paper | Year | Author | Model | Methods | Findings | Relation to this paper | Evidence |\n|---|---|---|---|---|---|---|---|\n' +
    Array.from({length:12},(_,i)=>`| [Study ${i+1}](https://doi.org/10.1038/example${i}) | 2020 | Bartels et al. | α-synuclein | Immunohistochemistry | **Long technical finding** with references and biomarkers | Preserves original article text and links while comparing the findings across many columns | Correlation; mechanism requires testing |`).join('\n');
  const payloads = new Map();
  // The fixture uses the production serializer, renderer and popup opener with an injected browser boundary.
  const realOpen = BrevessTableViewer.open;
  BrevessTableViewer.open = table => realOpen(table, {title:'论文相关工作对照表',screen:{availWidth:1440,availHeight:900},chromeApi:{
    storage:{session:{set:async v=>Object.entries(v).forEach(([k,x])=>payloads.set(k,x)),remove:async k=>payloads.delete(k)}},
    runtime:{getURL:p=>'chrome-extension://fixture/'+p},windows:{create:async options=>{
      $('#viewer').replaceChildren(BrevessTableViewer.render(document,[...payloads.values()].at(-1)));
      $('#viewer').dataset.requestedWidth=options.width;$('#wide-panel').showModal();
    }}
  }});
  $('#answer').append(renderer.renderArticleChatMarkdown(wide));
  $('#close-viewer').onclick=()=>$('#wide-panel').close();
  const image=$('#figure');await image.decode();
  let notes=0;
  const controls=SciLLM.createFigureQuickControls({document,isActive:()=>true,onOpenNotes:()=>{notes++;},onHighResolution:async()=>true});
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const event=(target,type='pointerover',x=60,y=60)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,composed:true,clientX:x,clientY:y,pointerType:'mouse'}));
  $('#run-checks').onclick=async()=>{
    results.length=0;const check=(name,passed,details)=>results.push({name,passed,...details});
    for(const width of [320,380,600]){
      $('#sidebar').style.width=width+'px';
      const header=$('#sidePanelHeader'),status=$('#sidePanelDocumentStatus'),nav=$('.workspace-bottom-nav');
      check(width+'px 工作区上下栏紧凑',header.offsetHeight===40&&status.offsetHeight===38&&nav.offsetHeight<=43,{header:header.offsetHeight,status:status.offsetHeight,nav:nav.offsetHeight});
      check(width+'px 表格不会撑破侧栏',$('#answer').scrollWidth<=$('#answer').clientWidth);
    }
    check('全部顶部图标同尺寸、无按钮边框',[...document.querySelectorAll('[data-toolbar-icon]')].every(svg=>svg.getBoundingClientRect().width===20&&svg.getBoundingClientRect().height===20&&getComputedStyle(svg.parentElement).borderTopWidth==='0px'));
    const host=$('[data-brevess-figure-tools]');check('未悬停时图片按钮隐藏',getComputedStyle(host).display==='none');
    const before=image.getBoundingClientRect(),x=before.left+15,y=before.top+15;
    event(image,'pointerover',x,y);await sleep(40);check('无需侧栏激活即可悬停显示',getComputedStyle(host).display==='block');
    check('悬停不改变图片大小',Math.abs(image.getBoundingClientRect().width-before.width)<.1);
    event(host);await sleep(260);check('移入工具按钮保持可用',getComputedStyle(host).display==='block');
    host.shadowRoot.querySelector('[aria-label="图片笔记"]').click();check('原图片笔记操作仍可点击',notes===1);
    event(document.body);
    host.shadowRoot.dispatchEvent(new FocusEvent('focusin'));
    host.shadowRoot.dispatchEvent(new FocusEvent('focusout'));
    await sleep(280);check('焦点中断隐藏计时后仍能再次隐藏',getComputedStyle(host).display==='none');
    event(document.body);await sleep(280);check('移出后自动隐藏',getComputedStyle(host).display==='none');
    $('#answer .article-chat-table-expand').click();await sleep(40);
    check('表格打开申请1280px独立窗口',$('#viewer').dataset.requestedWidth==='1280');
    check('大面板保留全部行列和链接',$('#viewer').querySelectorAll('tbody tr').length===12&&$('#viewer').querySelectorAll('thead th').length===8&&$('#viewer a').href.startsWith('https://doi.org/'));
    $('#wide-panel').close();check('关闭后原回答仍完整',$('#answer table').rows.length===13);
    $('#summary').textContent=results.filter(r=>r.passed).length+'/'+results.length+' 通过；'+results.filter(r=>!r.passed).map(r=>r.name+' '+JSON.stringify(r)).join('；');
    $('#results').textContent=JSON.stringify(results,null,2);$('#sidebar').style.width='380px';
  };
})();
