const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cloneExportValue,
  createZipBlob,
  buildPptAgentPrompt,
  buildZoteroFigureNoteHtml,
  buildZoteroChatNoteHtml,
  serializeMechanismGraphExport,
  parseMechanismGraphExport
} = require('../core/export-bundle.js');

test('graph serialization accepts only the export DTO and contains zero provenance fields', () => {
  const dto = {
    schema: 'brevess.mechanism-graph', schemaVersion: 1,
    nodes: [{ id: 'n0', label: 'Microglia' }, { id: 'n1', label: 'Clearance' }],
    edges: [{
      id: 'e0', from: 'n0', to: 'n1', label: 'decreases',
      lineStyle: 'solid', contested: true, codes: ['N', 'C']
    }],
    components: [{ componentId: 'component-1', nodeIds: ['n0', 'n1'], edgeIds: ['e0'] }],
    disconnectedEvidence: [], exclusions: []
  };
  dto.panelUid = 'private-uid';
  dto.nodes[0].metadata = { sourceRefs: ['figure-1:A:purpose'] };
  dto.nodes[0].label = `${'Microglia '.repeat(40)}\nPanel 2A ` +
    '<svg onload="alert(1)"> click n0 "javascript:alert(1)"';
  dto.edges[0].label = 'decreases\nclassDef hacked fill:<svg/onload=alert(1)>';
  dto.edges[0].evidence = { claimId: 'private-claim', text: 'private evidence text' };
  const serialized = serializeMechanismGraphExport(dto);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.schema, 'brevess.mechanism-graph');
  assert.deepEqual(Object.keys(parsed).sort(), [
    'components', 'disconnectedEvidence', 'edges', 'exclusions', 'nodes',
    'schema', 'schemaVersion'
  ]);
  assert.doesNotMatch(serialized,
    /panelUid|panelKey|claimId|sourceRefs|private-uid|private-claim|private evidence/iu);
  assert.doesNotMatch(serialized,
    /Panel\s*2A|<svg|onload|\bclick\b|classDef|javascript:|\r|\n/iu);
  assert.ok([...parsed.nodes[0].label].length <= 120);
  assert.ok([...parsed.edges[0].label].length <= 120);

  let lengthGets = 0;
  const safeNodes = parsed.nodes.map(node => ({ ...node }));
  dto.nodes = new Proxy(safeNodes, {
    get(target, key, receiver) {
      if (key === 'length') lengthGets += 1;
      return Reflect.get(target, key, receiver);
    }
  });
  assert.doesNotThrow(() => serializeMechanismGraphExport(dto));
  assert.equal(lengthGets, 0, 'array length must be read from an own data descriptor');
  const revoked = Proxy.revocable(safeNodes, {});
  revoked.revoke();
  dto.nodes = revoked.proxy;
  assert.throws(() => serializeMechanismGraphExport(dto),
    /MECHANISM_GRAPH_EXPORT_INVALID/u);

  assert.deepEqual(parseMechanismGraphExport(serialized), parsed,
    'the safe graph JSON must be accepted by the adjacent import workflow');
});

test('stored ZIP writer keeps UTF-8 paths and payloads intact', async () => {
  const zip = await createZipBlob([
    { path: 'figures/Figure_01/image_01.png', data: new Uint8Array([1, 2, 3, 4]) },
    { path: 'analysis/解图.md', data: '# Figure 1\n\nPanel A' }
  ], { modifiedAt: new Date('2026-07-25T10:00:00Z') });
  const bytes = Buffer.from(await zip.arrayBuffer());
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.ok(bytes.includes(Buffer.from('figures/Figure_01/image_01.png')));
  assert.ok(bytes.includes(Buffer.from('analysis/解图.md')));
  assert.ok(bytes.includes(Buffer.from('Panel A')));
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), 2);
});

test('PPT agent prompt specifies a formal panel-first Journal Club deck', () => {
  const prompt = buildPptAgentPrompt({
    title: 'Mechanism paper',
    url: 'https://example.org/paper',
    figures: [{
      figureId: 'figure-1',
      figureLabel: 'Figure 1',
      panelHints: ['A', 'B'],
      imageFiles: ['figures/Figure_01/image_01.png']
    }]
  });
  assert.match(prompt, /真实的 Panel 标签和边界/);
  assert.match(prompt, /不能替代视觉核验/);
  assert.match(prompt, /cross-figure-logic\.md/);
  assert.match(prompt, /承上启下/);
  assert.match(prompt, /作者与研究团队/);
  assert.match(prompt, /研究背景/);
  assert.match(prompt, /科学问题/);
  assert.match(prompt, /Panel-first/);
  assert.match(prompt, /视觉主体/);
  assert.match(prompt, /禁止添加无信息价值的图标/);
  assert.match(prompt, /局限性与讨论/);
  assert.match(prompt, /take-home messages/);
  assert.match(prompt, /可直接讲述的演讲备注/);
  assert.match(prompt, /实验目的与设计/);
  assert.match(prompt, /逐 Panel 解读/);
  assert.match(prompt, /\[Source trace\]/);
  assert.match(prompt, /不强制为每个 Figure 制作总览页/);
  assert.match(prompt, /crop-manifest\.json/);
  assert.match(prompt, /可编辑的 `\.pptx`/);
  assert.match(prompt, /先判定执行 Agent 是否具有图像理解能力/);
  assert.match(prompt, /没有图像理解能力/);
  assert.match(prompt, /Fig\. 2A/);
  assert.match(prompt, /_PANEL_PLACEHOLDERS\.pptx/);
  assert.match(prompt, /不得残留相邻 Panel/);
  assert.match(prompt, /字母残缺/);
  assert.match(prompt, /FIGURE 1/);
  assert.match(prompt, /不要把拆开的每一页重新编号为 `RESULT 01`/);
  assert.match(prompt, /就地加入适度的批判性评价/);
  assert.match(prompt, /With Previous/);
  assert.match(prompt, /MediaFormat\.Length/);
  assert.match(prompt, /关闭鼠标单击翻页/);
});

