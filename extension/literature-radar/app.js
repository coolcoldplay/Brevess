(() => {
  'use strict';

  globalThis.SciLLM?.registerInterfaceTranslations?.({
    '基线起始日期':'Baseline start date','按发表日期纳入，留空包括全部年份。':'Include papers by publication date. Leave blank for all years.',
    '年度文献分布':'Publications by year','检索年度分布':'Search by publication year','取消检索':'Cancel search','选择年份可设置基线起点。':'Select a year to set the baseline start.',
    '正在检索年度分布…':'Searching publication years…','请先填写所选来源的检索式。':'Enter a query for each selected source.',
    '无匹配文献':'No matching publications','篇':'papers','全部年份':'All years','首次基线':'Initial baseline',
    '补充历史基线':'Add historical baseline','追加历史基线':'Add historical baseline','历史基线已补充。':'Historical baseline added.',
    '从（含当日）':'From (inclusive)','至（含当日）':'To (inclusive)',
    '只追加所选日期内的基线文献，不计为新增。已有文献、已读状态和当前增量检查进度保持不变。':'Append baseline papers within these dates. Existing papers, read states and incremental progress are preserved.',
    '完整检索成功后才保存；超过5,000篇、超时或分页失败均不保存本次结果。可缩小日期范围分次补充。':'Save only after a complete search. More than 5,000 results, timeouts or incomplete pages leave existing data unchanged. Narrow the dates to backfill in batches.',
    '正在检索历史基线…':'Searching historical baseline…','检索完成 · 本窗口无匹配文献':'Search complete · no matches in this window',
    '当前窗口无匹配。可补充更早的历史基线，或编辑检索式与回溯范围。':'No matches in the current window. Add an earlier historical baseline, or edit the query and lookback period.',
    '初始窗口无匹配 · 已补充历史基线':'No matches in the initial window · historical baseline added',
    '首次窗口内无匹配文献。':'No papers matched the initial window.','单个日期暂不绘制趋势。':'A trend needs more than one date.',
    '尚无文献，暂不绘制趋势。':'No papers yet; no trend to plot.','最近检查':'Last check','运行条件':'Runtime conditions',
    '补充后本版本将超过 5,000 篇分享上限，本次未保存。请缩小历史日期范围。':'This version would exceed the 5,000-paper export limit. No changes were saved. Narrow the historical date range.',
    '检索式发送给所选来源；任务和结果保存在本机。首次结果为基线，后续首次发现的匹配记录计为新增。每次向前重叠 7 天去重检查；超出 5,000 篇或分页不完整时保留原进度。':'Queries are sent to the selected source; tasks and results stay on this device. Initial results are baseline papers; later discoveries count as new. Checks overlap by 7 days and deduplicate. More than 5,000 results or incomplete pages leave progress unchanged.',
    '确认检索并追加':'Search and append','历史基线范围':'Historical baseline range',
    '该日期范围无匹配，原有文献保留。':'No matches in these dates; existing papers were preserved.',
    '通过 Europe PMC 预印本索引检索。':'Searches the Europe PMC preprint index.'
  },[
    [/^最近历史补充：(\d{4}-\d{2}-\d{2}) — (\d{4}-\d{2}-\d{2}) · 匹配 (\d+) 篇，追加 (\d+) 篇。$/u,m=>'Last historical backfill: '+m[1]+' — '+m[2]+' · '+m[3]+' matched, '+m[4]+' added.'],
    [/^本窗口：(\d{4}-\d{2}-\d{2}) — (\d{4}-\d{2}-\d{2}) · (.+)$/u,m=>'Current window: '+m[1]+' — '+m[2]+' · '+m[3]],
    [/^实际检索式：(.+)$/u,m=>'Effective query: '+m[1]]
  ]);
  const R = globalThis.BrevessRadar, $ = id => document.getElementById(id), T=value=>globalThis.SciLLM?.translateInterfaceText?.(value)||value;
  const store = R.createRadarStore(), adapters=R.createRadarAdapters(), adapter=adapters.pubmed, service = R.createRadarService({ store, adapters });
  for(const [id,source] of Object.entries(R.RADAR_SOURCES))$('source').append(new Option(source.name+(source.preprint?' · '+T('预印本'):source.credential?' · API Key':''),id));
  let enrichment;
  let state, selected = null, revisionNumber = null, filter = 'new', limit = 40, editing = null, lastRender = '', background = false;
  let batch=null,trendMode='cumulative';
  const sourceQueries=window.R21RadarQueries=R.createRadarSourceQueries({document,source:$('source'),query:$('query')});
  if(window.self!==window.top){document.body.classList.add('radar-embedded');document.querySelector('.section-label').append($('new-radar'));}
  const text = (id, value) => { $(id).textContent = value; };
  const dateTime = at => at ? new Date(at).toLocaleString(globalThis.SciLLM?.getInterfaceLanguage?.() || 'zh-CN', { hour12: false }) : '尚未检查';
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
    $('check-all').disabled=!!batch||!!(state.active?.expiresAt>Date.now())||!state.radars.length;
    $('cancel-check-all').hidden=!batch;
    text('radar-count', String(state.radars.length).padStart(2, '0'));
    const list = $('radar-list'); list.replaceChildren();
    if (!state.radars.length) list.append(element('p', 'muted', '还没有追踪任务。'));
    for (const radar of state.radars) {
      const unread = R.radarUnreadCount(radar);
      const button = element('button', 'tracker'); button.type = 'button'; button.setAttribute('aria-pressed', String(radar.id === selected));
      const radarName = element('strong', '', radar.name); radarName.setAttribute('translate', 'no');
      button.append(radarName, element('small', unread ? 'tracker-new' : '', `${unread ? unread+' 篇未读新增 · ' : ''}${!radar.enabled ? '已暂停' : radar.intervalHours ? '每 ' + radar.intervalHours + ' 小时' : '仅手动'}`));
      if(unread){const badge=element('span','tracker-count',String(unread));badge.setAttribute('translate','no');badge.setAttribute('aria-label',T('未读新增')+' '+unread);badge.title=T('未读新增')+' '+unread;button.append(badge);}
      button.addEventListener('click', () => { selected = radar.id; revisionNumber = null; limit = 40; void safe(() => refresh(true)); }); list.append(button);
    }
    const radar = current(); $('empty').hidden = !!radar; $('radar-detail').hidden = !radar;
    if (!radar) return;
    const latest = R.radarRevision(radar), revision = radar.revisions.find(v => v.number === revisionNumber) || latest;
    revisionNumber = revision.number;
    R.renderRadarTrend($('radar-trend-chart'),revision,trendMode);
    enrichment?.prepare(radar, revision, state);
    const active = state.active?.expiresAt > Date.now(), mine = active && state.active.id === radar.id;
    const sourceRows=R.radarSourceQueries(revision.sourceQueries?revision:{source:radar.source,query:revision.query});text('source-label',sourceRows.map(row=>R.RADAR_SOURCES[row.source].name).join(' · '));$('pubmed-method').hidden=!sourceRows.some(r=>r.source==='pubmed');text('source-method',sourceRows.map(r=>R.RADAR_SOURCES[r.source].name+'：'+sourceHint(r.source)).join('\n'));
    const statuses=$('source-status');statuses.replaceChildren();statuses.hidden=!revision.sourceQueries;for(const row of sourceRows){const st=revision.sourceStates?.[row.source];statuses.append(element('li','',R.RADAR_SOURCES[row.source].name+' · '+(mine&&state.active.source===row.source?'正在检查':st?.error?'失败：'+st.error.message:st?.lastSuccessAt?'已完成 · '+dateTime(st.lastSuccessAt):'尚未检查')));}
    text('radar-name', radar.name); text('query-preview', revision.sourceQueries?revision.sourceQueries.map(row=>R.RADAR_SOURCES[row.source].name+': '+row.query).join('\n'):revision.query);
    $('radar-name').setAttribute('translate', 'no'); $('query-preview').setAttribute('translate', 'no');
    const history=Array.isArray(revision.baselineHistory)?revision.baselineHistory:[],lastHistory=history.at(-1);
    text('scan-state', mine ? '正在检查来源…' : latest.error ? (latest.error.code==='RADAR_PARTIAL_FAILURE'?'部分来源失败 · 已成功的结果保留':'最近检查失败 · 原进度已保留') : !latest.baselineAt ? '待建立首次基线' : !latest.articles.length ? T('检索完成 · 本窗口无匹配文献') : '已建立基线 · 持续追踪新增');
    const pubmedQuery=sourceRows.find(row=>row.source==='pubmed')?.query;
    const historyLink=$('pubmed-history-link');historyLink.hidden=!pubmedQuery;
    if(pubmedQuery){
      const href='https://pubmed.ncbi.nlm.nih.gov/?term='+encodeURIComponent(pubmedQuery);
      if(historyLink.href!==href){const next=historyLink.cloneNode(true);next.href=href;historyLink.replaceWith(next);}
    }
    $('history-baseline').hidden=!!revision.sourceQueries||!['biorxiv','medrxiv','europepmc'].includes(radar.source)||revision!==latest;
    $('history-baseline').disabled=!!active||!!batch||!latest.baselineAt||latest.windowStart==='0001-01-01';
    $('baseline-history').hidden=!lastHistory;
    text('baseline-history',lastHistory?T(`最近历史补充：${lastHistory.startDay} — ${lastHistory.endDay} · 匹配 ${lastHistory.matched} 篇，追加 ${lastHistory.added} 篇。`):'');
    text('toggle-radar', radar.enabled ? '暂停自动检查' : '启用自动检查');
    $('check-radar').disabled = !!active||!!batch; text('check-radar', mine ? '检查中…' : '立即检查');
    text('last-success', dateTime(latest.lastSuccessAt)); text('last-attempt', dateTime(latest.lastAttemptAt));
    const sameAttempt=latest.lastSuccessAt===latest.lastAttemptAt&&!latest.error;
    $('last-attempt').parentElement.hidden=sameAttempt;
    $('last-success').previousElementSibling.textContent=T(sameAttempt?'最近检查':'最近成功检查');
    text('interval', !radar.enabled ? '已暂停（可手动检查）' : radar.intervalHours ? `每 ${radar.intervalHours} 小时` : '仅手动');
    text('scan-window', revision.lastWindow ? T(`${radar.source==='asta'?'上次检索发表日期：':'上次成功覆盖：'}${revision.lastWindow.startDay==='0001-01-01'?T('全部年份'):revision.lastWindow.startDay} — ${revision.lastWindow.endDay}（含去重重叠窗口）`) : Object.hasOwn(revision,'baselineStartDay') ? T('首次基线')+' · '+(revision.baselineStartDay||T('全部年份')) : `首次回溯 ${revision.baselineDays} 天；检查成功后开始累计新增。`);
    $('scan-error').hidden = !latest.error;
    text('scan-error', latest.error ? `${latest.error.message} 最近成功时间：${dateTime(latest.lastSuccessAt)}。可手动重试。` : '');
    const translated=revision.queryTranslation&&revision.queryTranslation.trim()!==revision.query.trim();
    $('query-translation').hidden=!translated;text('query-translation',translated?T('实际检索式：'+revision.queryTranslation):'');
    const warnings=[...new Set(revision.warnings)];$('query-warnings').hidden=!warnings.length;
    text('query-warnings',warnings.length?'来源提示：'+warnings.join('；'):'');
    const selector = $('revision'); selector.replaceChildren();
    for (const v of [...radar.revisions].reverse()) { const option = element('option', '', `版本 ${v.number}${v === latest ? ' · 当前' : ' · 历史'}`); option.value = v.number; selector.append(option); }
    selector.value = revision.number;
    text('count-new', revision.articles.filter(p => !p.isBaseline).length); text('count-baseline', revision.articles.filter(p => p.isBaseline).length); text('count-all', revision.articles.length);
    for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    const articles = revision.articles.filter(p => (filter === 'all' || (filter === 'baseline') === p.isBaseline) && (!$('unread-only').checked || !p.read))
      .sort(enrichment.compare);
    text('feed-description', `${articles.length} 篇 · ${enrichment.isRelevanceSort() ? '相关性从高到低 · 并列按时间' : '时间由新到旧'}${revision !== latest ? ' · 历史检索版本' : ''}`);
    const feed = $('paper-list'); feed.replaceChildren(); let previousDay;
    if (!articles.length) feed.append(element('p', 'feed-empty', !revision.baselineAt ? '首次检查后，基线文献将出现在这里。' : !revision.articles.length ? T('当前窗口无匹配。可补充更早的历史基线，或编辑检索式与回溯范围。') : filter === 'new' ? '尚无新增文献。首次结果可在“基线”中查看。' : '当前筛选下没有文献。'));
    for (const paper of articles.slice(0, limit)) {
      const day = paper.createdDay || R.radarDay(paper.firstSeenAt);
      if (!enrichment.isRelevanceSort() && day !== previousDay) { feed.append(element('div', 'date-divider', `${day} / ${paper.createdDay ? R.RADAR_SOURCES[(paper.source||radar.source)].date : T('首次发现')}`)); previousDay = day; }
      const article = element('article', 'paper');
      const label = element('div', 'paper-label'); label.append(element('span', 'badge' + (!paper.isBaseline && !paper.read ? ' badge-new' : ''), paper.isBaseline ? '基线' : paper.read ? '新增 · 已读' : '新增 · 未读'), element('span', '', (paper.source||radar.source)==='pubmed'?`PMID ${paper.id}`:R.RADAR_SOURCES[(paper.source||radar.source)].name));
      const title = element('h3'), link = element('a', '', paper.title || '未提供标题');
      if (paper.title) title.setAttribute('translate', 'no');
      link.href = R.radarPaperUrl((paper.source||radar.source),paper); link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link);
      if(R.isRadarPreprint(paper,paper.source||radar.source))label.append(element('span','badge preprint','预印本 · 请核对评审状态'));
      const heading = element('div', 'paper-heading'), publication = element('div', 'paper-publication');
      publication.setAttribute('translate', 'no');
      if (paper.journal) publication.append(element('strong', '', paper.journal));
      if (paper.publicationDate) { const date = element('span', '', paper.publicationDate); date.title = '来源提供的发表日期'; publication.append(date); }
      heading.append(label, publication); article.append(heading, title);
      if (paper.authors?.length) article.append(element('p', '', paper.authors.slice(0, 5).join(', ') + (paper.authors.length > 5 ? ' et al.' : '')));
      const footer = element('div', 'paper-footer'), links = element('div', 'links'), open = element('a', '', R.RADAR_SOURCES[(paper.source||radar.source)].name+' ↗');
      open.href = link.href; open.target = '_blank'; open.rel = 'noopener noreferrer'; links.append(open);
      for(const related of new Map([paper,...(paper.sourceRecords||[])].flatMap(r=>r.relatedPublications||[]).map(r=>[r.source+':'+r.id,r])).values()){const href=R.radarPaperUrl(related.source,related);if(!href)continue;const a=element('a','',related.relation==='Preprint of'?'关联正式版 ↗':related.relation+' ↗');a.href=href;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
      for(const record of paper.sourceRecords||[]){if(record.source===(paper.source||radar.source)&&record.id===paper.id)continue;const href=R.radarPaperUrl(record.source,record);if(!href)continue;const more=element('a','',R.RADAR_SOURCES[record.source].name+(record.version?' v'+record.version:'')+' ↗');more.href=href;more.target='_blank';more.rel='noopener noreferrer';links.append(more);}
      if(paper.sourceRecords?.length>1)label.append(element('span','badge','已合并 '+paper.sourceRecords.length+' 条来源记录（DOI/PMID）'));
      if (paper.doi) { const doi = element('a', '', 'DOI ↗'); doi.href = 'https://doi.org/' + encodeURIComponent(paper.doi); doi.target = '_blank'; doi.rel = 'noopener noreferrer'; links.append(doi); }
      const read = element('button', '', paper.read ? '标为未读' : '标为已读'); read.type = 'button';
      read.addEventListener('click', () => safe(async () => { await store.markRead(radar.id, revision.number, [paper.id], !paper.read); await refresh(true); }));
      if(window.parent!==window && typeof window.parent.BrevessProjectReadingQueue?.add==='function'){
        const add=element('button','','加入课题待读');add.type='button';
        add.addEventListener('click',()=>safe(async()=>{
          add.disabled=true;
          try{const name=await window.parent.BrevessProjectReadingQueue.add(radar.id,revision.number,paper.id,enrichment.scoreFor(paper)?.score);
            notice('已加入「'+name+'」的课题待读');add.textContent='已加入课题';}
          finally{add.disabled=false;}
        }));
        links.append(add);
      }
      footer.append(links, read); article.append(footer); enrichment.decorate(article, paper); feed.append(article);
    }
    $('load-more').hidden = articles.length <= limit;
  }
  async function safe(fn) { try { return await fn(); } catch (error) { notice(error.message || '操作失败，请重试。'); } }
  let initialBaseline='', yearSearch=null;
  function resetYears(){
    yearSearch?.abort();yearSearch=null;
    $('preview-years').textContent=T('检索年度分布');
    $('years-results').replaceChildren();text('years-status','');
  }
  function renderYearChart(target,counts) {
    if(!Array.isArray(counts)||counts.some(([y,n])=>!Number.isInteger(y)||y<1||y>9999||!Number.isSafeInteger(n)||n<0))throw Error(T('来源返回的数据不完整'));
    const years=new Map(counts.filter(([,n])=>n>0).sort((a,b)=>a[0]-b[0]));
    if(!years.size){target.append(element('p','hint',T('无匹配文献')));return;}
    const first=years.keys().next().value,last=[...years.keys()].at(-1),max=Math.max(...years.values());
    const plot=element('div','year-plot'),detail=element('output','year-readout',T('选择年份可设置基线起点。'));
    for(let year=first;year<=last;year++){
      const count=years.get(year)||0,bar=element('button','year-bar');
      bar.type='button';bar.dataset.year=year;
      const date=String(year).padStart(4,'0')+'-01-01',label=year+' · '+count.toLocaleString()+' '+T('篇');
      bar.title=label;bar.setAttribute('aria-label',label);
      const fill=element('span','year-fill');fill.style.height=(count/max*100)+'%';bar.append(fill);
      const inspect=()=>{detail.textContent=label;};bar.onfocus=inspect;bar.onpointerenter=inspect;
      bar.disabled=date>$('baseline').max;
      bar.onclick=()=>{$('baseline').value=date;$('baseline').dispatchEvent(new Event('input'));inspect();};
      plot.append(bar);
    }
    const axis=element('div','year-axis');axis.append(element('span','',String(first)),element('span','',String(last)));
    target.append(plot,axis,detail);
  }
  $('preview-years').addEventListener('click',async()=>{
    if(yearSearch){resetYears();return;}
    resetYears();let rows;
    try{rows=R.validateRadarSourceQueries(sourceQueries.values());}catch{ text('years-status',T('请先填写所选来源的检索式。'));return; }
    const controller=new AbortController();yearSearch=controller;
    $('preview-years').textContent=T('取消检索');text('years-status',T('正在检索年度分布…'));
    const jobs=rows.map(async({source,query})=>{
      const group=element('section','year-source');group.append(element('strong','',R.RADAR_SOURCES[source].name));$('years-results').append(group);
      try{
        const counts=await adapters[source].publicationYears(query,{signal:controller.signal});
        if(yearSearch===controller)renderYearChart(group,counts);
      }catch(e){if(yearSearch===controller)group.append(element('p','hint',e.message));}
    });
    await Promise.all(jobs);
    if(yearSearch===controller){yearSearch=null;text('preview-years',T('检索年度分布'));text('years-status','');}
  });
  $('query').addEventListener('input',resetYears);
  $('editor').addEventListener('close',resetYears);
  function edit(radar) {
    editing = radar ? structuredClone(radar) : null;
    text('editor-title', radar ? '编辑文献追踪任务' : '新建文献追踪任务');
    $('name').value = radar?.name || ''; $('query').value = radar?.query || '';
    $('source').value=radar?.source||'pubmed';$('source').disabled=false;sourceQueries.reset(radar);enrichment.editorOpened(radar?.query || '');updateSource();
    $('frequency').value = radar?.intervalHours ?? 24;
    const latest=radar&&R.radarRevision(radar);
    const legacyDate=latest&&!Object.hasOwn(latest,'baselineStartDay')&&(latest.windowStart||R.radarScanWindow(R.radarBaseline(latest),latest.createdAt||radar.createdAt||Date.now()).startDay);
    initialBaseline=radar?.baselineStartDay??legacyDate??'';
    $('baseline').max=R.radarDay(Date.now());$('baseline').value=initialBaseline; $('enabled').checked = radar?.enabled ?? true;
    text('edit-note', radar ? '修改检索式或回溯范围后，会建立新的基线版本；旧文献记录保留在历史版本中。' : '启用后，在运行条件允许时检查到期任务。');
    text('form-error', ''); preview(); $('editor').showModal(); $('name').focus();
  }
  function sourceHint(id){const def=R.RADAR_SOURCES[id];return T(id==='asta'?'Asta 官方文献检索：输入关键词，按发表日期追踪。不是网页 Deep search；可能含预印本，晚到索引可能漏检。API Key 可在来源连接中配置。':['biorxiv','medrxiv'].includes(id)?'通过 Europe PMC 预印本索引检索。':id==='crossref'?'输入关键词；不使用 PubMed 字段标签或布尔语法。':def.credential?'需要 API Key；可用范围由服务商和机构授权决定。':'使用该来源原生检索语法。')+' '+T('日期口径：')+def.date;}
  function updateSource(){const id=$('source').value,def=R.RADAR_SOURCES[id];$('query').placeholder=def.example;text('source-hint',sourceHint(id));$('validate-query').hidden=id!=='pubmed';preview();}
  function previewPubmed(){
    const query=$('query').value.trim(),isPubmed=$('source').value==='pubmed';
    $('pubmed-check').hidden=!isPubmed;if(!isPubmed)return;
    // Keep the publisher's actual precedence. Only split a top-level operation.
    let depth=0,quoted=false;
    $('boolean-preview').textContent=query.replace(/"|\(|\)|\b(?:AND|OR|NOT)\b/gi,token=>{
      if(token==='"')quoted=!quoted;
      else if(!quoted){if(token==='(')depth++;else if(token===')')depth--;else if(depth===0)return '\n'+token+' ';}
      return token;
    });
    const raw=$('seed-pmids').value.trim(),ids=raw?raw.split(/[\s,，、;；]+/):[];
    const valid=ids.length>0&&ids.length<=20&&ids.every(value=>/^[1-9]\d{0,8}$/.test(value));
    const link=$('seed-preview');link.hidden=!query||!valid;link.removeAttribute('href');
    if(query&&valid)link.href='https://pubmed.ncbi.nlm.nih.gov/?term='+encodeURIComponent('('+query+') AND ('+ids.map(id=>id+'[PMID]').join(' OR ')+')');
    $('seed-error').textContent=raw&&!valid?'请输入最多 20 个数字 PMID。':'';
  }
  $('seed-pmids').addEventListener('input',previewPubmed);
  function preview(){previewPubmed();const id=$('source').value,q=encodeURIComponent($('query').value),urls={asta:'https://asta.allen.ai/',pubmed:'https://pubmed.ncbi.nlm.nih.gov/?term='+q,europepmc:'https://europepmc.org/search?query='+q,biorxiv:'https://europepmc.org/search?query='+encodeURIComponent('('+ $('query').value+') AND SRC:PPR AND PUBLISHER:bioRxiv'),medrxiv:'https://europepmc.org/search?query='+encodeURIComponent('('+ $('query').value+') AND SRC:PPR AND PUBLISHER:medRxiv'),arxiv:'https://arxiv.org/search/?query='+q+'&searchtype=all',crossref:'https://search.crossref.org/?q='+q,wos:'https://www.webofscience.com/wos/woscc/advanced-search',scopus:'https://www.scopus.com/search/form.uri?display=advanced'};$('preview-query').href=urls[id];text('preview-query',id==='asta'?'打开 Asta 网页 ↗':'打开来源检索 ↗');}
  $('source').addEventListener('change',updateSource);
  async function connectionState(){const id=$('connection-source').value,connection=await R.loadRadarConnection(id);if(id!==$('connection-source').value)return;text('connection-state',connection.apiKey?'本机已配置；填写新值可替换。':id==='asta'?'尚未配置 Asta Key；将尝试匿名访问，访问范围和限流由来源决定。':'尚未配置');$('connection-help').href=R.RADAR_SOURCES[id].help;$('institution-token').hidden=id!=='scopus';$('connection-key').value='';$('connection-token').value='';text('connection-message','');}
  $('connections').addEventListener('click',()=>safe(async()=>{await connectionState();$('connections-dialog').showModal();}));
  $('close-connections').addEventListener('click',()=>$('connections-dialog').close());
  $('connections-dialog').addEventListener('close',()=>{$('connection-key').value='';$('connection-token').value='';});
  $('connection-source').addEventListener('change',()=>safe(connectionState));
  $('connection-form').addEventListener('submit',async event=>{event.preventDefault();const id=$('connection-source').value;try{await R.saveRadarConnection(id,{apiKey:$('connection-key').value,instToken:$('connection-token').value});await connectionState();text('connection-message','连接已保存；请立即检查雷达以验证来源授权。');}catch(error){text('connection-message',error.message);}});
  $('remove-connection').addEventListener('click',()=>safe(async()=>{await R.removeRadarConnection($('connection-source').value);await connectionState();}));
  $('new-radar').addEventListener('click', () => edit(null)); $('edit-radar').addEventListener('click', () => edit(current()));
  for (const id of ['close-editor', 'cancel-editor']) $(id).addEventListener('click', () => $('editor').close());
  $('query').addEventListener('input', preview);
  $('radar-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const radar = await store.save({ id: editing?.id, name: $('name').value, ...(editing&&!editing.sourceQueries&&sourceQueries.values().length===1&&sourceQueries.values()[0].source===editing.source?{}:{sourceQueries:sourceQueries.values()}), query:sourceQueries.values()[0]?.query||'', source:editing?.source||sourceQueries.values()[0]?.source||'pubmed', intervalHours: Number($('frequency').value), ...(editing&&!Object.hasOwn(editing,'baselineStartDay')&&$('baseline').value===initialBaseline?R.radarBaseline(editing):{baselineStartDay:$('baseline').value}), enabled: $('enabled').checked }, editing?.editVersion);
      selected = radar.id; revisionNumber = null; filter = 'new'; limit = 40; $('editor').close(); notice('追踪任务已保存。'); await refresh(true); void tick();
    } catch (error) { text('form-error', error.message); }
  });
  $('check-radar').addEventListener('click', () => safe(async () => {
    const id = selected; notice('正在从所选来源检索，请稍候…');
    const pending = service.check(id); setTimeout(() => safe(() => refresh()), 50);
    try {
      const result = await pending;
      if (selected === id) { revisionNumber = null; filter = result.baseline ? 'baseline' : 'new'; limit = 40; }
      notice('');
    } finally { await refresh(true); }
  }));

  let historyTarget=null,historyPending=false;
  const historyStartFor=source=>source==='biorxiv'?'2013-01-01':source==='medrxiv'?'2019-01-01':'1900-01-01';
  $('history-baseline').addEventListener('click',()=>safe(async()=>{
    const radar=current(),revision=R.radarRevision(radar);
    if(!revision.baselineAt||revision.windowStart==='0001-01-01')return;
    const initialStart=revision.windowStart||R.radarScanWindow(R.radarBaseline(revision),revision.baselineAt).startDay;
    historyTarget={id:radar.id,version:revision.number};
    text('history-query',R.RADAR_SOURCES[radar.source].name+' · '+revision.query);
    text('history-date-basis',T('日期口径：')+R.RADAR_SOURCES[radar.source].date);
    $('history-start').value=historyStartFor(radar.source);
    $('history-end').value=new Date(Date.parse(initialStart)-R.DAY).toISOString().slice(0,10);
    $('history-end').max=$('history-end').value;text('history-error','');$('history-dialog').showModal();$('history-start').focus();
  }));
  for(const id of ['close-history','cancel-history'])$(id).addEventListener('click',()=>{if(!historyPending)$('history-dialog').close();});
  $('history-dialog').addEventListener('cancel',event=>{if(historyPending)event.preventDefault();});
  $('history-form').addEventListener('submit',async event=>{
    event.preventDefault();if(historyPending||!historyTarget)return;
    historyPending=true;for(const id of ['confirm-history','close-history','cancel-history','history-start','history-end'])$(id).disabled=true;
    text('history-error',T('正在检索历史基线…'));
    try {
      const result=await service.backfillBaseline(historyTarget.id,historyTarget.version,{startDay:$('history-start').value,endDay:$('history-end').value});
      if(selected===historyTarget.id){filter='baseline';revisionNumber=null;limit=40;}
      notice('');$('history-dialog').close();
      text('history-error','');
    } catch(error){text('history-error',T(error.message||'操作失败，请重试。'));}
    finally{historyPending=false;for(const id of ['confirm-history','close-history','cancel-history','history-start','history-end'])$(id).disabled=false;await refresh(true);}
  });
  $('check-all').addEventListener('click',()=>safe(async()=>{
    if(batch)return;batch=new AbortController();text('batch-status',T('批量检查进度')+' 0/'+state.radars.length);$('batch-results').hidden=true;await refresh(true);
    try{
      const result=await service.checkAll({signal:batch.signal,onProgress:async p=>{
        text('batch-status',T(`批量检查进度 ${p.completed}/${p.total}${p.current?' · '+p.current.name:''}`));await refresh(true);
      }});
      const failed=result.results.filter(r=>r.error||r.partial),success=result.results.length-failed.length,newCount=result.results.reduce((n,r)=>n+(r.newCount||0),0);
      text('batch-status',T(`${result.cancelled?'批量检查已停止':'批量检查完成'} · 成功 ${success}/${result.total} · 失败 ${failed.length} · 新增 ${newCount}`));
      const failures=$('batch-failures');failures.replaceChildren();
      for(const item of failed)failures.append(element('li','',item.name+'：'+(item.error?.message||item.sources.filter(s=>!s.success).map(s=>R.RADAR_SOURCES[s.source].name+'：'+s.error.message).join('；'))));
      $('batch-results').hidden=!failed.length;
    }finally{batch=null;await refresh(true);}
  }));
  $('cancel-check-all').addEventListener('click',()=>{batch?.abort();});
  $('toggle-radar').addEventListener('click', () => safe(async () => {
    const radar = current(); await store.save({ ...radar, enabled: !radar.enabled }, radar.editVersion); await refresh(true); void tick();
  }));
  for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => { filter = button.dataset.filter; limit = 40; void safe(() => refresh(true)); });
  $('revision').addEventListener('change', () => { revisionNumber = Number($('revision').value); limit = 40; void safe(() => refresh(true)); });
  for(const button of document.querySelectorAll('[data-trend-mode]'))button.addEventListener('click',()=>{
    trendMode=button.dataset.trendMode;for(const item of document.querySelectorAll('[data-trend-mode]'))item.setAttribute('aria-pressed',String(item===button));
    const radar=current();if(radar)R.renderRadarTrend($('radar-trend-chart'),radar.revisions.find(v=>v.number===revisionNumber)||R.radarRevision(radar),trendMode);
  });
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
  void globalThis.SciLLM?.bootstrapInterfaceLanguage?.();
  globalThis.SciLLM?.onInterfaceLanguageChange?.(() => { if (state) render(); });
  void safe(async () => { await refresh(true); await tick(); });
  setInterval(() => safe(() => refresh()), 2000);
  setInterval(tick, 60000);
})();
