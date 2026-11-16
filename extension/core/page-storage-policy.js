(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.BrevessPageStoragePolicy=api;})(globalThis,function(){
 'use strict';
 function sourceMetadata(value){return{...structuredClone(value),nodes:[]};}
 function selectSourceAsset(path,content,{includePage=false,existing=null}={}){
  if(includePage)return{content};
  if(path==='article/paragraphs.json')return{skip:true};
  if(path==='article/structure.json')return existing?.nodes?.length?{skip:true}:{content:sourceMetadata(content)};
  return{content};
 }
 return{sourceMetadata,selectSourceAsset};
});
