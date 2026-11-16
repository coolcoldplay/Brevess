(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else Object.assign(root.Workbench ||= {},api);})(globalThis,()=>{
 const expired=()=>Object.assign(new Error('Agent 工作台或侧栏已变化，旧任务已停止；已提交的操作请核对回执。'),{code:'WORKBENCH_AGENT_OWNER_EXPIRED'});
 function createAgentLifetime({getOwner,cancel=()=>{}}){let disposed=false,epoch=0,owner=getOwner(),lease=null,task=null,expected;const grants=new Set();
  const alive=()=>{if(disposed)throw expired()};
  const invalidate=()=>{epoch++;task=null;expected=undefined;grants.clear();cancel();};
  const api={claim(id){alive();if(lease&&lease!==id)throw expired();lease=id;},release(id){if(lease!==id)return;lease=null;invalidate();},begin(id){alive();if(!lease||lease!==id)throw expired();invalidate();task={id:++epoch,owner:getOwner()};return task.id;},end(id){if(task?.id===id)invalidate();},expectOwner(id){alive();expected=id;},observe(){if(disposed)return;const next=getOwner();if(next===owner)return;owner=next;if(expected===next){if(task)task.owner=next;for(const grant of grants)grant.owner=next;expected=undefined;}else invalidate();},capture(){alive();api.observe();const grant={epoch,owner:getOwner()};grants.add(grant);return grant;},assert(token){alive();api.observe();if(!token||token.epoch!==epoch||token.owner!==getOwner())throw expired();},dispose(){if(disposed)return;disposed=true;lease=null;invalidate();},get lease(){return lease;}};return api;
 }return {createAgentLifetime};
});
