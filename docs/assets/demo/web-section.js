/* The general-web preview is isolated from the paper/workbench demonstration. */
addEventListener('message',event=>{
 const frame=document.querySelector('.web-demo-frame');
 if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.source!=='brevess-web-demo')return;
 if(event.data.type==='install')document.getElementById('install')?.scrollIntoView({behavior:'smooth'});
});
