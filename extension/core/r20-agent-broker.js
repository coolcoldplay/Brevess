(function(){
 const base=chrome.runtime.getURL('');const context=async tabId=>{const rows=await chrome.runtime.getContexts({contextTypes:['TAB']});const own=rows.filter(c=>c.tabId===tabId&&c.frameId===0&&c.documentUrl?.split(/[?#]/)[0]===base+'workbench/index.html');return own.length===1?own[0]:null;};const bridge=BrevessR20AgentBridge.createBroker({base,
  verifyHost:async sender=>{
    if(sender?.id!==chrome.runtime.id||sender.frameId!==undefined&&sender.frameId!==0||sender.url?.split(/[?#]/)[0]!==base+'workbench/index.html'||sender.documentLifecycle&&sender.documentLifecycle!=='active')return null;
    const rows=await chrome.runtime.getContexts({contextTypes:['TAB'],...(sender.documentId?{documentIds:[sender.documentId]}:{documentUrls:[sender.url]})});
    const own=rows.filter(c=>c.contextType==='TAB'&&(!sender.documentId||c.documentId===sender.documentId)&&(sender.documentId||c.documentUrl===sender.url)&&c.frameId===0&&c.tabId>=0&&c.windowId>=0&&c.documentUrl?.split(/[?#]/)[0]===base+'workbench/index.html');
    if(own.length!==1)return null;
    if(sender.tab&&(sender.tab.id!==own[0].tabId||sender.tab.windowId!==own[0].windowId))return null;
    return own[0];
  },
  verifySidebar:async sender=>{
    if(sender?.id!==chrome.runtime.id||sender.url?.split(/[?#]/)[0]!==base+'workbench/agent-sidebar.html'||sender.documentLifecycle&&sender.documentLifecycle!=='active')return null;
    const contexts=await chrome.runtime.getContexts({contextTypes:['SIDE_PANEL'],...(sender.documentId?{documentIds:[sender.documentId]}:{documentUrls:[sender.url]})});
    const owners=contexts.filter(c=>c.contextType==='SIDE_PANEL'&&(!sender.documentId||c.documentId===sender.documentId)&&c.documentUrl===sender.url&&c.documentUrl?.split(/[?#]/)[0]===base+'workbench/agent-sidebar.html');
    if(owners.length!==1)return null;
    if(owners[0].windowId>=0)return {windowId:owners[0].windowId};
    // Chrome can report -1 for SIDE_PANEL.windowId. The background sets a
    // per-window path; verify it against Chrome's active-tab panel options.
    const rawWindow=new URL(sender.url).searchParams.get('windowId');
    if(!/^[0-9]+$/.test(rawWindow||''))return null;
    const windowId=Number(rawWindow);if(!Number.isSafeInteger(windowId))return null;
    const tab=(await chrome.tabs.query({active:true,windowId}))[0];
    if(!tab||tab.windowId!==windowId)return null;
    const options=await chrome.sidePanel.getOptions({tabId:tab.id});
    return options?.enabled&&new URL(options.path,base).href===sender.url?{windowId}:null;
  },
  activeTab:async windowId=>(await chrome.tabs.query({active:true,windowId}))[0],frame:tabId=>context(tabId)
 });chrome.runtime.onConnect.addListener(port=>void bridge.attach(port).catch(()=>{try{port.disconnect()}catch{}}));
})();