test('export sanitization removes provider secrets and embedded image payloads', () => {
  const safe = cloneExportValue({
    title: 'paper',
    apiKey: 'sk-secret',
    nested: {
      Authorization: 'Bearer secret',
      token: 'secret-token',
      dataUrl: 'data:image/png;base64,AAAA',
      result: 'kept'
    }
  });
  assert.deepEqual(safe, {
    title: 'paper',
    nested: { result: 'kept' }
  });
});

test('Zotero exports Figure interpretation and full-text Q&A as separate child notes', () => {
  const input = {
    title: 'Mechanism paper',
    url: 'https://example.org/paper',
    figures: [{
      figureLabel: 'Figure 1',
      caption: 'A, assay design.',
      standard: {
        coreConclusion: 'Signal increases.',
        panels: [{
          panel: 'A',
          role: 'mechanism',
          methods: ['Calcium imaging'],
          methodDetails: [{
            methodText: 'Calcium imaging',
            methodFamily: 'imaging',
            normalizedMethod: 'calcium imaging'
          }],
          directObservation: 'Panel A rises.',
          observationSource: 'image_observation'
        }],
        panelCoverage: { ignoredUnexpectedPanelCount: 0 }
      },
      panelAnalyses: { A: { directObservation: 'Panel A rises after rereading.' } },
      panelFollowups: { A: { answer: 'The control is vehicle.' } },
      panelFollowupHistories: {
        A: [{ role: 'user', content: 'What is the control?' }]
      }
    }],
    crossFigureLogic: { dominoChain: ['Figure 1 to Figure 2'] },
    chat: {
      turns: [{
        question: 'What is the mechanism?',
        answerBlocks: [{ markdown: 'A receptor-mediated pathway.' }]
      }]
    }
  };
  const figureHtml = buildZoteroFigureNoteHtml(input);
  const chatHtml = buildZoteroChatNoteHtml(input);
  [
    'Figure 1',
    'Panel A rises after rereading.',
    'The control is vehicle.',
    'Figure 1 to Figure 2',
    'Calcium imaging'
  ].forEach(value => assert.match(figureHtml, new RegExp(value)));
  assert.match(figureHtml, /Brevess：图解/);
  assert.match(figureHtml, /核心结论/);
  assert.match(figureHtml, /Panel 分解/);
  assert.match(figureHtml, /主图串解/);
  assert.match(figureHtml, /<table>/);
  assert.match(figureHtml, /快速跳转/);
  assert.doesNotMatch(figureHtml, /methodDetails|Method Details|Method Family/i);
  assert.doesNotMatch(figureHtml, /observationSource|image_observation/i);
  assert.doesNotMatch(figureHtml, /ignoredUnexpectedPanelCount/i);
  assert.doesNotMatch(figureHtml, /追问历史|What is the control\?/);
  assert.doesNotMatch(figureHtml, /<dl>|<details>|<summary>/);
  assert.doesNotMatch(figureHtml, /What is the mechanism/);
  assert.match(chatHtml, /Brevess：全文问答/);
  assert.match(chatHtml, /What is the mechanism/);
  assert.match(chatHtml, /A receptor-mediated pathway/);
  assert.doesNotMatch(chatHtml, /Figure 1 to Figure 2/);
  [figureHtml, chatHtml].forEach(html => {
    assert.doesNotMatch(html, /<pre>/);
    assert.doesNotMatch(html, /javascript:/i);
  });
});

test('Figure exports include safe recovery provenance and unresolved state only', () => {
  const { buildFigureMarkdown } = require('../core/export-bundle.js');
  const markdown = buildFigureMarkdown({
    figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A', 'B'],
    inputMode: 'caption_context', unresolvedPanels: ['B'],
    providerPayload: { Authorization: 'Bearer secret', apiKey: 'sk-secret' },
    standard: {
      inputMode: 'caption_context', unresolvedPanels: ['B'],
      panels: [{ panel: 'A' }, {
        panel: 'B', status: 'not_identifiable',
        reasonCode: 'insufficient_panel_evidence',
        inputMode: 'caption_context', evidenceRefs: ['caption:panel_B']
      }]
    }
  });
  assert.match(markdown, /"inputMode": "caption_context"/u);
  assert.match(markdown, /"unresolvedPanels": \[\s*"B"/u);
  assert.match(markdown, /"reasonCode": "insufficient_panel_evidence"/u);
  assert.doesNotMatch(markdown, /Bearer secret|sk-secret|Authorization|apiKey/u);
});
