/* One viewport, three persistent demos. Inner readers retain their own scroll. */
(() => {
 const ids=['features','workbench','beyond-papers'],panels=ids.map(id=>document.getElementById(id));
 if(panels.some(p=>!p))return;
 const deck=document.createElement('div');deck.id='demo-deck';deck.className='demo-deck shell';
 panels[0].before(deck);
 const en=()=>document.documentElement.lang==='en';
 const names=()=>en()?['Paper reading','Research workbench','Beyond papers']:['论文精读','课题工作台','不止论文'];
 const nav=document.createElement('nav');nav.className='deck-nav';nav.setAttribute('aria-label','切换交互演示');
 const stage=document.createElement('div');stage.className='deck-stage';
 const footer=document.createElement('div');footer.className='deck-footer';
 footer.innerHTML='<span class="deck-count" aria-live="polite"></span><button class="deck-next" type="button"><span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6"/></svg></button>';
 const next=footer.querySelector('button'),count=footer.querySelector('.deck-count');
 let current=-1,releaseUntil=0,snapTimer,deckAligned=false;
 const offset=()=>Math.round(document.querySelector('.staged-nav')?.getBoundingClientRect().height||(innerWidth<=760?68:72));
 const deckTop=()=>scrollY+deck.getBoundingClientRect().top-offset();
 const motion=()=>matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth';
 const suspended=()=>document.body.classList.contains('bv-mobile-open')||!!document.querySelector('.bv-expanded,dialog[open]');
 function alignDeck(){deckAligned=true;scrollTo({top:deckTop(),behavior:motion()});}
 function leaveDeck(){releaseUntil=performance.now()+1000;scrollTo({top:scrollY+document.getElementById('install').getBoundingClientRect().top-offset(),behavior:motion()});}
 function resizeDeck(){deck.style.setProperty('--deck-offset',offset()+'px');}
 const tabs=panels.map((p,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-controls',p.id);b.addEventListener('click',()=>show(i,{align:true}));b.addEventListener('pointerenter',()=>prepare(i));b.addEventListener('focus',()=>prepare(i));nav.append(b);p.classList.add('deck-panel');stage.append(p);return b;});
 deck.append(nav,stage,footer);
 function prepare(i){
  if(i===2){const frame=panels[2].querySelector('.web-demo-frame');frame.loading='eager';if(!frame.getAttribute('src'))frame.src=frame.dataset.src;}
  else{const api=window.BV_DEMO_API;api?.loadFrame(i===0?api.sidebar:api.workbench);}
 }
 // Prepare one adjacent demo after the current native UI is ready. Avoid
 // competing with the initial sidebar or spending a data-saving connection.
 const queued=new Set();
 function warm(i){
  const connection=navigator.connection;
  if(queued.has(i)||connection?.saveData||/^(?:slow-)?2g$/.test(connection?.effectiveType||''))return;
  queued.add(i);
  const run=()=>{if(document.hidden){queued.delete(i);return;}prepare(i);};
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:2500});else setTimeout(run,250);
 }
 function warmNext(){
  const api=window.BV_DEMO_API;
  if(api?.sidebar.contentWindow?.__websiteDemo?.ready)warm(1);
  if(api?.workbench.contentWindow?.__websiteDemo?.ready)warm(2);
 }
 addEventListener('message',event=>{
  const api=window.BV_DEMO_API;
  if(event.origin!==location.origin||event.data?.source!=='brevess-native-demo'||event.data.type!=='ready')return;
  if(event.source===api?.sidebar.contentWindow)warm(1);
  if(event.source===api?.workbench.contentWindow)warm(2);
 });
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)warmNext();});
 function copy(){tabs.forEach((b,i)=>{b.textContent=names()[i];b.setAttribute('aria-pressed',String(current===i));});count.textContent=String(current+1).padStart(2,'0')+' / 03';next.querySelector('span').textContent=current<2?names()[current+1]:(en()?'Start reading':'开始阅读');}
 function show(value,{align=false,historyUpdate=true}={}){
  const i=typeof value==='string'?ids.indexOf(value):value;if(i<0||i>2)return;
  const changed=i!==current;current=i;
  panels.forEach((p,j)=>{p.hidden=j!==i;p.inert=j!==i;});copy();
  if(changed){stage.classList.remove('deck-enter');void stage.offsetWidth;stage.classList.add('deck-enter');}
  if(historyUpdate)history.replaceState(history.state,'','#'+ids[i]);
  if(align&&!window.BV_MOBILE?.active)alignDeck();
  prepare(i);
  requestAnimationFrame(()=>panels[i].querySelector('iframe')?.contentWindow?.dispatchEvent(new Event('resize')));
 }
 next.addEventListener('click',()=>current<2?show(current+1,{align:true}):leaveDeck());
 document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#"]');const id=a?.getAttribute('href').slice(1);if(!ids.includes(id))return;e.preventDefault();show(id,{align:true});});
 addEventListener('hashchange',()=>{if(ids.includes(location.hash.slice(1)))show(location.hash.slice(1),{align:true,historyUpdate:false});});
 document.addEventListener('brevess-languagechange',copy);
 // Align once on entry, then allow normal page scrolling away from the demo.
 // Changing modules is reserved for explicit navigation clicks.
 function settle(){
  if(suspended()||performance.now()<releaseUntil)return;
  const rect=deck.getBoundingClientRect();
  if(Math.abs(rect.top-offset())<=2){deckAligned=true;return;}
  if(!deckAligned&&rect.top<innerHeight-80&&rect.bottom>offset()+80)alignDeck();
 }
 addEventListener('scroll',()=>{const rect=deck.getBoundingClientRect();if(rect.bottom<=offset()||rect.top>=innerHeight)deckAligned=false;clearTimeout(snapTimer);snapTimer=setTimeout(settle,180);},{passive:true});
 addEventListener('scrollend',settle);
 addEventListener('resize',()=>{const aligned=Math.abs(deck.getBoundingClientRect().top-offset())<8;resizeDeck();if(aligned&&!suspended())scrollTo({top:deckTop(),behavior:'instant'});});
 resizeDeck();
 window.BV_DECK={show,get current(){return ids[current];}};
 const initial=ids.indexOf(location.hash.slice(1));show(initial<0?0:initial,{historyUpdate:false});
 warmNext();
 if(initial>=0)requestAnimationFrame(()=>scrollTo({top:deckTop(),behavior:'instant'}));
})();
