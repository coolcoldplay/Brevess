(function(root){
 'use strict';
 const key='brevessAiPrivacyAcknowledgementV1';
 const valid=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&value.version===1&&value.acknowledged===true&&Number.isSafeInteger(value.updatedAt)&&value.updatedAt>0;
 let confirmed=false,saving=false,pendingChoice=false,failed=false,epoch=0,lastChangedValue,ready=false,input,status,fieldset;
 function render(){if(!input)return;input.checked=saving?pendingChoice:confirmed&&!failed;input.disabled=!ready||saving;fieldset.disabled=!ready||!confirmed||saving||failed;status.dataset.state=failed?'error':saving?'saving':confirmed?'confirmed':'pending';status.textContent=failed?'风险知情记录读写失败，配置入口保持关闭；请重开设置后重试。':saving?'正在保存风险知情记录…':confirmed?'已确认 · 仅在本机保存；可随时取消':'请先确认知晓数据隐私风险，再配置模型连接。';}
 async function reconcile(){const start=epoch;try{const value=await chrome.storage.local.get(key);confirmed=valid(start===epoch?value[key]:lastChangedValue);ready=true;failed=false;render();return confirmed;}catch(error){confirmed=false;failed=true;render();throw error;}}
 root.BrevessRiskGate={async requireAcknowledgement(){if(!saving&&!failed&&await reconcile())return true;throw Object.assign(new Error('请先在设置的隐私与权限中确认数据隐私风险。'),{code:'AI_PRIVACY_ACK_REQUIRED'});}};
 chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!Object.hasOwn(changes,key))return;epoch++;lastChangedValue=changes[key].newValue;confirmed=valid(lastChangedValue);failed=false;render();});
 function mount(){input=document.getElementById('aiPrivacyAcknowledged');status=document.getElementById('aiPrivacyAcknowledgementStatus');fieldset=document.getElementById('apiProfilesSettings');if(!input||!status||!fieldset)return;render();void reconcile().catch(()=>{});
  input.addEventListener('change',async event=>{if(!event.isTrusted||saving||!ready){render();return;}const wanted=input.checked;pendingChoice=wanted;saving=true;render();try{const commit=()=>chrome.storage.local.set({[key]:{version:1,acknowledged:wanted,updatedAt:Date.now()}});if(root.navigator?.locks)await root.navigator.locks.request(key,commit);else await commit();await reconcile();}catch{confirmed=false;failed=true;}finally{saving=false;render();}});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})(globalThis);
