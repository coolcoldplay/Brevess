(function initializeResearchLogicMapEditor() {
  'use strict';

  const params = new URLSearchParams(location.search);
  const previewMode = params.get('preview') === '1';
  const previewData = String(params.get('previewData') || '');
  const workspaceId = String(params.get('workspaceId') || '');
  const mapId = String(params.get('mapId') || '');
  const sourceTabIdParam = params.get('sourceTabId');
  const sourceTabId = /^\d+$/u.test(sourceTabIdParam || '')
    ? Number(sourceTabIdParam) : Number.NaN;
  const mapPath = globalThis.SciLLM?.researchLogicMapAssetPath?.(mapId) ||
    `logic-maps/${mapId}.json`;
  const draftKey = `brevess-logic-map-draft:${workspaceId}:${mapId}`;
  const svgNamespace = 'http://www.w3.org/2000/svg';

  let logicMap = null;
  let remoteLogicMap = null;
  let assetRevision = 0;
  let assetContentHash = '';
  let workspaceGeneration = 1;
  let selection = { kind: 'background' };
  let saveTimer = null;
  let renderTimer = null;
  let saveInFlight = null;
  let pendingSave = false;
  let fullscreenLayoutActive = false;
  let mechanismRenderFrame = null;

  const byId = id => document.getElementById(id);
  const text = (value, maximum = 12000) => String(value || '')
    .normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maximum);
  function safeMechanismDisplayLabel(value) {
    return text(value, 180)
      .replace(/<[^>]*>/gu, ' ')
      .replace(/\b(?:javascript|data|vbscript)\s*:/giu, ' ')
      .replace(/\b(?:panel|figure|fig\.?)\s*[a-z0-9._-]*/giu, ' ')
      .replace(/(?:面板|图)\s*[a-z0-9一二三四五六七八九十._-]+/giu, ' ')
      .replace(/[\[\]{}<>"'`]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 120) || '未命名节点';
  }
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const icon = name => {
    const node = document.createElement('i');
    node.className = `ph ph-${name}`;
    return node;
  };
  const button = (label, handler, options = {}) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    if (options.className) node.className = options.className;
    if (options.title) node.title = options.title;
    node.addEventListener('click', handler);
    return node;
  };

  const normalize = value => globalThis.SciLLM.normalizeResearchLogicMap(value);

  function figureConnection(item) {
    return (item?.connections || []).find(connection => connection.mode === 'figure') || null;
  }
  function groupConnection(item, groupId) {
    return (item?.connections || []).find(connection =>
      connection.mode === 'evidence-group' && connection.sourceGroupId === groupId) || null;
  }
  function setFigureConnection(item, targetStepId) {
    item.connections = (item.connections || []).filter(connection => connection.mode !== 'figure');
    if (targetStepId) item.connections.unshift({
      connectionId: uid(`${item.supplementalId}-figure-link`),
      mode: 'figure', targetStepId, sourceGroupId: '', targetGroupId: ''
    });
    markObjectEdited(item, 'connections');
  }
  function setGroupConnection(item, sourceGroupId, targetStepId, targetGroupId) {
    item.connections = (item.connections || []).filter(connection => !(
      connection.mode === 'evidence-group' && connection.sourceGroupId === sourceGroupId
    ));
    if (targetStepId && targetGroupId) item.connections.push({
      connectionId: uid(`${item.supplementalId}-group-link`),
      mode: 'evidence-group', targetStepId, sourceGroupId, targetGroupId
    });
    markObjectEdited(item, 'connections');
  }

  async function runtimeMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.success) {
      const error = new Error(response?.error?.message || response?.error || 'REQUEST_FAILED');
      error.code = response?.error?.code || '';
      throw error;
    }
    return response.data;
  }

  async function getAsset(relativePath) {
    const data = await runtimeMessage({
      type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId, relativePath
    });
    workspaceGeneration = Number(data?.workspaceGeneration) || workspaceGeneration || 1;
    return data?.asset || null;
  }

  function setSaveStatus(state, message) {
    const status = byId('logicMapSaveStatus');
    if (!status) return;
    status.dataset.state = state;
    status.replaceChildren(icon(state === 'saving' ? 'arrows-clockwise'
      : state === 'saved' ? 'check-circle' : state === 'error' ? 'warning' : 'floppy-disk'),
    document.createTextNode(message));
    byId('retryLogicMapSave').hidden = state !== 'error';
  }

  function draftPayload() {
    return { savedAt: Date.now(), remoteContentHash: assetContentHash, map: logicMap };
  }
  function saveDraft() {
    try { localStorage.setItem(draftKey, JSON.stringify(draftPayload())); } catch (_) {}
  }
  function clearDraft() {
    try { localStorage.removeItem(draftKey); } catch (_) {}
  }
  function readDraft() {
    try {
      const parsed = JSON.parse(localStorage.getItem(draftKey) || 'null');
      return parsed?.map ? parsed : null;
    } catch (_) { return null; }
  }

  function markChanged() {
    if (!logicMap) return;
    logicMap.userEditedAt = new Date().toISOString();
    logicMap.meta.updatedAt = logicMap.userEditedAt;
    logicMap.manuallyEdited = true;
    saveDraft();
    setSaveStatus('dirty', '更改已保存在浏览器草稿，等待同步…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveMap(), 750);
  }

  async function saveIndex(savedMap = logicMap) {
    const indexPath = SciLLM.RESEARCH_LOGIC_MAP_INDEX_PATH || 'logic-maps/index.json';
    let asset = await getAsset(indexPath);
    let content = SciLLM.upsertResearchLogicMapIndex(asset?.content, savedMap);
    const save = () => runtimeMessage({
      type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId, workspaceGeneration,
      relativePath: indexPath, content,
      expectedRevision: Number(asset?.revision) || 0,
      expectedContentHash: String(asset?.contentHash || '')
    });
    try { await save(); } catch (error) {
      if (!['ASSET_REVISION_CONFLICT', 'ASSET_HASH_CONFLICT'].includes(error.code)) throw error;
      asset = await getAsset(indexPath);
      content = SciLLM.upsertResearchLogicMapIndex(asset?.content, savedMap);
      await save();
    }
  }

  async function saveMap() {
    if (!logicMap) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    if (previewMode) {
      setSaveStatus('saved', '预览模式 · 更改仅保留在当前页面');
      return;
    }
    if (saveInFlight) {
      pendingSave = true;
      return saveInFlight;
    }
    setSaveStatus('saving', '正在保存到本文工作区…');
    const snapshot = normalize(logicMap);
    const fingerprint = SciLLM.researchLogicMapFingerprint(snapshot);
    saveInFlight = runtimeMessage({
      type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId, workspaceGeneration,
      relativePath: mapPath, content: snapshot,
      expectedRevision: assetRevision, expectedContentHash: assetContentHash
    }).then(async data => {
      assetRevision = Number(data?.asset?.revision) || assetRevision;
      assetContentHash = String(data?.asset?.contentHash || assetContentHash);
      remoteLogicMap = normalize(snapshot);
      await saveIndex(snapshot);
      if (SciLLM.researchLogicMapFingerprint(normalize(logicMap)) === fingerprint) {
        clearDraft();
        setSaveStatus('saved', data?.queued ? '已保存，等待同步到本地文件夹' : '已安全保存到浏览器');
      } else {
        pendingSave = true;
        saveDraft();
        setSaveStatus('dirty', '新更改已留在草稿中，继续同步…');
      }
    }).catch(error => {
      saveDraft();
      const conflict = ['ASSET_REVISION_CONFLICT', 'ASSET_HASH_CONFLICT'].includes(error.code);
      byId('reloadLogicMapRemote').hidden = !conflict;
      setSaveStatus('error', conflict
        ? '另一窗口修改了这张图；本地草稿仍安全保留'
        : `保存失败：${error.message}；草稿仍保留`);
    }).finally(() => {
      saveInFlight = null;
      if (pendingSave) {
        pendingSave = false;
        void saveMap();
      }
    });
    return saveInFlight;
  }

  function fallback(value, label = '待补充') {
    return text(value, 4000) || label;
  }
  function textItems(items) {
    return (Array.isArray(items) ? items : []).map(item => text(item?.text ?? item, 3000)).filter(Boolean);
  }
  function selectedStep() {
    return logicMap?.steps?.find(step => step.stepId === selection.stepId) || null;
  }
  function selectedSupplemental() {
    return logicMap?.supplementalMaterials?.find(item =>
      item.supplementalId === selection.supplementalId) || null;
  }
  function isSelected(kind, data = {}) {
    return selection.kind === kind && Object.entries(data).every(([key, value]) => selection[key] === value);
  }
  function setSelection(kind, data = {}) {
    selection = { kind, ...data };
    render();
  }
  function selectionAttributes(node, kind, data = {}) {
    node.classList.add('selectable-module');
    node.tabIndex = 0;
    node.dataset.selectionKind = kind;
    Object.entries(data).forEach(([key, value]) => { node.dataset[key] = value; });
    node.classList.toggle('is-selected', isSelected(kind, data));
  }
  function appendBullets(parent, items, emptyLabel = '待补充') {
    const values = textItems(items);
    const list = document.createElement('ul');
    if (!values.length) {
      const item = document.createElement('li');
      item.className = 'empty-copy';
      item.textContent = emptyLabel;
      list.appendChild(item);
    } else values.forEach(value => {
      const item = document.createElement('li');
      item.textContent = value;
      list.appendChild(item);
    });
    parent.appendChild(list);
  }

  function chainArrow() {
    const arrow = document.createElement('div');
    arrow.className = 'chain-flow-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↓';
    return arrow;
  }
  function chainCard(kind, label, iconName, items, data = {}, className = '') {
    const card = document.createElement('section');
    card.className = `chain-module ${className}`.trim();
    selectionAttributes(card, kind, data);
    const heading = document.createElement('div');
    heading.className = 'chain-label';
    const copy = document.createElement('span');
    copy.append(icon(iconName), document.createTextNode(label));
    heading.appendChild(copy);
    card.appendChild(heading);
    appendBullets(card, items);
    return card;
  }

  function appendScientificQuestionGraph(parent, questions) {
    const items = Array.isArray(questions) ? questions : [];
    const byQuestionId = new Map(items.map(question => [
      question.questionId, question.text || question.questionId
    ]));
    const relationLabels = {
      root: '总问题', progressive: '递进', parallel: '并列', branch: '分支',
      convergent: '汇合', validation: '验证'
    };
    const list = document.createElement('ol');
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-copy';
      empty.textContent = '待补充科学问题';
      list.appendChild(empty);
    } else items.forEach(question => {
      const row = document.createElement('li');
      row.appendChild(document.createTextNode(question.text || '未命名科学问题'));
      const relationType = relationLabels[question.relationType] || relationLabels.root;
      const parentQuestionIds = Array.isArray(question.parentQuestionIds)
        ? question.parentQuestionIds : [];
      const supportingFigureIds = Array.isArray(question.supportingFigureIds)
        ? question.supportingFigureIds : [];
      const relation = document.createElement('span');
      relation.className = 'evidence-role';
      relation.textContent = `关系：${relationType}` + (
        parentQuestionIds.length
          ? `；上游：${parentQuestionIds.map(id => byQuestionId.get(id) || id).join('、')}`
          : '；上游：无'
      );
      const support = document.createElement('span');
      support.className = 'evidence-limitation';
      support.textContent = `支持 Figure：${supportingFigureIds.join('、') || '待补充'}`;
      row.append(relation, support);
      list.appendChild(row);
    });
    parent.appendChild(list);
  }

  function locatorLabel(locator) {
    if (locator?.kind === 'time-range') {
      return `${Number(locator.startSeconds) || 0}s–${Number(locator.endSeconds) || 0}s`;
    }
    if (locator?.kind === 'table-range') return locator.value || '表格范围待补充';
    const values = Array.isArray(locator?.values) ? locator.values.filter(Boolean) : [];
    return values.length ? `Panel ${values.join('、')}` : 'Panel 待补充';
  }

  function evidenceGroupCard(group, stepId) {
    const card = document.createElement('article');
    card.className = 'evidence-group-card';
    card.dataset.groupId = group.groupId;
    card.dataset.stepId = stepId;
    selectionAttributes(card, 'evidence-group', { stepId, groupId: group.groupId });
    const heading = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = fallback(group.title, '证据组');
    const method = document.createElement('span');
    method.className = 'evidence-group-method';
    method.textContent = group.method || '';
    heading.append(title, method);
    card.appendChild(heading);
    const points = document.createElement('ul');
    points.className = 'evidence-point-list';
    if (!group.evidencePoints?.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-copy';
      empty.textContent = '待补充证据点';
      points.appendChild(empty);
    } else group.evidencePoints.forEach(point => {
      const row = document.createElement('li');
      const locator = document.createElement('span');
      locator.className = 'evidence-locator';
      locator.textContent = locatorLabel(point.locator);
      row.append(locator, document.createTextNode(fallback(point.observation, '观察结果待补充')));
      if (point.argumentRole) {
        const role = document.createElement('span');
        role.className = 'evidence-role';
        role.textContent = `论证作用：${point.argumentRole}`;
        row.appendChild(role);
      }
      if (point.limitation) {
        const limitation = document.createElement('span');
        limitation.className = 'evidence-limitation';
        limitation.textContent = `边界：${point.limitation}`;
        row.appendChild(limitation);
      }
      if (point.needsManualSplit) {
        const warning = document.createElement('span');
        warning.className = 'evidence-limitation';
        warning.textContent = '需人工确认 Panel—观察—论证作用是否应拆成多个证据点';
        row.appendChild(warning);
      }
      points.appendChild(row);
    });
    card.appendChild(points);
    if (group.groupConclusion) {
      const conclusion = document.createElement('p');
      conclusion.className = 'evidence-group-conclusion';
      conclusion.textContent = `共同支持：${group.groupConclusion}`;
      card.appendChild(conclusion);
    }
    return card;
  }

  function renderFigureStage(step, index) {
    const collapsed = logicMap.view.collapsedStepIds.includes(step.stepId);
    const stage = document.createElement('section');
    stage.className = 'figure-stage';
    stage.classList.toggle('is-collapsed', collapsed);
    stage.dataset.stepId = step.stepId;

    const question = chainCard('step-question', `${step.figureLabel} 开始着手解决的问题`,
      'question', step.questionItems, { stepId: step.stepId }, 'figure-question-card');
    stage.appendChild(question);

    const figure = document.createElement('section');
    figure.className = 'figure-card';
    figure.dataset.stepId = step.stepId;
    selectionAttributes(figure, 'step-proof', { stepId: step.stepId });
    const header = document.createElement('header');
    const copy = document.createElement('div');
    copy.className = 'figure-heading-copy';
    const title = document.createElement('b');
    title.textContent = fallback(step.figureLabel, `Figure ${index + 1}`);
    const meta = document.createElement('span');
    meta.textContent = [step.role, step.evidenceLevel, `${step.evidenceGroups.length} 组证据`]
      .filter(Boolean).join(' · ');
    copy.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'figure-actions';
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'collapse-button';
    collapse.title = collapsed ? '展开本图证据组' : '折叠本图证据组';
    collapse.setAttribute('aria-label', collapse.title);
    collapse.setAttribute('aria-expanded', String(!collapsed));
    collapse.appendChild(icon(collapsed ? 'caret-down' : 'caret-up'));
    collapse.addEventListener('click', event => {
      event.stopPropagation();
      toggleStepCollapsed(step.stepId);
    });
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'collapse-button';
    jump.title = '跳到原文 Figure';
    jump.appendChild(icon('compass'));
    jump.addEventListener('click', event => {
      event.stopPropagation();
      void jumpToSource(step);
    });
    actions.append(collapse, jump);
    header.append(copy, actions);
    figure.appendChild(header);
    const groups = document.createElement('div');
    groups.className = 'figure-evidence-groups';
    if (!step.evidenceGroups.length) {
      const empty = document.createElement('article');
      empty.className = 'evidence-group-card empty-copy';
      empty.textContent = '待补充证据组';
      groups.appendChild(empty);
    } else step.evidenceGroups.forEach(group => groups.appendChild(evidenceGroupCard(group, step.stepId)));
    figure.appendChild(groups);
    const proof = chainCard('step-proof', `${step.figureLabel} · 本图证明`, 'seal-check', step.proofItems,
      { stepId: step.stepId }, 'figure-proof-card');
    figure.appendChild(proof);
    stage.appendChild(figure);
    return stage;
  }

  function renderMainChain() {
    const chain = byId('logicMapMainChain');
    chain.replaceChildren();
    chain.appendChild(chainCard('background', '已知背景', 'book-open-text',
      logicMap.meta.backgroundItems, {}, 'chain-background'));
    chain.appendChild(chainArrow());
    const scientific = chainCard(
      'scientific', '科学问题', 'lightbulb', [], {}, 'chain-scientific'
    );
    scientific.querySelector('ul')?.remove();
    appendScientificQuestionGraph(scientific, logicMap.meta.scientificQuestions);
    chain.appendChild(scientific);
    logicMap.steps.forEach((step, index) => {
      chain.appendChild(chainArrow());
      chain.appendChild(renderFigureStage(step, index));
    });
    chain.appendChild(chainArrow());
    const final = chainCard('final', '最终得到的所有结论（对应最初科学问题）',
      'check-circle', [], {}, 'chain-final');
    const old = final.querySelector('ul');
    old?.remove();
    const list = document.createElement('ul');
    if (!logicMap.meta.finalConclusions.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-copy';
      empty.textContent = '待补充最终结论';
      list.appendChild(empty);
    } else logicMap.meta.finalConclusions.forEach(conclusion => {
      const item = document.createElement('li');
      item.appendChild(document.createTextNode(conclusion.text));
      const linked = logicMap.meta.scientificQuestions.filter(question =>
        conclusion.questionIds.includes(question.questionId));
      if (linked.length) {
        const links = document.createElement('span');
        links.className = 'conclusion-question-links';
        links.textContent = `回应：${linked.map(question => question.text).join('；')}`;
        item.appendChild(links);
      }
      list.appendChild(item);
    });
    final.appendChild(list);
    chain.appendChild(final);
  }

  function supplementalTypeLabel(type) {
    return ({ figure: '补充图', video: '补充视频', table: '补充表' })[type] || '补充材料';
  }

  function renderSupplementalLane() {
    const lane = byId('logicMapSupplementalLane');
    lane.replaceChildren();
    if (!logicMap.supplementalMaterials.length) {
      const empty = document.createElement('div');
      empty.className = 'supplemental-card empty-copy';
      empty.textContent = '可在左侧编辑面板手动新建补充图、视频或表格';
      lane.appendChild(empty);
      return;
    }
    const stepOrder = new Map(logicMap.steps.map((step, index) => [step.stepId, index]));
    const materials = [...logicMap.supplementalMaterials].sort((left, right) =>
      (stepOrder.get(figureConnection(left)?.targetStepId) ?? 999) -
      (stepOrder.get(figureConnection(right)?.targetStepId) ?? 999));
    materials.forEach(item => {
      const collapsed = logicMap.view.collapsedSupplementalIds.includes(item.supplementalId);
      const card = document.createElement('article');
      card.className = 'supplemental-card';
      card.classList.toggle('is-collapsed', collapsed);
      card.dataset.supplementalId = item.supplementalId;
      selectionAttributes(card, 'supplemental', { supplementalId: item.supplementalId });
      const header = document.createElement('header');
      const title = document.createElement('div');
      title.className = 'supplemental-title';
      const kind = document.createElement('span');
      kind.className = 'supplemental-kind';
      kind.textContent = supplementalTypeLabel(item.type);
      const label = document.createElement('b');
      label.textContent = item.label;
      title.append(kind, label);
      const collapse = document.createElement('button');
      collapse.type = 'button';
      collapse.className = 'collapse-button';
      collapse.title = collapsed ? '展开补充材料证据组' : '折叠补充材料证据组';
      collapse.setAttribute('aria-label', collapse.title);
      collapse.setAttribute('aria-expanded', String(!collapsed));
      collapse.appendChild(icon(collapsed ? 'caret-down' : 'caret-up'));
      collapse.addEventListener('click', event => {
        event.stopPropagation();
        toggleSupplementalCollapsed(item.supplementalId);
      });
      header.append(title, collapse);
      card.appendChild(header);
      const summary = document.createElement('p');
      summary.className = 'supplemental-summary';
      summary.textContent = fallback(item.summary || textItems(item.proofItems)[0],
        '待补充该材料证明或支持的内容');
      card.appendChild(summary);
      const groups = document.createElement('div');
      groups.className = 'supplemental-groups';
      item.evidenceGroups.forEach(group => {
        const groupCard = document.createElement('article');
        groupCard.className = 'supplemental-group selectable-module';
        groupCard.dataset.suppGroupId = group.groupId;
        groupCard.dataset.supplementalId = item.supplementalId;
        selectionAttributes(groupCard, 'supplemental-group', {
          supplementalId: item.supplementalId, groupId: group.groupId
        });
        const name = document.createElement('strong');
        name.textContent = fallback(group.title, '补充证据组');
        const method = document.createElement('span');
        method.className = 'evidence-group-method';
        method.textContent = group.method || '';
        const pointList = document.createElement('ul');
        pointList.className = 'evidence-point-list';
        if (!group.evidencePoints.length) {
          const empty = document.createElement('li');
          empty.className = 'empty-copy';
          empty.textContent = '待补充证据点';
          pointList.appendChild(empty);
        } else group.evidencePoints.forEach(point => {
          const row = document.createElement('li');
          const locator = document.createElement('span');
          locator.className = 'evidence-locator';
          locator.textContent = locatorLabel(point.locator);
          row.append(locator, document.createTextNode(
            fallback(point.observation, '观察结果待补充')));
          if (point.argumentRole) {
            const role = document.createElement('span');
            role.className = 'evidence-role';
            role.textContent = `论证作用：${point.argumentRole}`;
            row.appendChild(role);
          }
          if (point.limitation) {
            const limitation = document.createElement('span');
            limitation.className = 'evidence-limitation';
            limitation.textContent = `边界：${point.limitation}`;
            row.appendChild(limitation);
          }
          if (point.needsManualSplit) {
            const warning = document.createElement('span');
            warning.className = 'evidence-limitation';
            warning.textContent = '需人工确认并拆分证据点';
            row.appendChild(warning);
          }
          pointList.appendChild(row);
        });
        const conclusion = document.createElement('p');
        conclusion.className = 'evidence-group-conclusion';
        conclusion.textContent = `共同支持：${fallback(group.groupConclusion,
          '待补充证据组结论')}`;
        groupCard.append(name, method, pointList, conclusion);
        if (group.limitation) {
          const limitation = document.createElement('p');
          limitation.className = 'evidence-limitation';
          limitation.textContent = `组级边界：${group.limitation}`;
          groupCard.appendChild(limitation);
        }
        groups.appendChild(groupCard);
      });
      card.appendChild(groups);
      lane.appendChild(card);
    });
  }

  function svgElement(name, attributes = {}) {
    const node = document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function drawBezier(layer, boardRect, source, target, className) {
    if (!source || !target) return;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (!from.width || !from.height || !to.width || !to.height) return;
    const startX = from.right - boardRect.left;
    const startY = from.top + from.height / 2 - boardRect.top;
    const endX = to.left - boardRect.left;
    const endY = to.top + to.height / 2 - boardRect.top;
    const span = Math.max(40, (endX - startX) * .56);
    const path = svgElement('path', {
      d: `M ${startX} ${startY} C ${startX + span} ${startY}, ${endX - span} ${endY}, ${endX} ${endY}`,
      fill: 'none', stroke: className === 'group' ? '#8d7bb8' : '#6d6594',
      'stroke-width': className === 'group' ? 1.6 : 2.1,
      'stroke-dasharray': className === 'group' ? '5 4' : '',
      'marker-end': 'url(#supplement-arrow)'
    });
    layer.appendChild(path);
  }

  function drawSupplementalConnectors() {
    const board = byId('logicMapBoard');
    const layer = byId('logicMapConnectorLayer');
    if (!board || !layer) return;
    layer.replaceChildren();
    const defs = svgElement('defs');
    const marker = svgElement('marker', {
      id: 'supplement-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse'
    });
    marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#6d6594' }));
    defs.appendChild(marker);
    layer.appendChild(defs);
    const boardRect = board.getBoundingClientRect();
    layer.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);
    logicMap.supplementalMaterials.forEach(item => {
      const source = board.querySelector(`.supplemental-card[data-supplemental-id="${CSS.escape(item.supplementalId)}"]`);
      const targetStepId = figureConnection(item)?.targetStepId || '';
      const target = board.querySelector(`.figure-card[data-step-id="${CSS.escape(targetStepId)}"]`);
      drawBezier(layer, boardRect, source, target, 'figure');
      if (logicMap.view.collapsedSupplementalIds.includes(item.supplementalId)) return;
      item.evidenceGroups.forEach(group => {
        const connection = groupConnection(item, group.groupId);
        if (!connection) return;
        const groupSource = board.querySelector(
          `.supplemental-group[data-supplemental-id="${CSS.escape(item.supplementalId)}"][data-supp-group-id="${CSS.escape(group.groupId)}"]`
        );
        const groupTarget = board.querySelector(
          `.evidence-group-card[data-step-id="${CSS.escape(connection.targetStepId)}"][data-group-id="${CSS.escape(connection.targetGroupId)}"]`
        );
        drawBezier(layer, boardRect, groupSource, groupTarget, 'group');
      });
    });
  }

  function synchronizeMechanismChain() {
    logicMap.meta.mechanismChain = (Array.isArray(logicMap.meta.mechanismEdges)
      ? logicMap.meta.mechanismEdges : [])
      .filter(edge => text(edge?.sourceId) && text(edge?.targetId))
      .map(edge => `${text(edge.sourceId)} ${edge.effect === 'inhibit'
        ? '⊣' : edge.effect === 'promote' ? '→' : '⇢'} ${text(edge.targetId)}`)
      .join('；');
  }

  function renderMechanism() {
    const chain = byId('logicMapMechanismChain');
    if (mechanismRenderFrame !== null) {
      cancelAnimationFrame(mechanismRenderFrame);
      mechanismRenderFrame = null;
    }
    chain.replaceChildren();
    const edges = Array.isArray(logicMap.meta.mechanismEdges) ? logicMap.meta.mechanismEdges : [];
    if (!edges.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-copy';
      empty.textContent = fallback(logicMap.meta.mechanismChain, '当前证据尚不足以形成机制链');
      chain.appendChild(empty);
      return;
    }
    edges.forEach((edge, index) => {
      const row = document.createElement('div');
      row.className = 'mechanism-edge-row';
      const relationKind = edge.relationKind === 'correlative' || edge.effect === 'associate'
        ? 'correlative' : 'causal';
      const dashed = edge.lineStyle === 'dashed' || relationKind === 'correlative';
      const contested = edge.contested === true;
      const strokeColor = dashed ? '#27343b' : '#247d72';
      row.classList.toggle('is-contested', contested);
      row.dataset.lineStyle = dashed ? 'dashed' : 'solid';
      const sourceNode = document.createElement('span');
      sourceNode.className = 'mechanism-node';
      sourceNode.textContent = safeMechanismDisplayLabel(edge.sourceId);
      const targetNode = document.createElement('span');
      targetNode.className = 'mechanism-node';
      targetNode.textContent = safeMechanismDisplayLabel(edge.targetId);
      const connector = document.createElement('span');
      connector.className = 'mechanism-edge-track';
      const arrowId = `mechanism-promote-arrow-${index}`;
      const svg = svgElement('svg', {
        class: 'mechanism-edge-svg', viewBox: '0 0 180 48',
        preserveAspectRatio: 'none', 'aria-hidden': 'true'
      });
      const defs = svgElement('defs');
      const marker = svgElement('marker', {
        id: arrowId, viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
      });
      marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: strokeColor }));
      defs.appendChild(marker);
      svg.appendChild(defs);
      svg.appendChild(svgElement('line', {
        x1: 3, y1: 27, x2: 174, y2: 27,
        stroke: strokeColor, 'stroke-width': 3,
        'stroke-dasharray': dashed ? '10 7' : '',
        'marker-end': edge.effect === 'inhibit' ? '' : `url(#${arrowId})`
      }));
      if (edge.effect === 'inhibit') {
        svg.appendChild(svgElement('line', {
          x1: 174, y1: 16, x2: 174, y2: 38,
          stroke: strokeColor, 'stroke-width': 4
        }));
      }
      const status = document.createElement('small');
      status.className = 'mechanism-edge-meta';
      status.textContent = contested ? '支持与反证并存' : '';
      connector.append(status, svg);
      row.append(sourceNode, connector, targetNode);
      chain.appendChild(row);
    });
  }

  function renderCanvas() {
    byId('logicMapArticleTitle').textContent = logicMap.meta.articleTitle || '当前论文';
    document.title = `${logicMap.meta.title || '论文论证地图'} · Brevess`;
    byId('logicMapClaimBoundary').textContent = fallback(logicMap.meta.claimBoundary, '尚未填写结论边界');
    byId('logicMapCanvas').style.setProperty('--map-zoom', String(logicMap.view.zoom));
    byId('logicMapZoomValue').textContent = `${Math.round(logicMap.view.zoom * 100)}%`;
    byId('logicMapShell').classList.toggle('is-editor-collapsed', logicMap.view.editorCollapsed);
    byId('toggleLogicMapEditor').setAttribute('aria-pressed', String(logicMap.view.editorCollapsed));
    byId('toggleLogicMapEditor').querySelector('span').textContent =
      logicMap.view.editorCollapsed ? '展开编辑' : '折叠编辑';
    const allMainCollapsed = logicMap.steps.length > 0 && logicMap.steps.every(step =>
      logicMap.view.collapsedStepIds.includes(step.stepId));
    const allSupplementalCollapsed = logicMap.supplementalMaterials.every(item =>
      logicMap.view.collapsedSupplementalIds.includes(item.supplementalId));
    const allCollapsed = allMainCollapsed && allSupplementalCollapsed;
    byId('collapseAllLogicMapFigures').setAttribute('aria-pressed', String(allCollapsed));
    byId('collapseAllLogicMapFigures').querySelector('span').textContent =
      allCollapsed ? '展开所有图' : '折叠所有图';
    renderMechanism();
    renderSupplementalLane();
    renderMainChain();
    document.querySelector('.logic-map-boundary-card')?.classList.toggle('is-selected',
      selection.kind === 'boundary');
    document.querySelector('.logic-map-mechanism-card')?.classList.toggle('is-selected',
      selection.kind === 'mechanism');
    requestAnimationFrame(drawSupplementalConnectors);
  }

  function editorSection(title, actions = []) {
    const section = document.createElement('section');
    section.className = 'editor-section';
    const header = document.createElement('header');
    const heading = document.createElement('h3');
    heading.textContent = title;
    header.appendChild(heading);
    if (actions.length) {
      const holder = document.createElement('div');
      holder.className = 'editor-mini-actions';
      actions.forEach(action => holder.appendChild(action));
      header.appendChild(holder);
    }
    section.appendChild(header);
    return section;
  }

  function editorField(parent, labelText, value, onInput, options = {}) {
    const label = document.createElement('label');
    label.appendChild(document.createTextNode(labelText));
    const input = options.multiline === false
      ? document.createElement('input') : document.createElement('textarea');
    if (input instanceof HTMLTextAreaElement) input.rows = options.rows || 3;
    input.value = value || '';
    if (options.placeholder) input.placeholder = options.placeholder;
    input.maxLength = options.maxLength || 4000;
    input.addEventListener('input', () => {
      onInput(input.value);
      markChanged();
      scheduleCanvasRender();
    });
    label.appendChild(input);
    parent.appendChild(label);
    return input;
  }

  function editorSelect(parent, labelText, value, choices, onChange) {
    const label = document.createElement('label');
    label.appendChild(document.createTextNode(labelText));
    const select = document.createElement('select');
    choices.forEach(([choiceValue, choiceLabel]) => {
      const option = document.createElement('option');
      option.value = choiceValue;
      option.textContent = choiceLabel;
      select.appendChild(option);
    });
    select.value = value || choices[0]?.[0] || '';
    select.addEventListener('change', () => {
      onChange(select.value);
      markChanged();
      render();
    });
    label.appendChild(select);
    parent.appendChild(label);
    return select;
  }

  function editorList(parent, items, options) {
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'editor-row';
      const input = document.createElement(options.singleLine ? 'input' : 'textarea');
      if (input instanceof HTMLTextAreaElement) input.rows = options.rows || 2;
      input.value = item.text || '';
      input.placeholder = options.placeholder || '填写一个要点';
      input.maxLength = options.maxLength || 3000;
      input.addEventListener('input', () => {
        item.text = input.value;
        item.manuallyEdited = true;
        item.manuallyEditedFields = ['text'];
        options.onChange?.(item, index);
        markChanged();
        scheduleCanvasRender();
      });
      const remove = button('×', () => {
        items.splice(index, 1);
        options.onRemove?.(item, index);
        options.onChange?.(null, index);
        markChanged();
        render();
      }, { title: '删除此要点' });
      row.append(input, remove);
      parent.appendChild(row);
    });
    parent.appendChild(button(`＋ ${options.addLabel || '添加要点'}`, () => {
      items.push(options.create());
      options.onChange?.(items.at(-1), items.length - 1);
      markChanged();
      render();
    }, { className: 'editor-add' }));
  }

  function markObjectEdited(object, field) {
    object.manuallyEdited = true;
    object.manuallyEditedFields = [...new Set([...(object.manuallyEditedFields || []), field])];
  }

  function renderBackgroundEditor(body) {
    const section = editorSection('已知背景（分点）');
    editorList(section, logicMap.meta.backgroundItems, {
      addLabel: '添加背景要点', create: () => ({ itemId: uid('background'), text: '' }),
      onChange: () => markObjectEdited(logicMap.meta, 'backgroundItems')
    });
    body.appendChild(section);
  }

  function renderScientificEditor(body) {
    const section = editorSection('科学问题（关系图）');
    const questions = logicMap.meta.scientificQuestions;
    const relationChoices = [
      ['root', '总问题'], ['progressive', '递进'], ['parallel', '并列'],
      ['branch', '分支'], ['convergent', '汇合'], ['validation', '验证']
    ];
    questions.forEach((question, index) => {
      const card = editorSection(`问题 ${index + 1}`, [
        button('删除', () => {
          questions.splice(index, 1);
          logicMap.meta.finalConclusions.forEach(conclusion => {
            conclusion.questionIds = conclusion.questionIds.filter(
              id => id !== question.questionId
            );
          });
          questions.forEach(candidate => {
            candidate.parentQuestionIds = (candidate.parentQuestionIds || [])
              .filter(id => id !== question.questionId);
            if (candidate.relationType !== 'root' && !candidate.parentQuestionIds.length) {
              candidate.relationType = 'root';
            }
          });
          markObjectEdited(logicMap.meta, 'scientificQuestions');
          markChanged();
          render();
        }, { className: 'danger' })
      ]);
      editorField(card, '问题内容', question.text, value => {
        question.text = value;
        markObjectEdited(question, 'text');
        markObjectEdited(logicMap.meta, 'scientificQuestions');
      }, { rows: 2, maxLength: 2400 });
      editorSelect(card, '逻辑关系', question.relationType, relationChoices, value => {
        question.relationType = value;
        if (value === 'root') question.parentQuestionIds = [];
        else if (!question.parentQuestionIds?.length && index > 0) {
          question.parentQuestionIds = [questions[index - 1].questionId];
        }
        markObjectEdited(question, 'relationType');
        markObjectEdited(question, 'parentQuestionIds');
        markObjectEdited(logicMap.meta, 'scientificQuestions');
      });
      const parents = document.createElement('div');
      parents.className = 'question-link-grid';
      const availableParents = questions.slice(0, index);
      if (question.relationType === 'root' || !availableParents.length) {
        const empty = document.createElement('span');
        empty.className = 'empty-copy';
        empty.textContent = question.relationType === 'root'
          ? '总问题无需上游问题' : '当前没有可选择的上游问题';
        parents.appendChild(empty);
      } else availableParents.forEach(parentQuestion => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = (question.parentQuestionIds || [])
          .includes(parentQuestion.questionId);
        checkbox.addEventListener('change', () => {
          const current = new Set(question.parentQuestionIds || []);
          if (checkbox.checked) current.add(parentQuestion.questionId);
          else current.delete(parentQuestion.questionId);
          question.parentQuestionIds = [...current];
          markObjectEdited(question, 'parentQuestionIds');
          markObjectEdited(logicMap.meta, 'scientificQuestions');
          markChanged();
          scheduleCanvasRender();
        });
        label.append(
          checkbox,
          document.createTextNode(parentQuestion.text || parentQuestion.questionId)
        );
        parents.appendChild(label);
      });
      card.appendChild(parents);
      editorField(
        card,
        '支持 Figure（用逗号分隔）',
        (question.supportingFigureIds || []).join(', '),
        value => {
          question.supportingFigureIds = [...new Set(
            value.split(/[,，、;；\s]+/u).map(item => item.trim()).filter(Boolean)
          )];
          markObjectEdited(question, 'supportingFigureIds');
          markObjectEdited(logicMap.meta, 'scientificQuestions');
        },
        { multiline: false, maxLength: 1200 }
      );
      section.appendChild(card);
    });
    section.appendChild(button('＋ 添加科学问题', () => {
      const previous = questions.at(-1);
      questions.push({
        questionId: uid('question'), text: '',
        relationType: previous ? 'progressive' : 'root',
        parentQuestionIds: previous ? [previous.questionId] : [],
        supportingFigureIds: []
      });
      markObjectEdited(logicMap.meta, 'scientificQuestions');
      markChanged();
      render();
    }, { className: 'editor-add' }));
    body.appendChild(section);
  }

  function renderStepQuestionEditor(body, step) {
    const index = logicMap.steps.indexOf(step);
    const actions = [
      button('↑', () => moveStep(index, index - 1), { title: '上移' }),
      button('↓', () => moveStep(index, index + 1), { title: '下移' }),
      button('原文', () => void jumpToSource(step)),
      button('删除', () => deleteStep(step.stepId), { className: 'danger' })
    ];
    const section = editorSection(`${step.figureLabel} · 要解决的问题`, actions);
    editorField(section, 'Figure 名称', step.figureLabel, value => {
      step.figureLabel = value; markObjectEdited(step, 'figureLabel');
    }, { multiline: false, maxLength: 160 });
    editorList(section, step.questionItems, {
      addLabel: '添加问题要点', create: () => ({ itemId: uid(`${step.stepId}-question`), text: '' }),
      onChange: () => markObjectEdited(step, 'questionItems')
    });
    section.appendChild(button('＋ 添加证据组', () => {
      step.evidenceGroups.push(createEvidenceGroup(step.stepId, step.evidenceGroups.length));
      markObjectEdited(step, 'evidenceGroups');
      selection = { kind: 'evidence-group', stepId: step.stepId,
        groupId: step.evidenceGroups.at(-1).groupId };
      markChanged(); render();
    }, { className: 'editor-add' }));
    body.appendChild(section);
  }

  function renderStepProofEditor(body, step) {
    const section = editorSection(`${step.figureLabel} · 本图证明`);
    editorList(section, step.proofItems, {
      addLabel: '添加本图结论', create: () => ({ itemId: uid(`${step.stepId}-proof`), text: '' }),
      onChange: () => markObjectEdited(step, 'proofItems')
    });
    editorField(section, '论证角色', step.role, value => {
      step.role = value; markObjectEdited(step, 'role');
    }, { multiline: false, maxLength: 160 });
    editorField(section, '证据等级', step.evidenceLevel, value => {
      step.evidenceLevel = value; markObjectEdited(step, 'evidenceLevel');
    }, { multiline: false, maxLength: 160 });
    editorField(section, '个人备注', step.notes, value => {
      step.notes = value; markObjectEdited(step, 'notes');
    }, { rows: 3 });
    body.appendChild(section);
  }

  function createEvidencePoint(groupId) {
    return {
      pointId: uid(`${groupId}-point`), locator: { kind: 'panels', values: [] },
      observation: '', argumentRole: '', limitation: '', sourceRefs: []
    };
  }
  function resetPointLocatorProvenance(point) {
    point.sourceRefs = [];
    markObjectEdited(point, 'sourceRefs');
  }
  function createEvidenceGroup(ownerId, index) {
    const groupId = uid(`${ownerId}-evidence`);
    return {
      groupId, title: `证据组 ${index + 1}`, method: '', groupConclusion: '', limitation: '',
      evidencePoints: [createEvidencePoint(groupId)]
    };
  }

  function renderEvidencePointEditor(section, group, point, index) {
    const box = document.createElement('div');
    box.className = 'evidence-point-editor';
    const header = document.createElement('header');
    header.append(document.createTextNode(`证据点 ${index + 1}`),
      button('删除', () => {
        group.evidencePoints.splice(index, 1);
        markObjectEdited(group, 'evidencePoints');
        markChanged(); render();
      }, { className: 'danger' }));
    box.appendChild(header);
    if (point.needsManualSplit) {
      const warning = document.createElement('div');
      warning.className = 'evidence-split-warning';
      const copy = document.createElement('span');
      copy.textContent = '此点来自旧版组合证据，请确认 Panel、观察结果和论证作用是否需要拆分。';
      warning.append(copy, button('已核对', () => {
        point.needsManualSplit = false;
        point.humanReviewed = true;
        markChanged(); render();
      }));
      box.appendChild(warning);
    }
    editorSelect(box, '定位类型', point.locator?.kind || 'panels', [
      ['panels', 'Figure panel'], ['time-range', '视频时间段'], ['table-range', '表格范围']
    ], value => {
      point.locator = value === 'time-range'
        ? { kind: value, startSeconds: 0, endSeconds: 0 }
        : value === 'table-range' ? { kind: value, value: '' } : { kind: value, values: [] };
      resetPointLocatorProvenance(point);
      markObjectEdited(point, 'locator');
    });
    if (point.locator?.kind === 'time-range') {
      editorField(box, '开始秒数', String(point.locator.startSeconds || 0), value => {
        point.locator.startSeconds = Math.max(0, Number(value) || 0);
        resetPointLocatorProvenance(point); markObjectEdited(point, 'locator');
      }, { multiline: false });
      editorField(box, '结束秒数', String(point.locator.endSeconds || 0), value => {
        point.locator.endSeconds = Math.max(point.locator.startSeconds, Number(value) || 0);
        resetPointLocatorProvenance(point); markObjectEdited(point, 'locator');
      }, { multiline: false });
    } else if (point.locator?.kind === 'table-range') {
      editorField(box, '表格范围', point.locator.value, value => {
        point.locator.value = value;
        resetPointLocatorProvenance(point); markObjectEdited(point, 'locator');
      }, { multiline: false, placeholder: '例如：Table S2, rows 3–8' });
    } else {
      editorField(box, 'Panel（用逗号分隔）', (point.locator?.values || []).join('、'), value => {
        point.locator = { kind: 'panels', values: value.split(/[、，,\s]+/u).map(text).filter(Boolean).slice(0, 30) };
        resetPointLocatorProvenance(point); markObjectEdited(point, 'locator');
      }, { multiline: false, placeholder: 'A、B、C' });
    }
    editorField(box, '观察结果', point.observation, value => {
      point.observation = value; markObjectEdited(point, 'observation');
    }, { rows: 3 });
    editorField(box, '该证据点的论证作用', point.argumentRole, value => {
      point.argumentRole = value; markObjectEdited(point, 'argumentRole');
    }, { multiline: false });
    editorField(box, '证据边界 / 局限', point.limitation, value => {
      point.limitation = value; markObjectEdited(point, 'limitation');
    }, { rows: 2 });
    section.appendChild(box);
  }

  function renderEvidenceGroupEditor(body, step, group) {
    const section = editorSection(`${step.figureLabel} · ${group.title || '证据组'}`, [
      button('删除组', () => {
        step.evidenceGroups = step.evidenceGroups.filter(item => item.groupId !== group.groupId);
        logicMap.supplementalMaterials.forEach(item => {
          item.connections = (item.connections || []).filter(connection => !(
            connection.mode === 'evidence-group' &&
            connection.targetStepId === step.stepId &&
            connection.targetGroupId === group.groupId
          ));
        });
        selection = { kind: 'step-proof', stepId: step.stepId };
        markObjectEdited(step, 'evidenceGroups'); markChanged(); render();
      }, { className: 'danger' })
    ]);
    editorField(section, '证据组名称', group.title, value => {
      group.title = value; markObjectEdited(group, 'title');
    }, { multiline: false });
    editorField(section, '方法', group.method, value => {
      group.method = value; markObjectEdited(group, 'method');
    }, { multiline: false });
    editorField(section, '证据组共同支持', group.groupConclusion, value => {
      group.groupConclusion = value; markObjectEdited(group, 'groupConclusion');
    }, { rows: 3 });
    editorField(section, '组级局限', group.limitation, value => {
      group.limitation = value; markObjectEdited(group, 'limitation');
    }, { rows: 2 });
    group.evidencePoints.forEach((point, index) => renderEvidencePointEditor(section, group, point, index));
    section.appendChild(button('＋ 添加证据点', () => {
      group.evidencePoints.push(createEvidencePoint(group.groupId));
      markObjectEdited(group, 'evidencePoints'); markChanged(); render();
    }, { className: 'editor-add' }));
    body.appendChild(section);
  }

  function renderFinalEditor(body) {
    const container = editorSection('最终结论及其对应科学问题');
    logicMap.meta.finalConclusions.forEach((conclusion, index) => {
      const section = document.createElement('div');
      section.className = 'evidence-point-editor';
      const header = document.createElement('header');
      header.append(document.createTextNode(`结论 ${index + 1}`), button('删除', () => {
        logicMap.meta.finalConclusions.splice(index, 1);
        markObjectEdited(logicMap.meta, 'finalConclusions'); markChanged(); render();
      }, { className: 'danger' }));
      section.appendChild(header);
      editorField(section, '结论内容', conclusion.text, value => {
        conclusion.text = value; markObjectEdited(conclusion, 'text');
      }, { rows: 3 });
      const links = document.createElement('div');
      links.className = 'question-link-grid';
      logicMap.meta.scientificQuestions.forEach(question => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = conclusion.questionIds.includes(question.questionId);
        checkbox.addEventListener('change', () => {
          conclusion.questionIds = checkbox.checked
            ? [...new Set([...conclusion.questionIds, question.questionId])]
            : conclusion.questionIds.filter(id => id !== question.questionId);
          markObjectEdited(conclusion, 'questionIds'); markChanged(); scheduleCanvasRender();
        });
        label.append(checkbox, document.createTextNode(question.text || '未命名科学问题'));
        links.appendChild(label);
      });
      section.appendChild(links);
      container.appendChild(section);
    });
    container.appendChild(button('＋ 添加最终结论', () => {
      logicMap.meta.finalConclusions.push({
        conclusionId: uid('conclusion'), text: '', questionIds: []
      });
      markObjectEdited(logicMap.meta, 'finalConclusions'); markChanged(); render();
    }, { className: 'editor-add' }));
    body.appendChild(container);
  }

  function optionListForSteps() {
    return [['', '暂不连接'], ...logicMap.steps.map(step => [step.stepId, step.figureLabel])];
  }
  function optionListForAllGroups() {
    return [['', '暂不连接'], ...logicMap.steps.flatMap(step =>
      step.evidenceGroups.map(group => [
        `${step.stepId}::${group.groupId}`, `${step.figureLabel} · ${group.title}`
      ]))];
  }

  function renderSupplementalEditor(body, item) {
    const section = editorSection(`${supplementalTypeLabel(item.type)} · ${item.label}`, [
      button('删除', () => deleteSupplemental(item.supplementalId), { className: 'danger' })
    ]);
    editorSelect(section, '材料类型', item.type, [
      ['figure', '补充图'], ['video', '补充视频'], ['table', '补充表格']
    ], value => { item.type = value; markObjectEdited(item, 'type'); });
    editorField(section, '名称', item.label, value => {
      item.label = text(value, 240) ||
        `${supplementalTypeLabel(item.type)} ${logicMap.supplementalMaterials.indexOf(item) + 1}`;
      markObjectEdited(item, 'label');
    }, { multiline: false, maxLength: 240 });
    editorField(section, '折叠时显示的一句话功能', item.summary || '', value => {
      item.summary = text(value, 320); markObjectEdited(item, 'summary');
    }, { rows: 2, maxLength: 320 });
    editorList(section, item.proofItems, {
      addLabel: '添加该材料证明的结论',
      create: () => ({ itemId: uid(`${item.supplementalId}-proof`), text: '' }),
      onChange: () => markObjectEdited(item, 'proofItems')
    });
    editorSelect(section, '整图中心连接到主 Figure', figureConnection(item)?.targetStepId || '',
      optionListForSteps(), value => setFigureConnection(item, value));
    item.evidenceGroups.forEach((group, index) => {
      const row = document.createElement('div');
      row.className = 'evidence-point-editor';
      const header = document.createElement('header');
      header.append(document.createTextNode(group.title || `证据组 ${index + 1}`),
        button('编辑', () => setSelection('supplemental-group', {
          supplementalId: item.supplementalId, groupId: group.groupId
        })));
      row.appendChild(header);
      section.appendChild(row);
    });
    section.appendChild(button('＋ 添加补充证据组', () => {
      const group = createEvidenceGroup(item.supplementalId, item.evidenceGroups.length);
      item.evidenceGroups.push(group);
      markObjectEdited(item, 'evidenceGroups');
      selection = { kind: 'supplemental-group', supplementalId: item.supplementalId,
        groupId: group.groupId };
      markChanged(); render();
    }, { className: 'editor-add' }));
    body.appendChild(section);
  }

  function renderSupplementalGroupEditor(body, item, group) {
    const section = editorSection(`${item.label} · ${group.title}`, [
      button('返回整图', () => setSelection('supplemental', { supplementalId: item.supplementalId })),
      button('删除组', () => {
        item.evidenceGroups = item.evidenceGroups.filter(candidate => candidate.groupId !== group.groupId);
        item.connections = (item.connections || []).filter(connection =>
          connection.sourceGroupId !== group.groupId);
        selection = { kind: 'supplemental', supplementalId: item.supplementalId };
        markObjectEdited(item, 'evidenceGroups'); markChanged(); render();
      }, { className: 'danger' })
    ]);
    editorField(section, '证据组名称', group.title, value => {
      group.title = value; markObjectEdited(group, 'title');
    }, { multiline: false });
    editorField(section, '方法', group.method, value => {
      group.method = value; markObjectEdited(group, 'method');
    }, { multiline: false });
    editorField(section, '证据组共同支持', group.groupConclusion, value => {
      group.groupConclusion = value; markObjectEdited(group, 'groupConclusion');
    }, { rows: 3 });
    editorField(section, '组级局限', group.limitation, value => {
      group.limitation = value; markObjectEdited(group, 'limitation');
    }, { rows: 2 });
    const currentConnection = groupConnection(item, group.groupId);
    const currentTarget = currentConnection
      ? `${currentConnection.targetStepId}::${currentConnection.targetGroupId}` : '';
    editorSelect(section, '组中心连接到主图证据组', currentTarget,
      optionListForAllGroups(), value => {
        const [targetStepId = '', targetGroupId = ''] = value.split('::');
        setGroupConnection(item, group.groupId, targetStepId, targetGroupId);
      });
    group.evidencePoints.forEach((point, index) => renderEvidencePointEditor(section, group, point, index));
    section.appendChild(button('＋ 添加证据点', () => {
      group.evidencePoints.push(createEvidencePoint(group.groupId));
      markObjectEdited(group, 'evidencePoints'); markChanged(); render();
    }, { className: 'editor-add' }));
    body.appendChild(section);
  }

  function renderMechanismEditor(body) {
    const section = editorSection('机制链（信号通路规范）');
    logicMap.meta.mechanismEdges.forEach((edge, index) => {
      const box = document.createElement('div');
      box.className = 'evidence-point-editor';
      const header = document.createElement('header');
      header.append(document.createTextNode(`连接 ${index + 1}`), button('删除', () => {
        logicMap.meta.mechanismEdges.splice(index, 1);
        synchronizeMechanismChain();
        markObjectEdited(logicMap.meta, 'mechanismEdges'); markChanged(); render();
      }, { className: 'danger' }));
      box.appendChild(header);
      editorField(box, '起点', edge.sourceId, value => {
        edge.sourceId = value; synchronizeMechanismChain();
        markObjectEdited(edge, 'sourceId');
      }, { multiline: false });
      editorField(box, '终点', edge.targetId, value => {
        edge.targetId = value; synchronizeMechanismChain();
        markObjectEdited(edge, 'targetId');
      }, { multiline: false });
      editorSelect(box, '作用类型', edge.effect, [
        ['promote', '正向 / 促进（箭头）'], ['inhibit', '负向 / 抑制（T 形末端）'],
        ['associate', '相关性 / 方向不确定']
      ], value => {
        edge.effect = value; synchronizeMechanismChain();
        markObjectEdited(edge, 'effect');
      });
      editorSelect(box, '证据强度', edge.evidence, [
        ['strong', '强证据（实线）'], ['weak', '弱证据（虚线）']
      ], value => { edge.evidence = value; markObjectEdited(edge, 'evidence'); });
      editorField(box, '支持 Panel（用逗号分隔）', (edge.supportPanels || []).join('、'), value => {
        edge.supportPanels = value.split(/[、，,\s]+/u).map(text).filter(Boolean).slice(0, 24);
        markObjectEdited(edge, 'supportPanels');
      }, { multiline: false });
      section.appendChild(box);
    });
    section.appendChild(button('＋ 添加机制连接', () => {
      logicMap.meta.mechanismEdges.push({
        sourceId: '', targetId: '', effect: 'associate', evidence: 'weak', supportPanels: []
      });
      synchronizeMechanismChain();
      markObjectEdited(logicMap.meta, 'mechanismEdges'); markChanged(); render();
    }, { className: 'editor-add' }));
    body.appendChild(section);
  }

  function renderBoundaryEditor(body) {
    const section = editorSection('结论边界');
    editorField(section, '哪些结论尚不能外推？', logicMap.meta.claimBoundary, value => {
      logicMap.meta.claimBoundary = value; markObjectEdited(logicMap.meta, 'claimBoundary');
    }, { rows: 6 });
    body.appendChild(section);
  }

  function renderInspector() {
    const body = byId('logicMapEditorBody');
    const label = byId('logicMapEditorSelection');
    body.replaceChildren();
    const labels = {
      background: '已选中：已知背景', scientific: '已选中：科学问题',
      'step-question': '已选中：Figure 要解决的问题',
      'step-proof': '已选中：本图证明', 'evidence-group': '已选中：主图证据组',
      final: '已选中：最终结论', supplemental: '已选中：补充材料',
      'supplemental-group': '已选中：补充证据组', mechanism: '已选中：机制链',
      boundary: '已选中：结论边界'
    };
    label.textContent = labels[selection.kind] || '请选择右侧内容模块';
    if (selection.kind === 'background') renderBackgroundEditor(body);
    else if (selection.kind === 'scientific') renderScientificEditor(body);
    else if (selection.kind === 'final') renderFinalEditor(body);
    else if (selection.kind === 'mechanism') renderMechanismEditor(body);
    else if (selection.kind === 'boundary') renderBoundaryEditor(body);
    else if (selection.kind === 'step-question' && selectedStep()) renderStepQuestionEditor(body, selectedStep());
    else if (selection.kind === 'step-proof' && selectedStep()) renderStepProofEditor(body, selectedStep());
    else if (selection.kind === 'evidence-group') {
      const step = selectedStep();
      const group = step?.evidenceGroups.find(item => item.groupId === selection.groupId);
      if (step && group) renderEvidenceGroupEditor(body, step, group);
    } else if (selection.kind === 'supplemental' && selectedSupplemental()) {
      renderSupplementalEditor(body, selectedSupplemental());
    } else if (selection.kind === 'supplemental-group') {
      const item = selectedSupplemental();
      const group = item?.evidenceGroups.find(candidate => candidate.groupId === selection.groupId);
      if (item && group) renderSupplementalGroupEditor(body, item, group);
    }
    if (!body.childElementCount) {
      selection = { kind: 'background' };
      renderBackgroundEditor(body);
    }
  }

  function render() {
    if (!logicMap) return;
    renderCanvas();
    renderInspector();
  }
  function scheduleCanvasRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderCanvas, 100);
  }

  function toggleStepCollapsed(stepId) {
    const set = new Set(logicMap.view.collapsedStepIds);
    if (set.has(stepId)) set.delete(stepId); else set.add(stepId);
    logicMap.view.collapsedStepIds = [...set];
    markObjectEdited(logicMap, 'view'); markChanged(); render();
  }
  function toggleSupplementalCollapsed(supplementalId) {
    const set = new Set(logicMap.view.collapsedSupplementalIds);
    if (set.has(supplementalId)) set.delete(supplementalId); else set.add(supplementalId);
    logicMap.view.collapsedSupplementalIds = [...set];
    markObjectEdited(logicMap, 'view'); markChanged(); render();
  }
  function toggleAllFigures() {
    const allMainCollapsed = logicMap.steps.length && logicMap.steps.every(step =>
      logicMap.view.collapsedStepIds.includes(step.stepId));
    const allSupplementalCollapsed = logicMap.supplementalMaterials.every(item =>
      logicMap.view.collapsedSupplementalIds.includes(item.supplementalId));
    const allCollapsed = allMainCollapsed && allSupplementalCollapsed;
    logicMap.view.collapsedStepIds = allCollapsed ? [] : logicMap.steps.map(step => step.stepId);
    logicMap.view.collapsedSupplementalIds = allCollapsed ? []
      : logicMap.supplementalMaterials.map(item => item.supplementalId);
    markObjectEdited(logicMap, 'view'); markChanged(); render();
  }
  function toggleEditor() {
    logicMap.view.editorCollapsed = !logicMap.view.editorCollapsed;
    markObjectEdited(logicMap, 'view'); markChanged(); renderCanvas();
  }

  function rebuildLinks() {
    logicMap.steps.forEach((step, index) => { step.order = index + 1; });
    const validStepIds = new Set(logicMap.steps.map(step => step.stepId));
    const preserved = (Array.isArray(logicMap.links) ? logicMap.links : [])
      .filter(link => validStepIds.has(link.fromStepId) &&
        validStepIds.has(link.toStepId));
    const existing = new Map(preserved.map(link => [
      `${link.fromStepId}:${link.toStepId}`, link
    ]));
    logicMap.steps.slice(0, -1).forEach((step, index) => {
      const next = logicMap.steps[index + 1];
      const key = `${step.stepId}:${next.stepId}`;
      if (!existing.has(key)) {
        const link = {
          fromStepId: step.stepId, toStepId: next.stepId,
          label: '因此下一图需要回答', boundary: ''
        };
        preserved.push(link);
        existing.set(key, link);
      }
    });
    logicMap.links = preserved;
  }
  function addStep() {
    const stepId = uid('step');
    logicMap.steps.push({
      stepId, order: logicMap.steps.length + 1, figureId: '',
      figureLabel: `Figure ${logicMap.steps.length + 1}`, questionItems: [], proofItems: [],
      role: '', evidenceLevel: '', evidenceGroups: [], notes: ''
    });
    rebuildLinks();
    selection = { kind: 'step-question', stepId };
    markObjectEdited(logicMap, 'steps'); markChanged(); render();
  }
  function moveStep(from, to) {
    if (from < 0 || to < 0 || from >= logicMap.steps.length || to >= logicMap.steps.length) return;
    const [step] = logicMap.steps.splice(from, 1);
    logicMap.steps.splice(to, 0, step);
    rebuildLinks(); markObjectEdited(logicMap, 'steps'); markChanged(); render();
  }
  function deleteStep(stepId) {
    if (logicMap.steps.length <= 1) return;
    const index = logicMap.steps.findIndex(step => step.stepId === stepId);
    if (index < 0) return;
    logicMap.steps.splice(index, 1);
    logicMap.supplementalMaterials.forEach(item => {
      item.connections = (item.connections || []).filter(connection =>
        connection.targetStepId !== stepId);
    });
    rebuildLinks();
    selection = { kind: 'step-question', stepId: logicMap.steps[Math.min(index, logicMap.steps.length - 1)].stepId };
    markObjectEdited(logicMap, 'steps'); markChanged(); render();
  }
  function addSupplemental(type) {
    const supplementalId = uid('supplemental');
    logicMap.supplementalMaterials.push({
      supplementalId, type, label: `${supplementalTypeLabel(type)} ${logicMap.supplementalMaterials.length + 1}`,
      summary: '', proofItems: [], evidenceGroups: [],
      connections: logicMap.steps[0] ? [{
        connectionId: uid(`${supplementalId}-figure-link`), mode: 'figure',
        targetStepId: logicMap.steps[0].stepId, sourceGroupId: '', targetGroupId: ''
      }] : [],
      manuallyEdited: true, manuallyEditedFields: ['type', 'label', 'summary', 'connections']
    });
    selection = { kind: 'supplemental', supplementalId };
    markObjectEdited(logicMap, 'supplementalMaterials'); markChanged(); render();
  }
  function deleteSupplemental(supplementalId) {
    logicMap.supplementalMaterials = logicMap.supplementalMaterials.filter(item =>
      item.supplementalId !== supplementalId);
    logicMap.view.collapsedSupplementalIds = logicMap.view.collapsedSupplementalIds.filter(id =>
      id !== supplementalId);
    selection = { kind: 'background' };
    markObjectEdited(logicMap, 'supplementalMaterials'); markChanged(); render();
  }

  async function jumpToSource(step = selectedStep()) {
    if (!Number.isInteger(sourceTabId) || !step?.figureId) return;
    const response = await chrome.tabs.sendMessage(sourceTabId, {
      action: 'focusArticleWorkspaceSource', target: { kind: 'figure', figureId: step.figureId }
    }).catch(() => null);
    await chrome.tabs.update(sourceTabId, { active: true }).catch(() => null);
    if (!response?.focused) setSaveStatus('error', '原文 Figure 暂时无法定位；请刷新原文页面后重试');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportName(extension) {
    const name = String(logicMap.meta.title || '论文论证地图')
      .replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    return `${name}.${extension}`;
  }
  function exportJson() {
    downloadBlob(new Blob([JSON.stringify(normalize(logicMap), null, 2)], {
      type: 'application/json;charset=utf-8'
    }), exportName('json'));
  }
  function exportSvg() {
    const svg = SciLLM.buildResearchLogicMapSvg(normalize(logicMap));
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), exportName('svg'));
  }
  async function exportPng() {
    const svg = SciLLM.buildResearchLogicMapSvg(normalize(logicMap));
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = reject; image.src = url;
      });
      const scale = Math.max(1, Math.min(2, 30000 / Math.max(1, image.naturalWidth),
        30000 / Math.max(1, image.naturalHeight)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext('2d');
      context.fillStyle = '#edf3f5';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (png) downloadBlob(png, exportName('png'));
    } finally { URL.revokeObjectURL(url); }
  }

  function updateFullscreenControl() {
    const active = fullscreenLayoutActive || Boolean(document.fullscreenElement);
    document.body.classList.toggle('logic-map-focus-mode', active);
    const control = byId('toggleLogicMapFullscreen');
    control.setAttribute('aria-pressed', String(active));
    control.querySelector('i').className = active ? 'ph ph-arrows-in' : 'ph ph-arrows-out';
    control.querySelector('span').textContent = active ? '退出全屏' : '全屏';
  }
  async function toggleFullscreenLayout() {
    const active = fullscreenLayoutActive || Boolean(document.fullscreenElement);
    if (active) {
      fullscreenLayoutActive = false;
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => undefined);
    } else {
      fullscreenLayoutActive = true;
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen().catch(() => undefined);
    }
    updateFullscreenControl();
  }

  async function reloadRemote() {
    const asset = await getAsset(mapPath);
    if (!asset?.content) return;
    logicMap = normalize(asset.content);
    remoteLogicMap = normalize(asset.content);
    assetRevision = Number(asset.revision) || 0;
    assetContentHash = String(asset.contentHash || '');
    selection = { kind: 'background' };
    clearDraft();
    byId('reloadLogicMapRemote').hidden = true;
    setSaveStatus('saved', '已载入工作区中的最新版本');
    render();
  }

  function createPreviewMap() {
    return normalize({
      schemaVersion: 3, mapId: 'preview-argument-map', origin: 'figure-analysis',
      workspaceId: 'preview-workspace', generatedAt: '2026-08-03T10:00:00.000Z',
      meta: {
        title: '科研逻辑图', articleTitle: '感觉神经元调控皮肤老化',
        backgroundItems: [
          { itemId: 'background-1', text: '皮肤老化伴随胶原流失和成纤维细胞功能下降。' },
          { itemId: 'background-2', text: '感觉神经元能够改变局部组织微环境。' }
        ],
        scientificQuestions: [{ questionId: 'question-1', text: '感觉神经元是否通过谷氨酸信号驱动皮肤老化？' }],
        finalConclusions: [{ conclusionId: 'conclusion-1',
          text: '神经元—谷氨酸—成纤维细胞轴驱动胶原流失，阻断该轴可缓解皮肤老化。',
          questionIds: ['question-1'] }],
        mechanismEdges: [
          { sourceId: '感觉神经元激活', targetId: '谷氨酸释放', effect: 'promote', evidence: 'strong', supportPanels: ['1A'] },
          { sourceId: '谷氨酸释放', targetId: '成纤维细胞衰老', effect: 'promote', evidence: 'strong', supportPanels: ['2D', '2E'] },
          { sourceId: '受体拮抗', targetId: '成纤维细胞衰老', effect: 'inhibit', evidence: 'weak', supportPanels: ['4D'] }
        ],
        claimBoundary: '结论主要来自小鼠模型，在人类皮肤中的因果性仍需验证。',
        updatedAt: '2026-08-03T10:00:00.000Z'
      },
      steps: [
        {
          stepId: 'step-1', figureId: 'figure-1', figureLabel: 'Figure 1',
          questionItems: [{ itemId: 's1-q1', text: '老化皮肤中的谷氨酸能感觉神经元是否被激活？' }],
          proofItems: [{ itemId: 's1-p1', text: '老化伴随谷氨酸能感觉神经元激活与谷氨酸释放。' }],
          role: '现象建立', evidenceLevel: '相关证据', evidenceGroups: [{
            groupId: 'main-g1', title: '神经激活与组织表型', method: '成像与组织学',
            groupConclusion: '神经激活与胶原下降同步出现。', evidencePoints: [
              { pointId: 'main-g1-p1', locator: { kind: 'panels', values: ['A', 'B'] },
                observation: 'Vglut2⁺神经活性升高，胶原含量下降。', argumentRole: '建立现象关联',
                limitation: '尚不能证明因果。', sourceRefs: [] }
            ]
          }]
        },
        {
          stepId: 'step-2', figureId: 'figure-2', figureLabel: 'Figure 2',
          questionItems: [{ itemId: 's2-q1', text: '谷氨酸是否直接诱导成纤维细胞衰老？' }],
          proofItems: [{ itemId: 's2-p1', text: '谷氨酸直接诱导成纤维细胞衰老。' }],
          role: '因果检验', evidenceLevel: '强证据', evidenceGroups: [{
            groupId: 'main-g2', title: '体外因果验证', method: '细胞处理',
            groupConclusion: '谷氨酸足以触发衰老程序。', evidencePoints: [
              { pointId: 'main-g2-p1', locator: { kind: 'panels', values: ['D', 'E'] },
                observation: 'p16/p21 上调并伴随增殖下降。', argumentRole: '验证充分性', limitation: '', sourceRefs: [] }
            ]
          }]
        }
      ],
      links: [{ fromStepId: 'step-1', toStepId: 'step-2', label: '因此下一图需要回答', boundary: '' }],
      supplementalMaterials: [{
        supplementalId: 'supplement-s2', type: 'figure', label: 'Figure S2',
        proofItems: [{ itemId: 'supp-s2-proof-1', text: '独立样本复现主图结论并补充稳健性。' }],
        evidenceGroups: [{
          groupId: 'supp-g1', title: '独立重复', groupConclusion: '替代定量方法得到一致结果。',
          evidencePoints: [{
            pointId: 'supp-g1-p1', locator: { kind: 'panels', values: ['A', 'B'] },
            observation: '独立队列复现 p16/p21 上调。', argumentRole: '稳健性验证', limitation: '', sourceRefs: []
          }]
        }],
        connections: [
          { connectionId: 'supp-s2-figure-link', mode: 'figure', targetStepId: 'step-2' },
          { connectionId: 'supp-s2-group-link', mode: 'evidence-group', targetStepId: 'step-2',
            sourceGroupId: 'supp-g1', targetGroupId: 'main-g2' }
        ]
      }],
      view: { zoom: 1, editorCollapsed: false, collapsedStepIds: [], collapsedSupplementalIds: [] }
    });
  }

  function handleCanvasSelection(event) {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if (event.target.closest('button, input, textarea, select')) return;
    const target = event.target.closest('[data-selection-kind]');
    if (!target) return;
    if (event.type === 'keydown') event.preventDefault();
    const data = {};
    if (target.dataset.stepId) data.stepId = target.dataset.stepId;
    if (target.dataset.groupId) data.groupId = target.dataset.groupId;
    if (target.dataset.supplementalId) data.supplementalId = target.dataset.supplementalId;
    setSelection(target.dataset.selectionKind, data);
  }

  function setupEvents() {
    byId('logicMapInspectorForm').addEventListener('submit', event => event.preventDefault());
    byId('logicMapCanvas').addEventListener('click', handleCanvasSelection);
    byId('logicMapCanvas').addEventListener('keydown', handleCanvasSelection);
    byId('toggleLogicMapEditor').addEventListener('click', toggleEditor);
    byId('collapseLogicMapEditor').addEventListener('click', toggleEditor);
    byId('collapseAllLogicMapFigures').addEventListener('click', toggleAllFigures);
    byId('addLogicMapStep').addEventListener('click', addStep);
    document.querySelectorAll('[data-add-supplemental]').forEach(control => {
      control.addEventListener('click', () => addSupplemental(control.dataset.addSupplemental));
    });
    byId('zoomOutLogicMap').addEventListener('click', () => {
      logicMap.view.zoom = Math.max(.6, Math.round((logicMap.view.zoom - .1) * 10) / 10);
      markChanged(); renderCanvas();
    });
    byId('zoomInLogicMap').addEventListener('click', () => {
      logicMap.view.zoom = Math.min(1.6, Math.round((logicMap.view.zoom + .1) * 10) / 10);
      markChanged(); renderCanvas();
    });
    byId('toggleLogicMapFullscreen').addEventListener('click', () => void toggleFullscreenLayout());
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) fullscreenLayoutActive = false;
      updateFullscreenControl();
    });
    addEventListener('resize', () => requestAnimationFrame(() => {
      drawSupplementalConnectors(); renderMechanism();
    }));
    byId('openLogicMapSource').addEventListener('click', () => {
      const step = selectedStep();
      if (step?.figureId) void jumpToSource(step);
      else if (Number.isInteger(sourceTabId)) void chrome.tabs.update(sourceTabId, { active: true });
    });
    byId('exportLogicMapJson').addEventListener('click', exportJson);
    byId('exportLogicMapSvg').addEventListener('click', exportSvg);
    byId('exportLogicMapPng').addEventListener('click', () => void exportPng());
    byId('retryLogicMapSave').addEventListener('click', () => void saveMap());
    byId('reloadLogicMapRemote').addEventListener('click', () => void reloadRemote());
    byId('restoreLogicMapDraft').addEventListener('click', () => {
      const draft = readDraft();
      if (!draft?.map) return;
      logicMap = normalize(draft.map);
      selection = { kind: 'background' };
      byId('logicMapRecovery').hidden = true;
      markChanged(); render();
    });
    byId('discardLogicMapDraft').addEventListener('click', () => {
      clearDraft(); byId('logicMapRecovery').hidden = true;
    });
    addEventListener('beforeunload', () => {
      if (saveTimer || saveInFlight) saveDraft();
    });
  }

  async function load() {
    if (previewMode) {
      logicMap = createPreviewMap();
      if (previewData) {
        const previewUrl = new URL(previewData, location.origin);
        if (previewUrl.origin !== location.origin) throw new Error('PREVIEW_DATA_MUST_BE_SAME_ORIGIN');
        const response = await fetch(previewUrl);
        if (!response.ok) throw new Error(`PREVIEW_DATA_LOAD_FAILED_${response.status}`);
        logicMap = normalize(await response.json());
      }
      remoteLogicMap = normalize(logicMap);
      setupEvents(); render();
      byId('logicMapApp').setAttribute('aria-busy', 'false');
      setSaveStatus('saved', '预览模式 · 已载入示例论证链');
      return;
    }
    if (!workspaceId || !mapId) throw new Error('论证地图链接缺少工作区信息');
    const asset = await getAsset(mapPath);
    if (!asset?.content) throw new Error('没有找到这张论文论证地图');
    logicMap = normalize(asset.content);
    remoteLogicMap = normalize(asset.content);
    assetRevision = Number(asset.revision) || 0;
    assetContentHash = String(asset.contentHash || '');
    const draft = readDraft();
    if (draft?.map) {
      const remoteChanged = Boolean(draft.remoteContentHash &&
        draft.remoteContentHash !== assetContentHash);
      const recovery = byId('logicMapRecovery');
      const message = recovery.querySelector('span');
      if (message) message.textContent = remoteChanged
        ? '远端版本已变化；本地草稿仍保留。请选择恢复草稿或使用远端版本。'
        : '发现尚未同步的本地草稿。';
      recovery.hidden = false;
    }
    setupEvents(); render();
    byId('logicMapApp').setAttribute('aria-busy', 'false');
    setSaveStatus('saved', '已安全保存到浏览器');
  }

  load().catch(error => {
    byId('logicMapApp').setAttribute('aria-busy', 'false');
    setSaveStatus('error', `载入失败：${error.message}`);
  });
})();
void globalThis.SciLLM?.bootstrapInterfaceLanguage?.();
