(() => {
  'use strict';
  const R = globalThis.BrevessRadar, $ = id => document.getElementById(id);
  const store = R.createRadarStore(), adapter = R.createPubMedRadarAdapter(), service = R.createRadarService({ store, adapters: { pubmed: adapter } });
  let enrichment;
  let state, selected = null, revisionNumber = null, filter = 'new', limit = 40, editing = null, lastRender = '', background = false;
  const text = (id, value) => { $(id).textContent = value; };
  const dateTime = at => at ? new Date(at).toLocaleString('zh-CN', { hour12: false }) : '尚未检查';
  const element = (tag, className, value) => {
    const node = document.createElement(tag); if (className) node.className = className;
    if (value !== undefined) node.textContent = value; return node;
  };
  const notice = message => text('notice', message);
  const current = () => state?.radars.find(r => r.id === selected);
  async function refresh(force = false) {
    state = await store.read();
    if (!state.radars.some(r => r.id === selected)) selected = state.radars[0]?.id || null;
    const fingerprint = JSON.stringify([state, selected, revisionNumber, filter, limit, $('unread-only').checked, state.active?.expiresAt > Date.now()]);
    if (!force && fingerprint === lastRender) return;
    lastRender = fingerprint; render();
  }
  function render() {
    text('radar-count', String(state.radars.length).padStart(2, '0'));
    const list = $('radar-list'); list.replaceChildren();
    if (!state.radars.length) list.append(element('p', 'muted', '还没有追踪任务。'));
    for (const radar of state.radars) {
      const revision = R.radarRevision(radar), unread = revision.articles.filter(p => !p.isBaseline && !p.read).length;
      const button = element('button', 'tracker'); button.type = 'button'; button.setAttribute('aria-pressed', String(radar.id === selected));
      button.append(element('strong', '', radar.name), element('small', unread ? 'tracker-new' : '', `${unread} 篇未读新增 · ${!radar.enabled ? '已暂停' : radar.intervalHours ? '每 ' + radar.intervalHours + ' 小时' : '仅手动'}`));
      button.addEventListener('click', () => { selected = radar.id; revisionNumber = null; limit = 40; void safe(() => refresh(true)); }); list.append(button);
    }
    const radar = current(); $('empty').hidden = !!radar; $('radar-detail').hidden = !radar;
    if (!radar) return;
    const latest = R.radarRevision(radar), revision = radar.revisions.find(v => v.number === revisionNumber) || latest;
    revisionNumber = revision.number;
    enrichment?.prepare(radar, revision, state);
    const active = state.active?.expiresAt > Date.now(), mine = active && state.active.id === radar.id;
    text('radar-name', radar.name); text('query-preview', revision.query);
    text('scan-state', mine ? '正在检查 PubMed…' : latest.error ? '最近检查失败 · 原进度已保留' : !latest.baselineAt ? '待建立首次基线' : '已建立基线 · 持续追踪新增');
    text('toggle-radar', radar.enabled ? '暂停自动检查' : '启用自动检查');
    $('check-radar').disabled = !!active; text('check-radar', mine ? '检查中…' : '立即检查');
    text('last-success', dateTime(latest.lastSuccessAt)); text('last-attempt', dateTime(latest.lastAttemptAt));
    text('interval', !radar.enabled ? '已暂停（可手动检查）' : radar.intervalHours ? `每 ${radar.intervalHours} 小时` : '仅手动');
    text('scan-window', revision.lastWindow ? `上次成功覆盖：${revision.lastWindow.startDay} — ${revision.lastWindow.endDay}（含去重重叠窗口）` : `首次回溯 ${revision.baselineDays} 天；检查成功后开始累计新增。`);
    $('scan-error').hidden = !latest.error;
    text('scan-error', latest.error ? `${latest.error.message} 最近成功时间：${dateTime(latest.lastSuccessAt)}。可手动重试。` : '');
    text('query-translation', revision.queryTranslation ? 'PubMed 解析：' + revision.queryTranslation : '');
    text('query-warnings', revision.warnings.length ? 'PubMed 提示：' + revision.warnings.join('；') : '');
    const selector = $('revision'); selector.replaceChildren();
    for (const v of [...radar.revisions].reverse()) { const option = element('option', '', `版本 ${v.number}${v === latest ? ' · 当前' : ' · 历史'}`); option.value = v.number; selector.append(option); }
    selector.value = revision.number;
    text('count-new', revision.articles.filter(p => !p.isBaseline).length); text('count-baseline', revision.articles.filter(p => p.isBaseline).length); text('count-all', revision.articles.length);
    for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    const articles = revision.articles.filter(p => (filter === 'all' || (filter === 'baseline') === p.isBaseline) && (!$('unread-only').checked || !p.read))
      .sort(enrichment.compare);
    text('feed-description', `${articles.length} 篇 · ${enrichment.isRelevanceSort() ? '相关性从高到低 · 并列按时间' : '时间由新到旧'}${revision !== latest ? ' · 历史检索版本' : ''}`);
    const feed = $('paper-list'); feed.replaceChildren(); let previousDay;
    if (!articles.length) feed.append(element('p', 'feed-empty', !revision.baselineAt ? '首次检查后，基线文献将出现在这里。' : filter === 'new' ? '尚无新增文献。首次结果可在“基线”中查看。' : '当前筛选下没有文献。'));
    for (const paper of articles.slice(0, limit)) {
      const day = paper.createdDay || R.radarDay(paper.firstSeenAt);
      if (!enrichment.isRelevanceSort() && day !== previousDay) { feed.append(element('div', 'date-divider', `${day} / ${paper.createdDay ? 'PubMed 入库' : '首次发现'}`)); previousDay = day; }
      const article = element('article', 'paper');
      const label = element('div', 'paper-label'); label.append(element('span', 'badge' + (!paper.isBaseline && !paper.read ? ' badge-new' : ''), paper.isBaseline ? '基线' : paper.read ? '新增 · 已读' : '新增 · 未读'), element('span', '', `PMID ${paper.id}`));
      const title = element('h3'), link = element('a', '', paper.title || '未提供标题');
      link.href = `https://pubmed.ncbi.nlm.nih.gov/${paper.id}/`; link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link);
      article.append(label, title, element('p', '', [paper.journal, paper.publicationDate].filter(Boolean).join(' · ')));
      if (paper.authors?.length) article.append(element('p', '', paper.authors.slice(0, 5).join(', ') + (paper.authors.length > 5 ? ' et al.' : '')));
      const footer = element('div', 'paper-footer'), links = element('div', 'links'), open = element('a', '', 'PubMed ↗');
      open.href = link.href; open.target = '_blank'; open.rel = 'noopener noreferrer'; links.append(open);
      if (paper.doi) { const doi = element('a', '', 'DOI ↗'); doi.href = 'https://doi.org/' + encodeURIComponent(paper.doi); doi.target = '_blank'; doi.rel = 'noopener noreferrer'; links.append(doi); }
      const read = element('button', '', paper.read ? '标为未读' : '标为已读'); read.type = 'button';
      read.addEventListener('click', () => safe(async () => { await store.markRead(radar.id, revision.number, [paper.id], !paper.read); await refresh(true); }));
      footer.append(links, read); article.append(footer); enrichment.decorate(article, paper); feed.append(article);
    }
    $('load-more').hidden = articles.length <= limit;
  }
  async function safe(fn) { try { return await fn(); } catch (error) { notice(error.message || '操作失败，请重试。'); } }
  function edit(radar) {
    editing = radar ? structuredClone(radar) : null;
    text('editor-title', radar ? '编辑文献追踪任务' : '新建文献追踪任务');
    $('name').value = radar?.name || ''; $('query').value = radar?.query || '';
    enrichment.editorOpened(radar?.query || '');
    $('frequency').value = radar?.intervalHours ?? 24; $('baseline').value = radar?.baselineDays || 30; $('enabled').checked = radar?.enabled ?? true;
    text('edit-note', radar ? '修改检索式或回溯范围后，会建立新的基线版本；旧文献记录保留在历史版本中。' : '启用后，在运行条件允许时检查到期任务。');
    text('form-error', ''); preview(); $('editor').showModal(); $('name').focus();
  }
  function preview() { $('preview-query').href = 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent($('query').value); }
  $('new-radar').addEventListener('click', () => edit(null)); $('edit-radar').addEventListener('click', () => edit(current()));
  for (const id of ['close-editor', 'cancel-editor']) $(id).addEventListener('click', () => $('editor').close());
  $('query').addEventListener('input', preview);
  $('radar-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const radar = await store.save({ id: editing?.id, name: $('name').value, query: $('query').value, source: 'pubmed', intervalHours: Number($('frequency').value), baselineDays: Number($('baseline').value), enabled: $('enabled').checked }, editing?.editVersion);
      selected = radar.id; revisionNumber = null; filter = 'new'; limit = 40; $('editor').close(); notice('追踪任务已保存。'); await refresh(true); void tick();
    } catch (error) { text('form-error', error.message); }
  });
  $('check-radar').addEventListener('click', () => safe(async () => {
    const id = selected; notice('正在从 PubMed 检索，请稍候…');
    const pending = service.check(id); setTimeout(() => safe(() => refresh()), 50);
    try {
      const result = await pending;
      if (selected === id) { revisionNumber = null; filter = result.baseline ? 'baseline' : 'new'; limit = 40; }
      notice(result.baseline ? `首次基线已建立：${result.added} 篇，不计为新增。` : `检查完成：发现 ${result.newCount} 篇新增文献。`);
    } finally { await refresh(true); }
  }));
  $('toggle-radar').addEventListener('click', () => safe(async () => {
    const radar = current(); await store.save({ ...radar, enabled: !radar.enabled }, radar.editVersion); await refresh(true); void tick();
  }));
  for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => { filter = button.dataset.filter; limit = 40; void safe(() => refresh(true)); });
  $('revision').addEventListener('change', () => { revisionNumber = Number($('revision').value); limit = 40; void safe(() => refresh(true)); });
  $('unread-only').addEventListener('change', () => { limit = 40; void safe(() => refresh(true)); });
  $('load-more').addEventListener('click', () => { limit += 40; void safe(() => refresh(true)); });
  async function tick() {
    await safe(async () => {
      background = false;
      try { background = !!(await globalThis.chrome?.alarms?.get('brevess-literature-radar-tick-v1')); } catch {}
      text('schedule-mode', background ? '后台周期检查已接入。浏览器关闭时暂停，重新激活后补查到期任务。' : '当前为页面内周期检查：工作台或雷达页面需保持打开。后台周期检查尚未接入。');
      if (!background) await service.checkDue();
      await refresh();
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void tick(); });
  window.addEventListener('focus', () => { void tick(); });
  enrichment = window.BrevessRadarUI.create({store, adapter, service, refresh, notice});
  void safe(async () => { await refresh(true); await tick(); });
  setInterval(() => safe(() => refresh()), 2000);
  setInterval(tick, 60000);
})();
