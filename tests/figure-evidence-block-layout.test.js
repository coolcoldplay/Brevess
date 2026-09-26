const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

function functionRegion(name, nextName) {
  const start = popup.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = popup.indexOf(`function ${nextName}`, start + 1);
  assert.ok(end > start, `${nextName} must follow ${name}`);
  return popup.slice(start, end);
}

function loadPaperQuestionResolver() {
  const source = functionRegion(
    'resolveFigureEvidencePaperQuestion', 'resolveFigureEvidenceUpstreamContext'
  );
  return new Function(`${source}\nreturn resolveFigureEvidencePaperQuestion;`)();
}

function loadUpstreamContextResolver() {
  const source = functionRegion(
    'resolveFigureEvidenceUpstreamContext', 'createFigureEvidencePanelsDetails'
  );
  return new Function(`${source}\nreturn resolveFigureEvidenceUpstreamContext;`)();
}

test('Figure fields expose only direct mouse and keyboard editing affordances', () => {
  const field = functionRegion(
    'appendFigureWorkspaceViewField', 'appendFigureWorkspaceOverview'
  );
  assert.match(field, /addEventListener\('dblclick'/);
  assert.match(field, /event\.key === 'Enter'/);
  assert.match(field, /event\.key === ' '/);
  assert.match(field, /aria-keyshortcuts', 'Enter Space'/);
  assert.doesNotMatch(field, /workspace-figure-edit-button|editButton|>编辑</);
  assert.doesNotMatch(css, /\.workspace-figure-edit-button/);
});

test('Figure 1 upstream question prefers reviewed metadata and reads saved note fields', () => {
  const resolve = loadPaperQuestionResolver();
  const reviewed = resolve({
    draft: { meta: {
      scientificQuestions: [
        { value: 'Generated root?', relationType: 'root' },
        { value: 'Reviewed paper question?', humanReviewed: true }
      ]
    } },
    noteState: {
      templateId: 'basic_research',
      valuesByTemplate: { basic_research: { scientific_questions: 'Note question?' } }
    },
    noteTemplates: [{
      id: 'basic_research',
      fields: [{ id: 'scientific_questions', label: '科学问题与逻辑子问题' }]
    }]
  });
  assert.deepEqual(reviewed, {
    value: 'Reviewed paper question?',
    source: '已保存的人工复核全文问题',
    missing: false
  });

  const note = resolve({
    noteState: {
      templateId: 'custom',
      valuesByTemplate: { custom: { research_question: 'Saved note question?' } }
    },
    noteTemplates: [{
      id: 'custom', fields: [{ id: 'research_question', label: '研究问题' }]
    }]
  });
  assert.deepEqual(note, {
    value: 'Saved note question?', source: '文献笔记', missing: false
  });
  const customCaseSensitiveId = resolve({
    noteState: {
      templateId: 'custom',
      valuesByTemplate: { custom: { ResearchQuestion: 'Case-sensitive saved question?' } }
    },
    noteTemplates: [{
      id: 'custom', fields: [{ id: 'ResearchQuestion', label: '研究问题' }]
    }]
  });
  assert.deepEqual(customCaseSensitiveId, {
    value: 'Case-sensitive saved question?', source: '文献笔记', missing: false
  });
  assert.deepEqual(resolve(), {
    value: '文章科学问题尚未取得', source: '', missing: true
  });
});

test('legacy evidence blocks derive one cautious upstream sentence without losing saved text', () => {
  const resolve = loadUpstreamContextResolver();
  assert.deepEqual(resolve({ upstreamContext: '人工承上第一句。第二句仍保存在草稿。' }), {
    value: '人工承上第一句。', missing: false, source: 'saved'
  });
  assert.deepEqual(resolve({ groupGoal: '检验激酶 K 的必要性' }, {
    previousBlock: { id: 'block-a', handoff: 'K 是否为表型 P 所必需？' },
    incomingTransitions: [{
      fromBlockId: 'non-adjacent', transitionToNext: '不应误用的跨块连接'
    }]
  }), {
    value: '针对前序留下的“K 是否为表型 P 所必需”，本证据块聚焦“检验激酶 K 的必要性”。',
    missing: false,
    source: 'previous-handoff'
  });
  const first = resolve({ groupGoal: '观察表型 P' }, {
    paperQuestion: { value: '受体 R 是否驱动表型 P？', source: '文献笔记', missing: false }
  });
  assert.match(first.value, /^围绕论文科学问题“受体 R 是否驱动表型 P”/u);
  assert.equal(first.source, '文献笔记');
  const firstWithSaved = resolve({
    upstreamContext: 'Figure 1 先确认表型。第二句仍保留。', groupGoal: '观察表型 P'
  }, {
    paperQuestion: { value: '受体 R 是否驱动表型 P？', source: '全文元数据', missing: false }
  });
  assert.equal(firstWithSaved.value, 'Figure 1 先确认表型。');
  assert.equal(resolve({ upstreamContext: '围绕论文问题，本块检验受体作用。' }, {
    paperQuestion: { missing: true }
  }).value, '围绕论文问题,本块检验受体作用。');
  assert.equal(resolve({}, { previousBlock: {} }).missing, true);
});

test('evidence blocks show one editable upstream row and direct Panel descendants', () => {
  const block = functionRegion(
    'createFigureEvidenceBlockDetails', 'canonicalFigurePanelOrder'
  );
  const catalog = functionRegion(
    'appendFigurePanelCatalog', 'createCollapsibleFigureResultSection'
  );
  assert.match(block, /'承上'/);
  assert.match(block, /'upstreamContext'/);
  assert.match(block, /resolveFigureEvidenceUpstreamContext/);
  assert.doesNotMatch(block, /'启下'|is-downstream|上一块目标|上一块结论|前序衔接|逻辑关系/);
  assert.match(block, /createFigureEvidencePanelsDetails/);
  assert.match(catalog, /resolveFigureEvidencePaperQuestion/);
  assert.match(catalog, /figureKeyboardNumber\(figure\) === 1/);
  assert.match(catalog, /SciLLM\.buildFigureEvidenceDisplayLayout/);
  assert.match(catalog, /hasStoredEvidenceGroups/);
  assert.match(catalog, /panelHostByBlock/);
  assert.match(catalog, /blockDetails\.querySelector\('\[data-evidence-panels-body/);
  assert.match(catalog, /\(panelHost \|\| parent\)\.appendChild\(panelDetails\)/);
  assert.match(catalog, /'待确认分组'/);
  assert.match(catalog, /!hasStoredEvidenceGroups && analyzed/);
  assert.doesNotMatch(catalog, /standaloneAfterBlock|createFigureEvidenceTransitionDetails\(/);
  assert.match(catalog, /const panelHost = evidenceBlock\s*\?[^:]+:\s*ensureOrphanPanelHost\(\)/s);
  assert.doesNotMatch(popup, /workspace-evidence-transition-fields|is-downstream|启下/);
});

test('opening an evidence block exposes the Panel list without a second details toggle', () => {
  const source=functionRegion('createFigureEvidencePanelsDetails','createFigureEvidenceBlockDetails');
  const createWorkspaceElement=(tagName,className,textContent='')=>({tagName,className,textContent,dataset:{},children:[],appendChild(child){this.children.push(child);},setAttribute(){}});
  const create=new Function('createWorkspaceElement','bindFigureEvidenceExpansion','bindFigureEvidenceEditFlush',`${source};return createFigureEvidencePanelsDetails;`)(createWorkspaceElement,()=>{},element=>element);
  const list=create('figure-1',{id:'block-1',panelIds:['A','B']},2);
  assert.equal(list.tagName,'div');
  assert.equal(list.dataset.evidencePanelsBody,'true');
  assert.equal(list.children.some(child=>child.tagName==='summary'||child.tagName==='details'),false);
});

function loadEvidenceBlockRenderer() {
  const createWorkspaceElement = (tagName, className, textContent = '') => ({
    tagName, className, textContent, dataset: {}, children: [],
    classList: { toggle() {} },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {}, addEventListener() {},
    set innerHTML(_value) { throw new Error('Evidence summary must use plain text'); }
  });
  const sources = [
    functionRegion('summarizeFigureEvidenceLabel', 'appendFigureEvidenceEditableField'),
    functionRegion('bindFigureEvidenceExpansion', 'summarizeFigureEvidenceLabel'),
    functionRegion('bindFigureEvidenceEditFlush', 'resolveFigureEvidencePaperQuestion'),
    functionRegion('resolveFigureEvidenceUpstreamContext', 'createFigureEvidencePanelsDetails'),
    functionRegion('createFigureEvidencePanelsDetails', 'createFigureEvidenceBlockDetails'),
    functionRegion('createFigureEvidenceBlockDetails', 'canonicalFigurePanelOrder')
  ].join('\n');
  return new Function('createWorkspaceElement', 'appendFigureEvidenceEditableField',
    'figureEvidenceExpansionState', `${sources}\nreturn createFigureEvidenceBlockDetails;`
  )(createWorkspaceElement, () => {}, new Map());
}

function evidenceSummaryPanels(details) {
  const summary = details.children.find(child => child.tagName === 'summary');
  return summary.children.find(child => child.className === 'workspace-evidence-block-panels');
}

test('collapsed evidence summary identifies only its own Panels without changing stored IDs', () => {
  const render = loadEvidenceBlockRenderer();
  const panelIds = Object.freeze(['A', 'B']);
  const first = render('figure-1', { id: 'block-1', panelIds }, 0, {
    panelCount: 2, previousBlock: { id: 'previous', panelIds: ['X'] }
  });
  const second = render('figure-1', { id: 'block-2', panelIds: ['C'] }, 1, { panelCount: 1 });
  assert.equal(first.open, false);
  assert.equal(first.children[0].tagName, 'summary');
  assert.equal(evidenceSummaryPanels(first)?.textContent, '证据块1：AB');
  assert.equal(evidenceSummaryPanels(second)?.textContent, '证据块2：C');
  assert.deepEqual(panelIds, ['A', 'B']);
  assert.equal(evidenceSummaryPanels(first).tagName, 'span');
});

test('evidence summary does not invent Panel labels for empty IDs or bridge entries', () => {
  const render = loadEvidenceBlockRenderer();
  for (const block of [
    { id: 'empty', panelIds: [] }, { id: 'missing' },
    { id: 'blank', panelIds: ['', ' '] },
    { id: 'bridge', sourceType: 'bridge', panelIds: ['A', 'B'] }
  ]) {
    assert.equal(evidenceSummaryPanels(render('figure-1', block, 0, { panelCount: 12 })), undefined);
  }
});

test('evidence summary keeps a long Panel list readable without duplicating or truncating IDs', () => {
  const render = loadEvidenceBlockRenderer();
  const ids = 'ABCDEFGHIJKLMNOP'.split('');
  const details = render('figure-1', { id: 'large', panelIds: [' A ', ...ids] }, 0);
  assert.equal(evidenceSummaryPanels(details)?.textContent, `证据块1：${ids.join('')}`);
});

test('Panel summary labels are literal text, never parsed markup or interactive controls', () => {
  const render = loadEvidenceBlockRenderer();
  const label = '<img src=x onerror=alert(1)>';
  const details = render('figure-1', { id: 'literal', panelIds: [label] }, 0);
  const panels = evidenceSummaryPanels(details);
  assert.equal(panels?.textContent, `证据块1：${label}`);
  assert.equal(panels.tagName, 'span');
  assert.deepEqual(panels.children, []);
});

test('evidence heading separates multi-character members and keeps its conclusion on a second line', () => {
  const render = loadEvidenceBlockRenderer();
  const details = render('figure-1', { id: 'multi', panelIds: ['A1', 'A2'],
    groupGoal: '观察时间过程', groupConclusion: 'D2 增强；D4–D8 减弱；D10 恢复。' }, 0);
  assert.equal(evidenceSummaryPanels(details).textContent, '证据块1：A1 · A2');
  assert.equal(details.children[0].children.find(child => child.className ===
    'workspace-evidence-block-description')?.textContent, 'D2 增强;D4–D8 减弱;D10 恢复。');
  assert.equal(evidenceSummaryPanels(render('figure-1', { id: 'sparse', panelIds: ['A', 'C'] }, 0)).textContent,
    '证据块1：AC');
});

test('upstream display value is separate from the full saved editor value', () => {
  const generic = functionRegion(
    'appendFigureWorkspaceViewField', 'appendFigureWorkspaceOverview'
  );
  const evidence = functionRegion(
    'appendFigureEvidenceEditableField', 'bindFigureEvidenceEditFlush'
  );
  assert.match(generic, /hasOwnProperty\.call\(field \|\| \{\}, 'editValue'\)/);
  assert.match(generic, /Array\.isArray\(editValue\)/);
  assert.match(evidence, /editValue:[\s\S]*sourceValue/);
});

test('a cleared evidence summary does not silently adopt its transition as the conclusion', () => {
  const details = loadEvidenceBlockRenderer()('figure-1', { id: 'cleared', panelIds: ['A'],
    transitionToNext: '后续未验证的问题', fieldStates: Object.fromEntries(
      ['groupGoal', 'groupConclusion', 'established'].map(key => [key, { value: '', humanReviewed: true }])) }, 0);
  assert.equal(details.children[0].children.find(child => child.className ===
    'workspace-evidence-block-description').textContent, '暂无证据小结');
});

test('Panel navigation opens the containing evidence block and number chips size to content', () => {
  const navigation = functionRegion(
    'navigateFigureQuickAnchor', 'followFigureOriginalViewerInSidebar'
  );
  assert.match(navigation, /details\.workspace-evidence-block/);
  assert.doesNotMatch(navigation, /details\.workspace-evidence-panels/);
  assert.match(navigation, /ancestor\.open = true/);
  assert.match(navigation, /figureEvidenceExpansionState\.set\(stateKey, true\)/);

  const chip = css.match(/\.workspace-panel-id\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body || '';
  assert.match(chip, /width:\s*fit-content/);
  assert.match(chip, /min-width:\s*0/);
  assert.match(chip, /border-radius:\s*4px/);
  assert.doesNotMatch(chip, /min-width:\s*58px|border-radius:\s*999px/);
  assert.match(css, /\.workspace-evidence-panels-body\s*>\s*\.workspace-figure-panel-card/);
});
