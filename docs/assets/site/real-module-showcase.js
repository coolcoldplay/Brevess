'use strict';
(() => {
  const root = document.querySelector('#real-showcase');
  if (!root) return;
  const video = root.querySelector('video'), still = root.querySelector('.real-still'), stage = root.querySelector('.real-stage');
  const tabs = [...document.querySelectorAll('[data-module]')], states = [...root.querySelectorAll('[data-real-state]')];
  const play = root.querySelector('#real-play'), zoom = root.querySelector('#real-zoom'), range = root.querySelector('#real-progress');
  const title = root.querySelector('#real-outcome'), caption = document.querySelector('#real-caption'), time = root.querySelector('#real-time');
  const stamp = document.querySelector('#real-version');
  const info = {
    navigation: { outcome: ['段落预览 → 中文概述', 'Paragraph previews → AI summaries'], action: ['早期版本演示：双击导航概述所选章节；单击段落标记返回原文。', 'Earlier-version recording: summarize selected sections and follow paragraph markers back to the source.'] },
    highlights: { outcome: ['原文 → 按语义分类的高亮', 'Plain text → semantic highlights'], action: ['早期版本演示：识别研究背景、问题、创新与结果，并在正文中标记。', 'Earlier-version recording: identify background, questions, innovations and results in the paper.'] },
    figures: { current: true, outcome: ['Figure 原图 → Panel 证据解读', 'Original figure → panel evidence'], action: ['2026-11-17 实测：选择 Figure 1 原图，实际生成 A–E 解读。视频为选择图像和查看结果的关键画面剪辑，不表示请求耗时。', 'Tested on 17 Nov 2026: Figure 1 image input produced A–E analyses. The video is an edited sequence of actual workflow captures, not a latency measurement.'], before: 'r27-figures-before', after: 'r27-figures-after', clip: 'r27-figures.webm' },
    chat: { current: true, outcome: ['带引用的回答 → 表格大窗口', 'Cited answer → spacious table viewer'], action: ['2026-11-17 实测：比较 Evoformer、结构模块与 recycling；点击引用回到原文，展开 3 行 5 列表格。视频为实测关键画面剪辑。', 'Tested on 17 Nov 2026: compare Evoformer, the structure module and recycling; follow citations and expand the 3-row, 5-column table. Video uses actual captured keyframes.'], before: 'r27-chat-citation', after: 'r27-chat-table', clip: 'r27-chat.webm', stateLabels: [['回答与引用', 'Cited answer'], ['展开表格', 'Expanded table']] },
    notes: { outcome: ['空白模板 → 结构化阅读笔记', 'Empty template → structured notes'], action: ['早期版本演示：选择笔记字段，生成阅读笔记；证据核对仍需完成。', 'Earlier-version recording: generate selected note fields. Evidence checking still requires completion.'] }
  };
  let active = 'figures', state = 'after', generation = 0;
  const en = () => document.documentElement.lang === 'en';
  const tr = (a, b) => en() ? b : a;
  const asset = kind => 'assets/site/' + (info[active][kind] || 'real-' + active + '-' + kind) + '.webp';
  function labels() {
    const data = info[active], i = en() ? 1 : 0;
    title.textContent = data.outcome[i]; caption.textContent = data.action[i];
    stamp.textContent = data.current ? tr('Chrome · 1.0.2 r27 · 2026-11-17', 'Chrome · 1.0.2 r27 · 17 Nov 2026') : tr('早期版本实录 · Edge', 'Earlier-version recording · Edge');
    states.forEach((b, index) => { b.textContent = data.stateLabels ? data.stateLabels[index][i] : (index ? tr('生成后', 'After AI') : tr('生成前', 'Before AI')); });
    play.textContent = video.paused ? tr(data.current ? '播放画面' : '播放操作', data.current ? 'Play captures' : 'Play recording') : tr('暂停', 'Pause');
    zoom.hidden = active === 'chat';
    zoom.textContent = stage.dataset.zoom === 'sidebar' ? tr('查看完整画面', 'Show full view') : tr('放大侧栏', 'Enlarge sidebar');
    zoom.setAttribute('aria-pressed', String(stage.dataset.zoom === 'sidebar'));
    still.alt = tr('AlphaFold 论文中 BREVESS 的实际界面：', 'Actual BREVESS interface on AlphaFold: ') + data.outcome[i];
    video.setAttribute('aria-label', tr(data.current ? 'AlphaFold 实测关键画面剪辑' : 'AlphaFold 早期版本操作实录', data.current ? 'AlphaFold actual workflow keyframes' : 'Earlier AlphaFold workflow recording'));
    range.setAttribute('aria-label', tr('演示进度', 'Playback progress'));
  }
  function setState(next) {
    state = next;
    states.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.realState === next)));
    video.hidden = next !== 'video'; still.hidden = next === 'video';
    if (next !== 'video') { video.pause(); still.src = asset(next); }
    labels();
  }
  function activate(tab) {
    generation++; video.pause(); active = tab.dataset.module;
    tabs.forEach(b => { const on = b === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    root.setAttribute('aria-labelledby', tab.id);
    stage.dataset.zoom = 'full'; stage.dataset.current = String(Boolean(info[active].current));
    video.poster = asset('after'); video.src = 'assets/site/' + (info[active].clip || 'real-' + active + '.mp4');
    video.querySelector('a').href = video.src;
    video.load(); range.value = '0'; time.textContent = '0:00'; setState('after');
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', e => {
      const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
      if (j !== null) { e.preventDefault(); tabs[j].focus(); activate(tabs[j]); }
    });
  });
  states.forEach(b => b.addEventListener('click', () => setState(b.dataset.realState)));
  play.addEventListener('click', () => {
    if (state === 'video' && !video.paused) video.pause();
    else {
      if (video.ended) video.currentTime = 0;
      const current = generation; setState('video');
      video.play().catch(() => { if (current === generation && state === 'video') setState('after'); });
    }
  });
  zoom.addEventListener('click', () => { stage.dataset.zoom = stage.dataset.zoom === 'sidebar' ? 'full' : 'sidebar'; labels(); });
  root.querySelector('#real-fullscreen').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen?.(); else root.requestFullscreen?.().catch(() => {}); });
  range.addEventListener('input', () => { setState('video'); if (Number.isFinite(video.duration)) video.currentTime = Number(range.value) / 100 * video.duration; });
  video.addEventListener('timeupdate', () => { range.value = Number.isFinite(video.duration) ? String(100 * video.currentTime / video.duration) : '0'; time.textContent = Math.floor(video.currentTime / 60) + ':' + String(Math.floor(video.currentTime % 60)).padStart(2, '0'); });
  video.addEventListener('play', labels); video.addEventListener('pause', labels);
  video.addEventListener('ended', () => { if (state === 'video') setState('after'); });
  new IntersectionObserver(entries => { if (!entries[0].isIntersecting) video.pause(); }, { threshold: .05 }).observe(root);
  document.addEventListener('brevess-languagechange', labels);
  activate(tabs.find(t => t.dataset.module === 'figures'));
})();
