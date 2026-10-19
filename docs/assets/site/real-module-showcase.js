'use strict';
(() => {
  const root=document.querySelector('#real-showcase');if(!root)return;
  const video=root.querySelector('video'),still=root.querySelector('.real-still'),stage=root.querySelector('.real-stage');
  const tabs=[...document.querySelectorAll('[data-module]')],states=[...root.querySelectorAll('[data-real-state]')];
  const play=root.querySelector('#real-play'),zoom=root.querySelector('#real-zoom'),range=root.querySelector('#real-progress');
  const title=root.querySelector('#real-outcome'),caption=document.querySelector('#real-caption'),time=root.querySelector('#real-time');
  const info={
    navigation:{outcome:['段落预览 → 中文概述','Paragraph previews → AI summaries'],action:['双击导航，概述所选章节；单击段落标记返回原文。','Double-click Navigation to summarize selected sections. Click a paragraph marker to return to the source.']},
    highlights:{outcome:['原文 → 按语义分类的高亮','Plain text → semantic highlights'],action:['双击高亮，识别研究背景、问题、创新与结果，并在正文中标记。','Double-click Highlights to identify and mark background, questions, innovations and results in the paper.']},
    figures:{outcome:['Figure 原图 → Panel 逐项解读','Original figure → panel-by-panel analysis'],action:['双击 Fig1，选择图像模式；查看各 Panel 的设计、结果与解读。','Double-click Fig1 and choose image input, then inspect the design, results and interpretation for each panel.']},
    chat:{outcome:['具体问题 → 带原文依据的回答','A research question → an evidence-linked answer'],action:['输入问题并发送，查看回答和原文依据。问答使用发送操作。','Type a question and send it, then inspect the answer and source links. Q&A uses the Send action.']},
    notes:{outcome:['空白模板 → 结构化阅读笔记','Empty template → structured reading notes'],action:['选择笔记字段，双击笔记；AI 填写研究问题、主要发现等内容。','Select note fields and double-click Notes to fill research questions, key findings and other fields.']}
  };
  let active='navigation',state='after',generation=0,en=()=>document.documentElement.lang==='en';
  const tr=(a,b)=>en()?b:a,asset=kind=>'assets/site/real-'+active+'-'+kind+'.webp';
  function labels(){const i=en()?1:0;title.textContent=info[active].outcome[i];caption.textContent=info[active].action[i];play.textContent=video.paused?tr('播放操作','Play recording'):tr('暂停','Pause');zoom.textContent=stage.dataset.zoom==='sidebar'?tr('查看完整浏览器','Show full browser'):tr('放大侧栏','Enlarge sidebar');zoom.setAttribute('aria-pressed',String(stage.dataset.zoom==='sidebar'));root.setAttribute('aria-label',tr('真实论文与原生侧栏操作实录','Real paper and native sidebar recordings'));still.alt=tr('AlphaFold 论文与 BREVESS 侧栏的实际'+(state==='before'?'生成前':'生成后')+'画面','Actual AlphaFold article and BREVESS sidebar '+(state==='before'?'before':'after')+' AI generation');video.setAttribute('aria-label',tr('AlphaFold 真实侧栏 AI 操作实录','Actual AI workflow in the native sidebar on AlphaFold'));range.setAttribute('aria-label',tr('演示进度','Recording progress'));}
  function setState(next){state=next;states.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.realState===next)));video.hidden=next!=='video';still.hidden=next==='video';if(next!=='video'){video.pause();still.src=asset(next);}labels();}
  function activate(tab,shouldPlay=false){const current=++generation;video.pause();active=tab.dataset.module;tabs.forEach(b=>{const on=b===tab;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});root.setAttribute('aria-labelledby',tab.id);video.poster=asset('before');video.src='assets/site/real-'+active+'.mp4';video.load();range.value='0';time.textContent='0:00';setState(shouldPlay?'video':'after');if(shouldPlay)video.play().catch(()=>{if(current===generation&&state==='video')setState('after');});}
  tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>activate(tab,!matchMedia('(prefers-reduced-motion: reduce)').matches));tab.addEventListener('keydown',e=>{let j;if(e.key==='ArrowRight')j=(i+1)%tabs.length;if(e.key==='ArrowLeft')j=(i+tabs.length-1)%tabs.length;if(e.key==='Home')j=0;if(e.key==='End')j=tabs.length-1;if(j!==undefined){e.preventDefault();tabs[j].focus();activate(tabs[j]);}});});
  states.forEach(b=>b.addEventListener('click',()=>setState(b.dataset.realState)));
  play.addEventListener('click',()=>{if(state==='video'&&!video.paused)video.pause();else{if(video.ended)video.currentTime=0;const current=generation;setState('video');video.play().catch(()=>{if(current===generation&&state==='video')setState('after');});}});
  zoom.addEventListener('click',()=>{stage.dataset.zoom=stage.dataset.zoom==='sidebar'?'full':'sidebar';labels();});
  root.querySelector('#real-fullscreen').addEventListener('click',()=>{if(document.fullscreenElement)document.exitFullscreen?.();else root.requestFullscreen?.().catch(()=>{});});
  range.addEventListener('input',()=>{setState('video');if(Number.isFinite(video.duration))video.currentTime=Number(range.value)/100*video.duration;});
  video.addEventListener('timeupdate',()=>{range.value=Number.isFinite(video.duration)?String(100*video.currentTime/video.duration):'0';time.textContent=Math.floor(video.currentTime/60)+':'+String(Math.floor(video.currentTime%60)).padStart(2,'0');});
  video.addEventListener('play',labels);video.addEventListener('pause',labels);video.addEventListener('ended',()=>{if(state==='video')setState('after');});
  new IntersectionObserver(entries=>{if(!entries[0].isIntersecting)video.pause();},{threshold:.05}).observe(root);
  document.addEventListener('brevess-languagechange',labels);activate(tabs.find(t=>t.dataset.module==='figures'));
})();
