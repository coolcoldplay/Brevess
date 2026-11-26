(function(root,factory){
  if(root.SciLLM?.ACTION_ICONS_REVISION==='r18'&&!(typeof module==='object'&&module.exports))return;
  const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
  Object.assign(root.SciLLM ||= {},api);
})(globalThis,function(root){
  'use strict';
  // Explicit interface labels only. Do not infer actions from article/user text
  // or collapse distinct export formats, authorization decisions and toggles.
  const labels={
    close:['关闭','关闭原图','关闭图表梳理','关闭论文证据台账','关闭编辑面板','关闭步骤编辑','关闭可见性设置','取消','收起提示','Close','Close original image','Cancel','Dismiss','×','✕','✖','✖️'],
    refresh:['刷新','刷新状态','刷新共享库','刷新权限','刷新访问权限','刷新音色','↻ 共享课题','读取最新标签','Refresh','Refresh status','Reload'],
    save:['保存','保存笔记','保存名称','保存人工修订','保存功能设置','保存显示列','保存朗读设置','保存标签','保存步骤','保存组','保存网址白名单','保存证据块','保存连接','保存阅读场景','保存雷达','保存 PDF 解析设置','Save','Save notes'],
    copy:['复制','复制笔记','复制配置提示词','Copy'],
    trash:['删除','删除字段','删除当前场景','删除标注','删除模板','删除笔记','删除组','删除联系','删除节点','删除所选节点','删除证据块','移除','移除组','移除条目','移除关联','移除引用','移除此证据','移除绑定','移除表格','移除附加项','移入回收站','移出','清空选择','Delete','Remove'],
    edit:['编辑','编辑情境与类别','编辑拐点','编辑检索式','编辑规则','编辑证据块','编辑资料','修改判断 / 备注','查看/编辑规则','Edit'],
    search:['搜索','打开检索','Search'],
    add:['添加','新增','创建','新增动作','新增场景','新增字段','新增提示词','新增文献','新增标签组','新增模板','新增缩略词','新增追问','添加标签','添加步骤','添加识别类别','增加列','增加行','＋ 节点','Add','New','+','＋'],
    minus:['−'],
    undo:['撤销','↶','Undo'],redo:['重做','↷','Redo'],
    retry:['重试','重试保存','重试同步','重试本地翻译','Retry'],
    download:['导出','完整导出','导出原件','导出词库','导出本类别','备份标签与资料','立即备份配置','Export','Download'],
    upload:['导入 JSON','导入资料备份','添加 PDF / HTML 附件','＋ 自有图片','Import','Upload'],
    back:['← 返回','← 返回 PDF','← 返回原论文正文','返回上处','返回整图','返回登录','返回缩写表','返回设置概览','返回账号','Back'],
    previous:['上一页','上一图','‹','Previous'],next:['下一页','›','Next'],
    up:['上移','↑','Move up'],down:['下移','↓','Move down'],
    more:['更多','⋯','More'],help:['帮助','Help'],
    done:['完成','确认','Done','Confirm'],
    open:['打开','打开 PDF','打开原文','打开远程 PDF','查看原始 PDF','Open'],
    logout:['退出登录','Log out','Sign out'],
    stop:['停止','停止朗读','停止检查','停止生成','取消分析','取消图解','取消导出','取消机制链生成','Stop'],
    pause:['暂停分析','暂停图解','暂停自动检查','Pause'],
    play:['点击播放','试听中文','试听英文','Play'],
    restore:['恢复','恢复组','恢复条目','恢复关联','恢复草稿','恢复预设','恢复默认','Restore','Reset'],
    folder:['打开文件夹','选择目录','Open folder'],
    zoomIn:['放大','Zoom in'],zoomOut:['缩小','Zoom out'],
    fit:['适宽','适应','适应画布','适应文字高度','Fit'],
    chat:['AI 提问','AI提问','Panel 追问','Ask AI'],
    settings:['模型设置','翻译设置','识别设置','打开 MinerU 设置','Settings'],
    link:['Agent 连接','Agent connection'],
    check:['检测连接','检查连接','检测连接组件','Check connection'],
    reconnect:['重连 MCP','Reconnect MCP']
  };
  // One monochrome, 24-unit line vocabulary. No font, image or network dependency.
  const paths={
    close:'M6 6l12 12M18 6 6 18',
    save:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
    copy:'M9 9h12v12H9zM15 9V3H3v12h6',
    trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    edit:'m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5',
    search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    add:'M12 5v14M5 12h14',minus:'M5 12h14',undo:'M3 10h11a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5',redo:'M21 10H10a6 6 0 0 0 0 12M21 10l-5-5M21 10l-5 5',
    download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5',
    back:'M20 12H4m6-6-6 6 6 6',previous:'m15 5-7 7 7 7',next:'m9 5 7 7-7 7',up:'M12 20V4m-6 6 6-6 6 6',down:'M12 4v16m-6-6 6 6 6-6',
    more:'M3 12h2M11 12h2M19 12h2',help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    stop:'M5 5h14v14H5z',pause:'M7 4v16M17 4v16',play:'m6 3 15 9-15 9V3Z',
    restore:'M3 4v6h6M3 10a9 9 0 1 1 2 8M12 7v5l3 3',folder:'M3 20V4h6l3 3h9v13H3Z',
    zoomIn:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM6 10h8M10 6v8',
    zoomOut:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM6 10h8',
    fit:'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6',
    chat:'M21 3H3v14h5v4l5-4h8V3ZM7 8h10M7 12h6',
    settings:'M4 7h16M4 17h16M8 4v6M16 14v6',
    link:'m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    check:'m6 12 4 4 8-8M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    reconnect:'M9 2v4M15 2v4M5 6h14M7 6v5a5 5 0 0 0 10 0V6M12 16v6',
    done:'m5 12 4 4L19 6',open:'M14 3h7v7M10 14 21 3M10 3H3v18h18v-7',
    logout:'M9 3H3v18h6M8 12h13m-5-5 5 5-5 5',
    busy:'M12 3a9 9 0 1 1-9 9'
  };
  // Phosphor Icons 2.1.2 regular outlines, extracted from the existing bundled
  // font. MIT license: vendor/phosphor/LICENSE.
  const filledPaths={"refresh":"M21 4.5V9Q21 9.305 20.777 9.527Q20.555 9.75 20.25 9.75H15.75Q15.445 9.75 15.223 9.527Q15 9.305 15 9Q15 8.695 15.223 8.473Q15.445 8.25 15.75 8.25H18.445L17.062 6.867Q16.055 5.859 14.707 5.273Q13.359 4.688 11.812 4.688H11.766Q11.766 4.688 11.754 4.688Q11.742 4.688 11.742 4.688Q10.219 4.688 8.871 5.262Q7.523 5.836 6.516 6.82Q6.422 6.914 6.293 6.961Q6.164 7.008 6.023 7.008Q5.695 7.008 5.484 6.797Q5.273 6.586 5.273 6.258Q5.273 6.117 5.32 5.977Q5.367 5.836 5.484 5.742Q6.703 4.547 8.32 3.867Q9.938 3.188 11.766 3.188Q13.641 3.188 15.281 3.891Q16.922 4.594 18.141 5.812L19.5 7.195V4.5Q19.5 4.195 19.723 3.973Q19.945 3.75 20.25 3.75Q20.555 3.75 20.777 3.973Q21 4.195 21 4.5ZM17.484 17.18Q16.453 18.164 15.105 18.738Q13.758 19.312 12.234 19.312Q10.688 19.312 9.316 18.727Q7.945 18.141 6.938 17.133L5.555 15.75H8.25Q8.555 15.75 8.777 15.527Q9 15.305 9 15Q9 14.695 8.777 14.473Q8.555 14.25 8.25 14.25H3.75Q3.445 14.25 3.223 14.473Q3 14.695 3 15V19.5Q3 19.805 3.223 20.027Q3.445 20.25 3.75 20.25Q4.055 20.25 4.277 20.027Q4.5 19.805 4.5 19.5V16.805L5.883 18.188Q7.078 19.406 8.707 20.109Q10.336 20.812 12.188 20.812H12.234Q12.234 20.812 12.246 20.812Q12.258 20.812 12.258 20.812Q14.086 20.812 15.703 20.133Q17.32 19.453 18.516 18.258Q18.633 18.164 18.691 18.023Q18.75 17.883 18.75 17.742Q18.75 17.414 18.527 17.203Q18.305 16.992 18 16.992Q17.836 16.992 17.707 17.039Q17.578 17.086 17.484 17.18Z","retry":"M21 12Q21 12 21 12Q21 12 21 12Q21 13.852 20.297 15.469Q19.617 17.109 18.41 18.328Q17.203 19.547 15.586 20.25Q13.969 20.977 12.117 21H12Q12 21 11.988 21Q11.977 21 11.977 21Q10.195 21 8.613 20.344Q7.031 19.688 5.812 18.539Q5.719 18.445 5.648 18.305Q5.578 18.164 5.578 18Q5.578 17.695 5.801 17.473Q6.023 17.25 6.328 17.25Q6.492 17.25 6.621 17.309Q6.75 17.367 6.844 17.461Q7.852 18.398 9.176 18.949Q10.5 19.5 12 19.5Q13.547 19.5 14.93 18.914Q16.289 18.328 17.309 17.309Q18.328 16.289 18.914 14.906Q19.5 13.547 19.5 12Q19.5 10.453 18.914 9.07Q18.328 7.711 17.309 6.691Q16.289 5.672 14.93 5.086Q13.547 4.5 12 4.5Q10.453 4.5 9.082 5.086Q7.711 5.672 6.703 6.703Q6.68 6.703 6.68 6.703Q6.68 6.703 6.68 6.727L4.172 9H6.75Q7.055 9 7.277 9.223Q7.5 9.445 7.5 9.75Q7.5 10.055 7.277 10.277Q7.055 10.5 6.75 10.5H2.25Q1.945 10.5 1.723 10.277Q1.5 10.055 1.5 9.75V5.25Q1.5 4.945 1.723 4.723Q1.945 4.5 2.25 4.5Q2.555 4.5 2.777 4.723Q3 4.945 3 5.25V8.039L5.648 5.625Q6.867 4.406 8.508 3.703Q10.148 3 12 3Q13.875 3 15.492 3.703Q17.133 4.406 18.363 5.637Q19.594 6.867 20.297 8.508Q21 10.125 21 12Z"};
  const exact=new Map(Object.entries(labels).flatMap(([icon,values])=>values.map(value=>[value,icon])));
  let translator,translated;
  function invalidateActionIconTranslations(){translated=null;}
  function actionIconForLabel(label){
    const text=String(label||'').trim().replace(/\s+/gu,' ');
    const direct=exact.get(text);if(direct)return direct;
    const translate=root.SciLLM?.translateInterfaceText;
    // Rebuild only when a surface registers a dictionary, not for every button
    // mutation; the shared interface observer must stay cheap at startup.
    if(translate){
      if(translator!==translate||!translated){translator=translate;translated=new Map();for(const [source,icon]of exact)translated.set(translate(source,'en'),icon);}
      return translated.get(text)||'';
    }
    return '';
  }
  const marker='data-brevess-action-icon',owned=new WeakMap(),styles=new WeakMap();
  // Only established BREVESS control rows, not forms, article contents or menu
  // lists. Keep their grid/column structure and hidden state authoritative.
  const actionRows=['agent-actions','navigation-outline-controls','navigation-translation-recovery-actions','analysis-task-controls','workspace-mechanism-toolbar-actions','literature-note-export-actions','abbreviation-dialog-actions','figure-result-editor-footer','paragraph-note-dialog-footer','supplemental-figure-import-footer','ppt-export-preview-actions','confirmation-dialog-actions','setup-focus-actions','setup-check-actions','section-heading-actions','settings-actions','tts-actions','codex-auth-actions','profile-editor-actions','workspace-pagination','portable-config-actions','dialog-actions','pdf-reader-page-controls','pdf-reader-search-controls','pdf-reader-zoom','pdf-reader-toolbar-actions','offline-header','page-tools__actions','logic-map-recovery','logic-map-save-bar','history','brandbar','catalog-toolbar','pane-title','batch-actions','actions','ai-actions','form-actions','modal-actions','md-header-actions','md-toolbar','md-inspector-row','md-inspector-bottom','md-story-editor-save','md-story-editor-nav','manual-evidence-actions'].map(name=>'.'+name).join(',')+',#viewport-controls,[data-action-icon-row]';
  const excluded='[data-action-icon="none"],[data-i18n-ignore],[translate="no"],[contenteditable="true"],#pdfNativeViewer,#pdfReaderArticle,.pdf-native-text-layer';
  const css=`
    button[${marker}]:not([hidden]) {
      box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;
      width:32px!important;min-width:32px!important;max-width:none!important;height:32px!important;min-height:32px!important;
      padding:6px!important;gap:0!important;flex:0 0 auto!important;vertical-align:middle;
      font-size:0!important;line-height:0!important;border-radius:0!important;box-shadow:none!important;
    }
    button[${marker}] > * {display:none!important}
    button[${marker}]::before {display:none!important}
    button[${marker}]::after {
      content:""!important;display:block!important;position:static!important;width:18px!important;height:18px!important;
      flex:none;background:currentColor!important;opacity:1!important;pointer-events:none;
      mask:var(--brevess-action-mask) center/contain no-repeat!important;
      -webkit-mask:var(--brevess-action-mask) center/contain no-repeat!important;
      border:0!important;transform:none!important;
    }
    button[${marker}]:focus-visible {outline:2px solid currentColor;outline-offset:3px}
    button[${marker}]:not(.btn-primary,.primary,.is-primary,.active,.is-active,.danger,.btn-danger,.is-danger,.md-danger,[aria-pressed="true"],[aria-busy="true"]) {
      color:var(--bv-text,var(--swiss-ink,#202020));border-color:var(--bv-line,var(--swiss-line,#d5d5d5));background:var(--bv-surface,#fff);
    }
    button[${marker}]:hover:not(:disabled) {border-color:var(--bv-text,var(--swiss-ink,#202020));background:var(--bv-hover,#ededed);color:var(--bv-text,var(--swiss-ink,#202020))}
    button[${marker}]:active:not(:disabled) {background:var(--bv-selected,var(--swiss-ink,#202020));color:var(--bv-on-selected,#fff)}
    [data-brevess-action-row] {align-items:center!important;column-gap:8px!important;row-gap:8px!important}
    [data-brevess-action-row] > button:not([hidden]) {
      box-sizing:border-box!important;min-height:32px!important;height:32px!important;
      margin-block:0!important;padding:6px 10px;line-height:18px;vertical-align:middle;
      border-radius:0!important;align-self:center;
    }
    button[${marker}="busy"]::after {animation:brevess-action-spin .9s linear infinite}
    [data-brevess-dialog] { --brevess-dialog-edge:12px }
    [data-brevess-dialog] :is(h2,h3):first-of-type { padding-inline-end:28px }
    [data-brevess-dialog] [data-brevess-dialog-close],button[data-brevess-dialog-close][data-brevess-dialog-close] {
      position:absolute!important;inset:var(--brevess-dialog-edge,12px) var(--brevess-dialog-edge,12px) auto auto!important;
      display:grid!important;place-items:center!important;width:26px!important;height:26px!important;min-width:0!important;min-height:0!important;
      padding:3px!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;
      color:var(--bv-text,#202020)!important;background:transparent!important;font-size:0!important;line-height:1!important;z-index:2;
    }
    button[data-brevess-dialog-close] > * {display:none!important}
    button[data-brevess-dialog-close][data-brevess-dialog-close]::after {
      content:""!important;display:block!important;position:static!important;width:16px!important;height:16px!important;
      background:currentColor!important;mask:var(--brevess-close-mask) center/contain no-repeat!important;
      -webkit-mask:var(--brevess-close-mask) center/contain no-repeat!important;pointer-events:none;
    }
    button[data-brevess-dialog-close][data-brevess-dialog-close]:hover {color:var(--bv-red,#bd2927)!important}
    [data-brevess-dialog-footer] {display:flex;align-items:center;justify-content:flex-end;gap:8px}
    [data-brevess-dialog-save] {order:5;margin-inline-start:auto!important}
    @supports (anchor-name:--brevess-save) and (anchor-scope:--brevess-save) {
      [data-brevess-dialog]{anchor-scope:--brevess-save}
      [data-brevess-dialog-save]{anchor-name:--brevess-save}
      [data-brevess-dialog]:has([data-brevess-dialog-save]) [data-brevess-dialog-close] {
        right:anchor(--brevess-save right,var(--brevess-dialog-edge,12px))!important;
      }
    }
    [data-brevess-dialog] [data-brevess-extra-cancel] {display:none!important}
    @keyframes brevess-action-spin {to{rotate:360deg}}
    @media(prefers-reduced-motion:reduce){button[${marker}="busy"]::after{animation:none}}
  `;
  function ensureStyle(button){
    const scope=button.getRootNode?.(),doc=button.ownerDocument;
    const parent=scope?.nodeType===11&&scope.host?scope:doc?.head;
    if(!parent)return;
    const old=styles.get(parent);if(old?.parentNode===parent)return;
    // Hosted pages use an external sheet under their strict CSP; shadow roots
    // and extension surfaces retain the scoped runtime stylesheet.
    const external=parent.querySelector?.('link[rel="stylesheet"][data-brevess-action-icons]');
    if(external){styles.set(parent,external);return;}
    const style=doc.createElement('style');style.dataset.brevessActionIcons='r18';style.textContent=css;parent.appendChild(style);styles.set(parent,style);
  }
  function setOwnedAttribute(button,state,name,value){
    const current=button.getAttribute(name);
    const t=root.SciLLM?.translateInterfaceText;
    const localized=state[name]&&t&&(current===t(state[name],'en')||t(current,'en')===state[name]);
    if(current!==null&&current!==state[name]&&!localized){delete state[name];return;}
    if(current!==value)button.setAttribute(name,value);
    state[name]=value;
  }
  function clear(button,state){
    button.removeAttribute(marker);button.style.removeProperty('--brevess-action-mask');
    for(const name of ['title','aria-label'])if(state?.[name]===button.getAttribute(name))button.removeAttribute(name);
    owned.delete(button);
  }
  function decorateButton(button){
    if(!button?.matches?.('button'))return;
    const state=owned.get(button)||{};
    if(button.closest(excluded)||button.matches('[role="tab"],[role="switch"],[aria-selected],[data-filter],[data-settings-nav],[data-reading-settings-target]')||button.closest('[data-i18n-user-content]')&&!button.hasAttribute('data-i18n-interface-text')){if(owned.has(button))clear(button,state);return;}
    let label=(button.textContent||'').trim().replace(/\s+/gu,' ');
    let icon=actionIconForLabel(label);
    // Existing pictographic controls keep their established icon vocabulary.
    // All dismissal controls use this shared cross, including old glyphs.
    if(icon!=='close'&&button.querySelector('svg,img,i,[class*="icon"],input'))icon='';
    if(icon==='close'&&button.hasAttribute('aria-pressed'))icon='';
    if(button.getAttribute('aria-busy')==='true'&&(icon||state.icon))icon='busy';
    if(!icon){if(owned.has(button))clear(button,state);return;}
    if(/^[×✕✖️]+$/u.test(label))label=button.getAttribute('aria-label')||button.title||root.SciLLM?.translateInterfaceText?.('关闭')||'关闭';
    // Respect specific descriptions/keyboard shortcuts provided by each view.
    setOwnedAttribute(button,state,'aria-label',label);
    setOwnedAttribute(button,state,'title',button.getAttribute('aria-label')||label);
    state.icon=icon;owned.set(button,state);ensureStyle(button);
    const parent=button.parentElement;
    if(parent?.matches(actionRows)&&!parent.hasAttribute('data-brevess-action-row'))parent.setAttribute('data-brevess-action-row','');
    if(button.getAttribute(marker)!==icon){
      const svg=filledPaths[icon]?`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="black"><path d="${filledPaths[icon]}"/></svg>`:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[icon]}"/></svg>`;
      button.style.setProperty('--brevess-action-mask',`url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
      button.setAttribute(marker,icon);
    }
  }
  const dialogSelector='dialog,[role="dialog"],[role="alertdialog"],#focusControls';
  const boundEscape=new WeakSet(),dismissals=new WeakSet();
  function registerEscape(scope){
    if(boundEscape.has(scope))return;
    boundEscape.add(scope);
    scope.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||event.isComposing||event.defaultPrevented)return;
      const native=scope.querySelector('dialog:modal');
      const buttons=[...scope.querySelectorAll('[data-brevess-dialog-close]')].reverse();
      const close=buttons.find(button=>{
        const owner=button.closest(dialogSelector);
        return dismissals.has(button)&&owner&&owner.localName!=='dialog'&&(!native||native.contains(owner))&&button.getClientRects().length;
      });
      if(close){event.preventDefault();event.stopPropagation();close.click();}
    });
  }
  function prepareDialog(dialog){
    const doc=dialog.ownerDocument,scope=dialog.getRootNode();
    const ownedPage=/^(?:chrome|moz)-extension:$/.test(doc.location?.protocol)||doc.body?.hasAttribute('data-ui-surface');
    if(!ownedPage&&!dialog.closest('[data-sci-plugin-ui],[data-brevess-ui]')&&!scope.host?.matches('[data-sci-plugin-ui]'))return;
    if(!dialog.childElementCount||dialog.id==='sci-manual-toolbar'||dialog.closest('[data-i18n-user-content]'))return;
    const controls=[...dialog.querySelectorAll('button')].filter(b=>b.closest(dialogSelector)===dialog);
    const label=b=>(b.textContent||'').trim();
    const cancel=b=>/^(取消|Cancel)$/i.test(label(b));
    const close=controls.find(b=>!b.hasAttribute('data-brevess-auto-close')&&
      (b.matches('[data-close],[data-dialog-dismiss],#focusCollapse')||/^(?:[×✕✖]|关闭|Close)$/iu.test(label(b))||/^(关闭|Close\b)/i.test(b.getAttribute('aria-label')||'')))||
      controls.find(cancel)||controls.find(b=>b.hasAttribute('data-brevess-auto-close'));
    let dismiss=close;
    if(!dismiss&&dialog.localName==='dialog'){
      dismiss=doc.createElement('button');dismiss.type='button';dismiss.textContent='×';
      dismiss.setAttribute('aria-label',root.SciLLM?.translateInterfaceText?.('关闭')||'关闭');
      dismiss.dataset.brevessAutoClose='';
      dismiss.addEventListener('click',()=>{
        if(typeof dialog.requestClose==='function')dialog.requestClose('cancel');
        else if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close('cancel');
      });
      dialog.append(dismiss);
    }
    if(!dismiss)return;
    if(!dialog.hasAttribute('data-brevess-dialog'))dialog.dataset.brevessDialog='';
    for(const old of controls.filter(b=>b!==dismiss&&b.hasAttribute('data-brevess-dialog-close'))){
      if(old.hasAttribute('data-brevess-auto-close'))old.remove();else old.removeAttribute('data-brevess-dialog-close');
    }
    if(!dismiss.hasAttribute('data-brevess-dialog-close')){
      dismiss.dataset.brevessDialogClose='';dismissals.add(dismiss);
      const cross='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"><path d="'+paths.close+'"/></svg>';
      dismiss.style.setProperty('--brevess-close-mask','url("data:image/svg+xml,'+encodeURIComponent(cross)+'")');
      ensureStyle(dismiss);registerEscape(scope);
    }
    for(const b of controls){
      const footer=b.closest('footer,.form-actions,.modal-actions,.dialog-actions,[class$="-footer"],.confirmation-dialog-actions,.batch-foot,.form-foot');
      if(!footer||footer.closest(dialogSelector)!==dialog)continue;
      // Some forms have an independent cancel for an edit inside the dialog.
      if(cancel(b)&&b!==dismiss&&/^cancel-(?:editor|history)$/.test(b.id))b.dataset.brevessExtraCancel='';
      if((b.getAttribute(marker)==='save'||/^(保存|Save\b)/i.test(label(b)))&&!b.hasAttribute('data-brevess-dialog-save')){
        b.dataset.brevessDialogSave='';footer.dataset.brevessDialogFooter='';
      }
    }
  }
  function decorateActionIcons(scope){
    if(!scope)return;
    // Called only by the existing interface-root localization lifecycle. Never
    // install a whole-article observer or traverse into unregistered shadows.
    const element=scope.nodeType===3?scope.parentElement:scope;
    const button=element?.closest?.('button');if(button)decorateButton(button);
    element?.querySelectorAll?.('button').forEach(decorateButton);
    const parent=element?.closest?.(dialogSelector);if(parent)prepareDialog(parent);
    element?.querySelectorAll?.(dialogSelector).forEach(prepareDialog);
  }
  // Standalone extension pages can open native dialogs without the localization observer.
  if(/^(?:chrome|moz)-extension:$/.test(root.location?.protocol)){
    root.document?.addEventListener('toggle',event=>{
      if(event.target?.matches?.('dialog[open]'))prepareDialog(event.target);
    },true);
  }
  return{ACTION_ICONS_REVISION:'r18',actionIconForLabel,decorateActionIcons,invalidateActionIconTranslations};
});
