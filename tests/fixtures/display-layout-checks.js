// Browser layout regression: exercise the actual composer inside a constrained, full chat.
window.runCompactChecks=async function(){
 const form=document.querySelector('#articleChatForm'),originalParent=form.parentNode,next=form.nextSibling,host=document.createElement('section'),log=document.createElement('div'),checks=[];
 host.style.cssText='display:flex;flex-direction:column;height:620px;overflow:hidden';log.style.cssText='flex:1 1 auto;min-height:0;overflow:auto';log.textContent='Long model response. '.repeat(2000);host.append(log,form);document.body.append(host);form.style.boxSizing='border-box';
 for(const width of [320,380,600]){host.style.width=width+'px';form.style.width='100%';const r=form.getBoundingClientRect(),flow=form.querySelector('.wfg-workflow').getBoundingClientRect(),send=form.querySelector('[type=submit]').getBoundingClientRect();checks.push({name:width+'px 长回复与完整编辑区',passed:r.height<=Math.min(innerHeight*.46,360)+1&&form.scrollWidth<=form.clientWidth&&flow.height>=64&&send.bottom<=r.bottom+1&&log.clientHeight>220,formHeight:r.height,workflowHeight:flow.height,replyHeight:log.clientHeight});}
 const input=form.querySelector('textarea');input.value='收起时保留草稿';input.dispatchEvent(new Event('input',{bubbles:true}));const before=form.getBoundingClientRect().height;form.querySelector('.wfg-workflow-collapse').click();await Promise.resolve();checks.push({name:'收起释放回复空间并保留草稿',passed:form.getBoundingClientRect().height<before-50&&input.value==='收起时保留草稿',before,after:form.getBoundingClientRect().height});form.querySelector('.wfg-workflow-collapse').click();
 originalParent.insertBefore(form,next);host.remove();return checks;
};

document.querySelector("#check-layout").onclick=async()=>{window.compactChecks=await window.runCompactChecks();document.querySelector("#results").textContent=JSON.stringify(window.compactChecks,null,2);};
