'use strict';
(() => {
  const asset = name => `assets/site/${name}`;
  const demos = {
    figures: { title: ['读懂每一张图。', 'Understand every figure.'], name: ['解图', 'Figures'], before: 'r27-figures-before.webp', after: 'r27-figures-after.webp', detail: 'r27-figures-sidebar.webp', video: 'r27-figures.webm', size: [1920, 1154], current: true },
    chat: { title: ['带着问题，回到证据。', 'Ask questions. Follow the evidence.'], name: ['问答', 'Q&A'], before: 'r27-chat-citation.webp', after: 'r27-chat-table.webp', video: 'r27-chat.webm', size: [1920, 1154], current: true, states: [['回答与引用', 'Cited answer'], ['展开表格', 'Expanded table']] },
    navigation: { title: ['先看脉络，再读细节。', 'See the structure. Explore the details.'], name: ['导航', 'Outline'], detail: 'real-navigation-sidebar.webp' },
    highlights: { title: ['让重要内容，一目了然。', 'Keep the important parts in sight.'], name: ['高亮', 'Highlights'], detail: 'real-highlights-detail.webp' },
    notes: { title: ['把读过的，留下来。', 'Keep what you learn.'], name: ['笔记', 'Notes'], detail: 'real-notes-sidebar.webp' },
    hypothesis: { name: ['假说梳理', 'Hypotheses'], workbench: 'hypothesis' },
    planning: { name: ['组图规划', 'Figure planning'], workbench: 'figures' },
    library: { name: ['文献总库', 'Library'], workbench: 'library' },
    radar: { name: ['文献雷达', 'Literature radar'], workbench: 'radar' }
  };
  Object.entries(demos).forEach(([id, demo]) => {
    if (demo.workbench) {
      demo.after = `wb-${demo.workbench}-poster.webp`;
      demo.video = `wb-${demo.workbench}.mp4`;
      demo.size = [1440, 900];
    } else if (!demo.current) {
      demo.before = `real-${id}-before.webp`;
      demo.after = `real-${id}-after.webp`;
      demo.video = `real-${id}.mp4`;
      demo.size = [1472, 908];
    }
  });
  const en = () => document.documentElement.lang === 'en';
  const tr = (zh, english) => en() ? english : zh;
  const text = pair => pair[en() ? 1 : 0];
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const viewer = document.querySelector('#media-viewer');
  const viewerContent = document.querySelector('#viewer-content');
  const scaleButton = document.querySelector('#viewer-scale');
  const detailButton = document.createElement('button');
  detailButton.type = 'button'; detailButton.id = 'viewer-detail';
  viewer.querySelector('.viewer-actions').prepend(detailButton);
  let viewed = null, placeholder = null, trigger = null;

  function updateViewer() {
    if (!viewed) return;
    document.querySelector('#viewer-title').textContent = text(viewed.demo.name);
    scaleButton.textContent = viewer.dataset.scale === 'original' ? tr('适合窗口', 'Fit to window') : tr('原始大小', 'Original size');
    scaleButton.setAttribute('aria-pressed', String(viewer.dataset.scale === 'original'));
    detailButton.hidden = !viewed.demo.detail || viewed.state !== 'after';
    detailButton.textContent = viewed.detail ? tr('完整画面', 'Full view') : tr('侧栏细节', 'Sidebar detail');
    detailButton.setAttribute('aria-pressed', String(viewed.detail));
  }
  function openViewer(gallery, from) {
    if (viewer.open) return;
    viewed = gallery; trigger = from;
    placeholder = document.createElement('div');
    placeholder.style.height = `${gallery.player.getBoundingClientRect().height}px`;
    gallery.player.before(placeholder);
    viewerContent.append(gallery.player);
    viewer.dataset.scale = 'fit';
    if (matchMedia('(max-width: 640px)').matches && gallery.demo.detail && gallery.state === 'after') {
      gallery.detail = true; gallery.still.src = asset(gallery.demo.detail);
    }
    updateViewer(); viewer.showModal();
  }
  viewer.addEventListener('close', () => {
    if (!viewed) return;
    viewed.detail = false;
    if (viewed.state !== 'video') viewed.still.src = asset(viewed.demo[viewed.state]);
    placeholder.replaceWith(viewed.player);
    viewed = null; placeholder = null;
    trigger?.focus({ preventScroll: true }); trigger = null;
  });
  scaleButton.addEventListener('click', () => {
    viewer.dataset.scale = viewer.dataset.scale === 'original' ? 'fit' : 'original'; updateViewer();
  });
  detailButton.addEventListener('click', () => {
    if (!viewed?.demo.detail) return;
    viewed.detail = !viewed.detail;
    viewed.still.src = asset(viewed.detail ? viewed.demo.detail : viewed.demo.after);
    viewer.dataset.scale = 'fit'; updateViewer();
  });

  document.querySelectorAll('[data-gallery]').forEach(panel => {
    const section = panel.closest('section');
    const tabs = [...section.querySelectorAll('[role="tab"]')];
    const player = panel.querySelector('.demo-player');
    const video = player.querySelector('video');
    const still = player.querySelector('.demo-still');
    const stillButton = player.querySelector('.still-button');
    const screen = player.querySelector('.media-screen');
    const play = player.querySelector('.play-button');
    const expand = player.querySelector('.expand-button');
    const range = player.querySelector('input[type="range"]');
    const output = player.querySelector('output');
    const playback = player.querySelector('.playback');
    const error = player.querySelector('.media-error');
    const states = [...player.querySelectorAll('[data-state]')];
    const gallery = { player, video, still, demo: demos[tabs[0].dataset.demo], state: 'after', detail: false };
    let generation = 0, pending = false;
    const caption = () => gallery.demo.workbench ? tr('演示课题 · 早期实录', 'Demo project · Earlier recording') : gallery.demo.current ? tr('AlphaFold 2 · 实测剪辑', 'AlphaFold 2 · Edited captures') : tr('AlphaFold 2 · 早期实录', 'AlphaFold 2 · Earlier recording');
    function labels() {
      const demo = gallery.demo;
      const heading = section.querySelector('.feature-heading');
      if (heading) heading.textContent = text(demo.title);
      section.querySelector('[role="tablist"]').setAttribute('aria-label', demo.workbench ? tr('工作台功能', 'Workbench features') : tr('阅读功能', 'Reading features'));
      still.alt = `${text(demo.name)} · ${caption()}`;
      stillButton.setAttribute('aria-label', `${tr('放大查看', 'Enlarge')} ${text(demo.name)}`);
      video.setAttribute('aria-label', `${text(demo.name)} · ${caption()}`);
      player.querySelector('.media-caption').textContent = caption();
      states.forEach((button, index) => {
        button.textContent = demo.states ? text(demo.states[index]) : index ? tr('生成后', 'After AI') : tr('生成前', 'Before AI');
        button.setAttribute('aria-pressed', String(button.dataset.state === gallery.state));
      });
      player.querySelector('.state-switch')?.setAttribute('aria-label', tr('演示画面', 'Demo view'));
      play.querySelector('span').textContent = pending ? tr('加载中…', 'Loading…') : !video.paused ? tr('暂停', 'Pause') : video.ended && gallery.state === 'video' ? tr('重新播放', 'Replay') : tr('播放演示', 'Play demo');
      play.querySelector('use').setAttribute('href', video.paused ? '#i-play' : '#i-pause');
      play.setAttribute('aria-pressed', String(!video.paused));
      play.setAttribute('aria-busy', String(pending));
      range.setAttribute('aria-label', tr('播放进度', 'Playback progress'));
      range.disabled = !Number.isFinite(video.duration);
      output.textContent = clock(video.currentTime || 0) + (Number.isFinite(video.duration) ? ` / ${clock(video.duration)}` : '');
      range.value = Number.isFinite(video.duration) && video.duration > 0 ? String(video.currentTime / video.duration * 100) : '0';
      if (viewed === gallery) updateViewer();
    }
    function setState(state) {
      gallery.state = state; gallery.detail = false;
      if (state !== 'video') { pending = false; video.pause(); still.src = asset(gallery.demo[state]); }
      stillButton.hidden = state === 'video'; video.hidden = state !== 'video'; playback.hidden = state !== 'video';
      error.hidden = true;
      labels();
    }
    function activate(tab) {
      generation++; pending = false; video.pause();
      gallery.demo = demos[tab.dataset.demo];
      tabs.forEach(button => { const selected = button === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
      panel.setAttribute('aria-labelledby', tab.id);
      const [width, height] = gallery.demo.size;
      still.width = width; still.height = height;
      video.width = width; video.height = height;
      screen.style.aspectRatio = `${width}/${height}`;
      video.src = asset(gallery.demo.video); video.poster = asset(gallery.demo.after);
      video.querySelector('a').href = video.src;
      video.load(); setState('after');
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next !== null) { event.preventDefault(); tabs[next].focus(); activate(tabs[next]); }
      });
    });
    states.forEach(button => button.addEventListener('click', () => setState(button.dataset.state)));
    play.addEventListener('click', async () => {
      if (pending) { pending = false; video.pause(); labels(); return; }
      if (!video.paused) { video.pause(); return; }
      const current = generation;
      setState('video'); pending = true; labels();
      if (video.ended) video.currentTime = 0;
      try { await video.play(); }
      catch (cause) {
        if (current === generation && gallery.state === 'video' && cause.name !== 'AbortError') {
          setState('after');
          error.textContent = tr('视频暂时无法播放，可先查看截图或重试。', 'Video could not play. View the screenshots or try again.'); error.hidden = false;
        }
      } finally { if (current === generation) { pending = false; labels(); } }
    });
    expand.addEventListener('click', () => openViewer(gallery, expand));
    stillButton.addEventListener('click', () => { if (!viewer.open) openViewer(gallery, stillButton); });
    range.addEventListener('input', () => { if (Number.isFinite(video.duration)) video.currentTime = Number(range.value) / 100 * video.duration; });
    for (const type of ['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended']) video.addEventListener(type, labels);
    video.addEventListener('play', () => document.querySelectorAll('video').forEach(other => { if (other !== video) other.pause(); }));
    new IntersectionObserver(entries => { if (!entries[0].isIntersecting && viewed !== gallery) video.pause(); }, { threshold: .05 }).observe(panel);
    document.addEventListener('brevess-languagechange', labels);
    activate(tabs[0]);
  });
})();
