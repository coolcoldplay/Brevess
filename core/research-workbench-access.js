(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('./research-workbench-model.js'):root.SciLLM);if(common)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,function(s){
  'use strict';
  const READ_MESSAGES=new Set(['LOCAL_READING_LIBRARY_QUERY','ARTICLE_WORKSPACE_LIST_ASSETS','ARTICLE_WORKSPACE_GET_ASSET','ARTICLE_WORKSPACE_GET_BINARY_ASSET']);
  const WORKBENCH_MESSAGES=new Set([...READ_MESSAGES,'RESEARCH_WORKBENCH_SYNC','RESEARCH_WORKBENCH_DIRECTORY_STATUS','RESEARCH_WORKBENCH_LOCATE_SOURCE']);
  function samePage(actual,expected){try{const a=new URL(actual),b=new URL(expected);return a.protocol===b.protocol&&a.host===b.host&&a.pathname===b.pathname&&!a.username&&!a.password;}catch{return false;}}
  function isResearchWorkbenchSender(sender,{runtimeId,getURL},type){
    if(!runtimeId||sender?.id!==runtimeId||!WORKBENCH_MESSAGES.has(type)||!Number.isSafeInteger(sender.frameId)||sender.frameId<0||!Number.isInteger(sender.tab?.id)||!samePage(sender.url,getURL('workbench/index.html')))return false;
    if(sender.frameId===0)return samePage(sender.tab.url,getURL('workbench/index.html'));
    return samePage(sender.tab.url,getURL('options.html'));
  }
  async function requireResearchWorkbenchMessageAccess({sender,message,store,runtimeId,getURL}){
    if(!isResearchWorkbenchSender(sender,{runtimeId,getURL},message?.type))throw s.wbError('WORKBENCH_SENDER_FORBIDDEN');
    if(['RESEARCH_WORKBENCH_SYNC','RESEARCH_WORKBENCH_LOCATE_SOURCE'].includes(message.type)){
      s.wbId(message.projectId);const project=await store.getProject(message.projectId);if(!project)throw s.wbError('WORKBENCH_PROJECT_NOT_FOUND');return project;
    }
    return null;
  }
  return {isResearchWorkbenchSender,requireResearchWorkbenchMessageAccess};
});
