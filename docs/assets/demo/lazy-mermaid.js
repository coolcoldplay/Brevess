/* Mermaid is downloaded only when a diagram is actually rendered. */
(() => {
 let pending,settings;
 const proxy={initialize(value){settings=value;},run:async(...args)=>(await load()).run(...args),render:async(...args)=>(await load()).render(...args),parse:async(...args)=>(await load()).parse(...args)};
 function load(){
  if(pending)return pending;
  pending=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=new URL('vendor/mermaid/mermaid.min.js',__websiteDemo.base).href;
   script.onload=()=>{try{const actual=globalThis.mermaid;if(actual===proxy)throw Error('Diagram renderer did not initialize');if(settings)actual.initialize(settings);resolve(actual);}catch(error){pending=null;reject(error);}};
   script.onerror=()=>{pending=null;script.remove();reject(Error('Could not load the diagram renderer'));};
   document.head.append(script);
  });return pending;
 }
 globalThis.mermaid=proxy;
})();
