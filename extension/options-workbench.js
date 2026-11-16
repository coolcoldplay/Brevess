(function(root){
  'use strict';
  function mountResearchWorkbenchSettings(){
    const frame=document.getElementById('researchWorkbenchFrame');
    if(frame&&!frame.hasAttribute('src'))frame.setAttribute('src',chrome.runtime.getURL('workbench/index.html#library'));
  }
  Object.assign(root.SciLLM ||= {},{mountResearchWorkbenchSettings});
})(globalThis);
