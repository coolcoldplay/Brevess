(function(){
 const base=chrome.runtime.getURL('');const isHost=url=>[base+'workbench/index.html',base+'options.html'].includes(url?.split(/[?#]/)[0]);const context=async tabId=>{const rows=await chrome.runtime.getContexts({contextTypes:['TAB']});const own=rows.filter(c=>c.tabId===tabId&&c.frameId===0&&isHost(c.documentUrl));return own.length===1?own[0]:null;};const bridge=BrevessR20AgentBridge.createBroker({base,
  verifyHost:async (sender,claimedTabId)=>{
    if(sender?.id!==chrome.runtime.id||sender.frameId!==undefined&&sender.frameId!==0||!isHost(sender.url)||sender.documentLifecycle&&sender.documentLifecycle!=='active')return null;
    const tabId=sender.tab?.id??claimedTabId;
    const rows=await chrome.runtime.getContexts({contextTypes:['TAB'],...(sender.documentId?{documentIds:[sender.documentId]}:Number.isInteger(tabId)?{tabIds:[tabId]}:{})});
    const own=rows.filter(c=>c.contextType==='TAB'&&c.frameId===0&&c.tabId>=0&&c.windowId>=0&&isHost(c.documentUrl)&&
      c.documentUrl.split(/[?#]/)[0]===sender.url.split(/[?#]/)[0]&&(sender.documentId?c.documentId===sender.documentId:c.documentUrl.split('#')[0]===sender.url.split('#')[0])&&
      (tabId==null||c.tabId===tabId)&&(!sender.tab||c.windowId===sender.tab.windowId));
    return own.length===1?own[0]:null;
  },
  verifySidebar:async sender=>{
    if(sender?.id!==chrome.runtime.id||sender.url?.split(/[?#]/)[0]!==base+'workbench/agent-sidebar.html'||sender.documentLifecycle&&sender.documentLifecycle!=='active')return null;
    const contexts=await chrome.runtime.getContexts({contextTypes:['SIDE_PANEL'],...(sender.documentId?{documentIds:[sender.documentId]}:{documentUrls:[sender.url]})});
    const owners=contexts.filter(c=>c.contextType==='SIDE_PANEL'&&(sender.documentId?c.documentId===sender.documentId:c.documentUrl.split('#')[0]===sender.url.split('#')[0])&&c.documentUrl===sender.url&&c.documentUrl?.split(/[?#]/)[0]===base+'workbench/agent-sidebar.html');
    if(owners.length!==1)return null;
    if(owners[0].windowId>=0&&!/[?&]tabId=/.test(sender.url))return {windowId:owners[0].windowId};
    const params=new URL(sender.url).searchParams,tabHint=params.get('tabId');
    const tabId=tabHint!==null&&/^\d+$/.test(tabHint)?Number(tabHint):null;
    if(tabHint!==null&&!Number.isSafeInteger(tabId))return null;
    if(owners[0].windowId>=0&&tabId===null)return {windowId:owners[0].windowId};
    // Chrome can report -1 for SIDE_PANEL.windowId. The background sets a
    // per-window path; verify it against Chrome's active-tab panel options.
    const rawWindow=new URL(sender.url).searchParams.get('windowId');
    if(!/^[0-9]+$/.test(rawWindow||''))return null;
    const windowId=Number(rawWindow);if(!Number.isSafeInteger(windowId))return null;
    const tab=(await chrome.tabs.query({active:true,windowId}))[0];
    if(!tab||tab.windowId!==windowId||tabId!==null&&tab.id!==tabId||owners[0].windowId>=0&&owners[0].windowId!==windowId)return null;
    const options=await chrome.sidePanel.getOptions({tabId:tab.id});
    return options?.enabled&&new URL(options.path,base).href===sender.url?(tabId===null?{windowId}:{windowId,tabId}):null;
  },
  activeTab:async windowId=>{
    const [tab]=await chrome.tabs.query({active:true,windowId});
    if(!tab||tab.url)return tab;
    const frame=await context(tab.id);
    return frame?.windowId===windowId?{...tab,url:frame.documentUrl}:tab;
  },frame:tabId=>context(tabId)
 });chrome.runtime.onConnect.addListener(port=>void bridge.attach(port).catch(()=>{try{port.disconnect()}catch{}}));
})();
