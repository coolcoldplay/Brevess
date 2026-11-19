/* Connect the intro's feature buttons to the persistent, native-UI demo. */
(() => {
 const api=window.BV_DEMO_API,buttons=[...document.querySelectorAll('.story-capability[data-feature]')];
 if(!api||!buttons.length)return;
 let request=0;
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 async function ready(id){
   const deadline=performance.now()+20000;
   while(id===request&&performance.now()<deadline){
     const demo=api.sidebar.contentWindow?.__websiteDemo;
     if(demo?.ready&&demo.openFeature)return demo;
     await new Promise(resolve=>setTimeout(resolve,80));
   }
   if(id===request)throw new Error('DEMO_NOT_READY');
 }
 async function open(button){
   const id=++request,feature=button.dataset.feature;
   buttons.forEach(b=>b.removeAttribute('aria-busy'));button.setAttribute('aria-busy','true');
   api.dismissGuide();api.closeOverlays();
   document.querySelectorAll('.bv-expanded').forEach(el=>el.classList.remove('bv-expanded'));
   document.body.style.overflow='';
   const mobile=matchMedia('(max-width:760px)').matches;
   if(mobile)window.BV_MOBILE.open('reading');
   else window.BV_DECK.show('features',{align:true});
   api.loadFrame(api.sidebar);api.root.dataset.featureState='loading';
   try{
     const demo=await ready(id);if(id!==request)return;
     await demo.openFeature(feature);if(id!==request)return;
     // Native module messages and mobile layout settle before placing overlays.
     await frame();await frame();
     const deadline=performance.now()+2000;
     while(!mobile&&Math.abs(document.getElementById('demo-deck').getBoundingClientRect().top-72)>3&&performance.now()<deadline){await frame();if(id!==request)return;}
     if(id!==request||(mobile&&!window.BV_MOBILE.active))return;
     api.closeOverlays();
     if(feature==='evidence')api.jump('msa');
     else if(feature==='figures'){
       if(!mobile)api.jump('figure-'+demo.reading.figures[0]);
       api.setView('sidebar');
     }
     else if(feature==='search')api.readerTools.openSearch();
     else if(feature==='highlights')api.sample();
     else if(feature==='translate'){
       api.readerTools.translate();api.sample();
       document.getElementById('sci-selection-tab-translation')?.click();
     }
     else api.setView('sidebar');
     if(feature==='chat'&&!mobile)api.sidebar.contentDocument.getElementById('articleChatQuestion')?.focus({preventScroll:true});
     api.root.dataset.feature=feature;api.root.dataset.featureState='ready';
   }catch(error){
     if(id===request){api.root.dataset.featureState='error';api.toast(document.documentElement.lang==='en'?'The demo could not load. Please refresh and try again.':'演示暂未加载完成，请刷新后重试。');}
   }finally{if(id===request)button.removeAttribute('aria-busy');}
 }
 buttons.forEach(button=>button.addEventListener('click',()=>void open(button)));
})();
