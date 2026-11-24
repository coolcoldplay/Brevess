/* Button names stay available to keyboard and assistive-technology users. */
const PanelIcons=(()=>{
  const ns='http://www.w3.org/2000/svg';
  const tip=document.createElement('div');
  const popovers=typeof tip.showPopover==='function';
  let timer,owner;
  if(popovers){
    tip.popover='manual';tip.className='icon-tip';tip.setAttribute('aria-hidden','true');
    document.body.append(tip);
  }
  function set(button,icon,label){
    let svg=button.querySelector('.tool-icon');
    if(svg&&button.dataset.icon===icon&&button.getAttribute('aria-label')===label)return button;
    if(!svg){
      if(button.title)button.dataset.help=button.title;
      svg=document.createElementNS(ns,'svg');
      svg.setAttribute('class','tool-icon');svg.setAttribute('viewBox','0 0 24 24');
      svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
      svg.append(document.createElementNS(ns,'use'));
      const caption=document.createElement('span');
      caption.className=button.hasAttribute('data-caption')?'button-caption':'visually-hidden';
      button.replaceChildren(svg,caption);
    }
    button.dataset.icon=icon;svg.firstElementChild.setAttribute('href','#icon-'+icon);
    button.setAttribute('aria-label',label);
    button.lastElementChild.textContent=button.dataset.caption||label;
    const help=button.dataset.help;
    const text=help&&help!==label?label+' · '+help:label;
    button.dataset.tooltip=text;
    if(help)button.setAttribute('aria-description',help);
    if(popovers)button.removeAttribute('title');else button.title=text;
    return button;
  }
  function hide(){
    clearTimeout(timer);owner=null;
    if(tip.matches(':popover-open'))tip.hidePopover();
  }
  function show(button,delay){
    if(!button||button.disabled||owner===button)return;
    hide();owner=button;
    timer=setTimeout(()=>{
      if(!button.isConnected||!button.getClientRects().length)return;
      (button.closest('dialog[open]')||document.body).append(tip);
      tip.textContent=button.dataset.tooltip;tip.showPopover();
      const r=button.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
      tip.style.left=Math.max(6,Math.min(window.innerWidth-w-6,(r.left+r.right-w)/2))+'px';
      tip.style.top=(r.top>=h+9?r.top-h-6:r.bottom+6)+'px';
    },delay);
  }
  for(const button of document.querySelectorAll('button[data-icon]')){
    set(button,button.dataset.icon,button.getAttribute('aria-label')||button.textContent.trim());
  }
  if(popovers){
    const buttonAt=e=>e.target.closest?.('button[data-icon]');
    document.addEventListener('pointerover',e=>{if(e.pointerType!=='touch')show(buttonAt(e),240);});
    document.addEventListener('pointerout',e=>{if(owner?.contains(e.target)&&!owner.contains(e.relatedTarget))hide();});
    document.addEventListener('focusin',e=>{const b=buttonAt(e);if(b?.matches(':focus-visible'))show(b,0);});
    document.addEventListener('focusout',hide);
    document.addEventListener('pointerdown',hide,true);
    document.addEventListener('scroll',hide,true);
    document.addEventListener('close',hide,true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
    window.addEventListener('blur',hide);
    window.addEventListener('resize',hide);
  }
  return {set};
})();
