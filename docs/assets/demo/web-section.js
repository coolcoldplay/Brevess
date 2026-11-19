/* The general-web preview is isolated from the paper/workbench demonstration. */
addEventListener('message',event=>{
 const frame=document.querySelector('.web-demo-frame');
 if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.source!=='brevess-web-demo')return;
 if(event.data.type==='install')document.getElementById('install')?.scrollIntoView({behavior:'smooth'});
});

document.addEventListener('brevess-languagechange',()=>document.querySelector('.web-demo-frame')?.contentWindow?.postMessage({source:'brevess-website',type:'language',language:document.documentElement.lang},location.origin));
