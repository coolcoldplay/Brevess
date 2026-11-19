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
 let current=-1,lastSwitch=0,wheel=0;
 const tabs=panels.map((p,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-controls',p.id);b.addEventListener('click',()=>show(i));nav.append(b);p.classList.add('deck-panel');stage.append(p);return b;});
 deck.append(nav,stage,footer);
 function copy(){tabs.forEach((b,i)=>{b.textContent=names()[i];b.setAttribute('aria-pressed',String(current===i));});count.textContent=String(current+1).padStart(2,'0')+' / 03';next.querySelector('span').textContent=current<2?names()[current+1]:(en()?'Start reading':'开始阅读');}
 function show(value,{align=false,historyUpdate=true}={}){
  const i=typeof value==='string'?ids.indexOf(value):value;if(i<0||i>2)return;
  const changed=i!==current;current=i;
  panels.forEach((p,j)=>{p.hidden=j!==i;p.inert=j!==i;});copy();
  if(changed){stage.classList.remove('deck-enter');void stage.offsetWidth;stage.classList.add('deck-enter');}
  if(historyUpdate)history.replaceState(history.state,'','#'+ids[i]);
  if(align&&!window.BV_MOBILE?.active)scrollTo({top:scrollY+deck.getBoundingClientRect().top-(innerWidth<=760?68:72),behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
  if(i===2){const frame=panels[2].querySelector('.web-demo-frame');if(!frame.getAttribute('src'))frame.src=frame.dataset.src;}
  if(i===0)window.BV_DEMO_API?.loadFrame(window.BV_DEMO_API.sidebar);
  if(i===1)window.BV_DEMO_API?.loadFrame(window.BV_DEMO_API.workbench);
  lastSwitch=performance.now();wheel=0;
 }
 next.addEventListener('click',()=>current<2?show(current+1):document.getElementById('install').scrollIntoView({behavior:'smooth'}));
 document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#"]');const id=a?.getAttribute('href').slice(1);if(!ids.includes(id))return;e.preventDefault();show(id,{align:true});});
 addEventListener('hashchange',()=>{if(ids.includes(location.hash.slice(1)))show(location.hash.slice(1),{align:true,historyUpdate:false});});
 document.addEventListener('brevess-languagechange',copy);
 deck.addEventListener('wheel',e=>{
  if(e.ctrlKey||document.body.classList.contains('bv-mobile-open')||document.querySelector('.bv-expanded')||e.target.closest('.bv-paper,.bv-workbench-scroll,dialog,[data-semantic-find-root]'))return;
  const top=deck.getBoundingClientRect().top,navHeight=innerWidth<=760?68:72;
  if(Math.abs(top-navHeight)>6)return;
  e.preventDefault();if(performance.now()-lastSwitch<750)return;
  wheel+=e.deltaY;if(Math.abs(wheel)<70)return;
  if(wheel>0&&current<2)show(current+1);
  else if(wheel<0&&current>0)show(current-1);
  else{lastSwitch=performance.now();wheel=0;(current===2?document.getElementById('install'):document.querySelector('.story-intro')).scrollIntoView({behavior:'smooth'});}
 },{passive:false});
 window.BV_DECK={show,get current(){return ids[current];}};
 const initial=ids.indexOf(location.hash.slice(1));show(initial<0?0:initial,{historyUpdate:false});
 if(initial>=0)requestAnimationFrame(()=>scrollTo({top:scrollY+deck.getBoundingClientRect().top-(innerWidth<=760?68:72),behavior:'instant'}));
})();
