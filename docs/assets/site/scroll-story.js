'use strict';
(() => {
  const story = document.querySelector('.scroll-story');
  if (!story) return;
  const sticky = story.querySelector('.story-sticky');
  const nav=document.querySelector('.staged-nav'), browser=story.querySelector('.story-browser'), extension=story.querySelector('.story-extension'), frame=story.querySelector('.story-sidebar iframe');
  let manualPanel=null;
  function navigation(){const visible=story.getBoundingClientRect().bottom<=0;nav?.classList.toggle('is-visible',visible);if(nav){nav.inert=!visible;nav.setAttribute('aria-hidden',String(!visible));}}
  function browserScene(p,visible){
    const opened=manualPanel===null?phase(p,.384,.435):Number(manualPanel);
    const reveal=manualPanel===null?phase(p,.35,.39):1;
    browser.style.setProperty('--panel-open',opened);browser.style.setProperty('--paper-show',reveal);
    browser.style.setProperty('--pointer-travel',phase(p,.346,.382));browser.style.setProperty('--pointer-visible',manualPanel===null?phase(p,.34,.35)*(1-phase(p,.405,.425)):0);
    extension.style.setProperty('--icon-press',phase(p,.378,.384)*(1-phase(p,.39,.4)));
    extension.setAttribute('aria-expanded',String(opened>.5));extension.setAttribute('aria-label',opened>.5?'收起 BREVESS 侧栏演示':'展开 BREVESS 侧栏演示');
    browser.inert=!visible;browser.style.pointerEvents=visible?'auto':'none';
    if(visible&&p>.32&&!frame.getAttribute('src'))frame.src=frame.dataset.src;
    if(!visible&&frame.getAttribute('src'))frame.removeAttribute('src');
  }
  extension?.addEventListener('click',()=>{manualPanel=extension.getAttribute('aria-expanded')!=='true';browser.classList.add('is-manual');browserScene(Number(story.dataset.progress)||.4,true);});
  const scenes = [...story.querySelectorAll('.story-scene')];
  const seeds = [...story.querySelectorAll('.story-seed')];
  const extras = [...story.querySelectorAll('.story-extra')];
  const meanings = [...story.querySelectorAll('.story-meaning')];
  const shared = story.querySelector('.story-shared-letter');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const flow = story.querySelector('.story-flow');
  const caption = story.querySelector('.story-brand-caption');
  let pending = false;
  let geometry;
  const clamp = v => Math.max(0, Math.min(1, v));
  const smooth = v => { v = clamp(v); return v*v*v*(v*(v*6-15)+10); };
  const phase = (p,a,b) => smooth((p-a)/(b-a));
  const mix = (a,b,p) => a+(b-a)*p;
  // DOM measurement keeps the wordmark aligned with the actual system font.
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden','true');
  probe.style.cssText='position:absolute;visibility:hidden;white-space:pre;line-height:1;font-weight:650;letter-spacing:-.045em;pointer-events:none';
  sticky.append(probe);
  const width = (text,size) => { probe.style.fontSize=`${size}px`; probe.textContent=text; return probe.getBoundingClientRect().width; };
  function measure() {
    const w=sticky.clientWidth,h=sticky.clientHeight,mobile=w<=640;
    const start=Math.max(64,Math.min(190,w*.117));
    const end=mobile?Math.min(42,w*.099):Math.min(70,w*.044);
    const wholeWidth=width('BREVESS',start),origin=(w-wholeWidth)/2;
    const xs=mobile?[w*.5,w*.5,w*.5]:[w*.195,w*.5,w*.805];
    const ys=mobile?[h*.25,h*.45,h*.65]:[h*.43,h*.43,h*.43];
    const prefixes=['','BR','BREV'];
    const whole=['BREVITY','EVIDENCE','ESSENCE'];
    geometry={w,h,start,end,origin,xs,ys,starts:prefixes.map(s=>origin+width(s,start)),ends:whole.map((s,i)=>xs[i]-width(s,end)/2),seedWidths:['BRE','EV','ESS'].map(s=>width(s,end)),mobile};
  }
  function render() {
    pending=false;
    navigation();
    if(reduced.matches){const r=browser.getBoundingClientRect();browserScene(.44,r.bottom>0&&r.top<innerHeight);return;}
    if(!geometry) measure();
    const g=geometry;
    const range=story.offsetHeight-sticky.offsetHeight;
    const p=clamp(-story.getBoundingClientRect().top/Math.max(1,range));
    story.style.setProperty('--story-progress',p.toFixed(5));
    story.dataset.progress=p.toFixed(4);
    const browserVisible=p>.29&&p<.51;
    if(!browserVisible){manualPanel=null;browser.classList.remove('is-manual');}
    browserScene(p,browserVisible);
    const spread=phase(p,.025,.18),reveal=phase(p,.14,.235);
    const size=mix(g.start,g.end,spread),scale=size/g.end;
    seeds.forEach((seed,i)=>{
      const x=mix(g.starts[i],g.ends[i],spread), y=mix(g.h*.42,g.ys[i],spread);
      seed.style.fontSize=`${g.end}px`;
      seed.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;
      extras[i].style.fontSize=`${g.end}px`;
      extras[i].style.left=`${g.seedWidths[i]}px`;
      extras[i].style.opacity=reveal;
      meanings[i].style.transform=`translate3d(${g.xs[i]}px,${y+size+(g.mobile?17:31)}px,0) translateX(-50%)`;
      meanings[i].style.opacity=phase(p,.18,.25);
    });
    shared.style.opacity=phase(p,.035,.10);
    caption.style.opacity=phase(p,.21,.26);
    const opacities=[1-phase(p,.26,.32),phase(p,.29,.35)*(1-phase(p,.45,.51)),phase(p,.48,.55)*(1-phase(p,.68,.74)),phase(p,.71,.79)];
    scenes.forEach((scene,i)=>{scene.style.opacity=opacities[i];scene.setAttribute('aria-hidden',opacities[i]<.5?'true':'false');if(i)scene.style.transform=`translateY(${(1-opacities[i])*24}px)`;});
    story.style.setProperty('--dual-progress',phase(p,.54,.67));
    const progress=phase(p,.79,.97);flow.style.setProperty('--flow-progress',progress);
    [...flow.children].forEach((li,i)=>li.classList.toggle('is-active',progress>=i/4));
  }
  function schedule(){if(!pending){pending=true;requestAnimationFrame(render);}}
  function mode(){story.classList.toggle('is-static',reduced.matches);scenes.forEach(s=>s.setAttribute('aria-hidden','false'));geometry=null;schedule();}
  addEventListener('scroll',schedule,{passive:true});
  addEventListener('resize',()=>{geometry=null;schedule();},{passive:true});
  document.addEventListener('brevess-languagechange',()=>{geometry=null;schedule();});
  reduced.addEventListener('change',mode);
  document.fonts?.ready.then(()=>{geometry=null;schedule();});
  mode();
})();
