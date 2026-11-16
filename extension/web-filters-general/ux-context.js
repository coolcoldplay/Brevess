(function(g,factory){const api=factory();if(typeof module==='object')module.exports=api;g.WFGUXContext=api;})(globalThis,function(){
'use strict';
function outlineIntent(question){const q=String(question||'').trim();return /(?:调整|修改|自定义|重做|设置|分组|过滤).{0,18}(?:插件)?(?:大纲|目录)|(?:提取|生成).{0,12}(?:插件|侧栏).{0,8}(?:大纲|目录)|(?:大纲|目录).{0,18}(?:提取|分组|层级|范围|字段|排除)|(?:按|每)(?:每)?(?:条|个|篇|项).{0,20}(?:动态|帖子|消息|文章|事件|活动|结果).{0,25}(?:列出|提取|显示|分组)|(?:adjust|customize|change|extract|group).{0,30}(?:outline|toc)/i.test(q);}
function route({question='',adjustmentMode='display',contextScope={},webSearch={mode:'off'},sourceIds=[],adjusting=false,hasAuxiliarySources=false}={}){
 const mode=webSearch?.mode??'off';
 if(!['off','on','deep','auto'].includes(mode))throw Error('WEB_SEARCH_MODE_INVALID');
 const scoped=['sectionIds','sectionTitles','scopes'].some(k=>Array.isArray(contextScope?.[k])&&contextScope[k].length>0);
 if(adjusting&&outlineIntent(question)){if(scoped)throw Error('ORIGINAL_CONTEXT_COMBINATION_UNSUPPORTED');return {kind:'outline',webSearch:{mode:'off',enabled:false},contextScope};}
 if(adjusting){if(scoped)throw Error('ORIGINAL_CONTEXT_COMBINATION_UNSUPPORTED');return {kind:'display',webSearch:{mode:'off',enabled:false},contextScope};}
 if(sourceIds.length<=1&&(!hasAuxiliarySources||scoped||mode!=='off'))return {kind:'original',scoped,webSearch:{mode,enabled:['on','deep'].includes(mode)},contextScope};
 if(scoped||mode!=='off')throw Error('ORIGINAL_CONTEXT_COMBINATION_UNSUPPORTED');
 return {kind:'research',webSearch:{mode:'off',enabled:false},contextScope};
}
function shouldSubmit(e){return e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing&&!e.composing&&e.keyCode!==229;}
return {route,shouldSubmit,outlineIntent};
});
