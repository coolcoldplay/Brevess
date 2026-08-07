const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractArticleAbbreviations,
  isCandidateAbbreviation,
  expansionScore,
  normalizeGlobalAbbreviationMemory,
  mergeGlobalAbbreviationMemory,
  createGlobalAbbreviationMemoryExport,
  parseGlobalAbbreviationMemoryImport,
  normalizeArticleAbbreviationState,
  upsertArticleManualAbbreviation,
  excludeArticleAbbreviation,
  updateArticleAbbreviationTranslations,
  inferSelectedAbbreviationDraft,
  composeArticleAbbreviations,
  compileAbbreviationTranslationPrompt,
  validateAbbreviationTranslationResult
} = require('../core/abbreviation-extractor.js');

test('extracts explicit article abbreviation definitions locally and sorts them alphabetically', () => {
  const entries = extractArticleAbbreviations([
    {
      text: 'We used adeno-associated virus (AAV) and single-cell RNA sequencing (scRNA-seq).'
    },
    {
      text: 'The central nucleus of the solitary tract (cNTS) controls this response.'
    },
    {
      text: 'Tumor necrosis factor (TNF) was quantified in every sample.'
    }
  ]);

  assert.deepEqual(entries.map(entry => entry.abbreviation), [
    'AAV', 'cNTS', 'scRNA-seq', 'TNF'
  ]);
  assert.equal(entries[0].fullName, 'adeno-associated virus');
  assert.equal(entries[1].fullName, 'central nucleus of the solitary tract');
  assert.equal(entries[2].fullName, 'single-cell RNA sequencing');
  assert.equal(entries[3].fullName, 'Tumor necrosis factor');
});

test('supports reverse definitions, Chinese definitions, and duplicate resolution', () => {
  const entries = extractArticleAbbreviations([
    { text: 'TNF (tumor necrosis factor) expression increased.' },
    { text: 'Tumor necrosis factor (TNF) was measured again.' },
    { text: '我们使用腺相关病毒（AAV）标记细胞。' },
    { text: '本研究采用磁共振成像（MRI）评估组织结构。' }
  ]);

  assert.deepEqual(entries.map(entry => entry.abbreviation), ['AAV', 'MRI', 'TNF']);
  assert.equal(entries.find(entry => entry.abbreviation === 'AAV').fullName, '腺相关病毒');
  assert.equal(entries.find(entry => entry.abbreviation === 'MRI').fullName, '磁共振成像');
  assert.equal(entries.find(entry => entry.abbreviation === 'TNF').count, 2);
});

test('rejects article structure labels and unrelated parenthetical prose', () => {
  const entries = extractArticleAbbreviations([
    { text: 'Figure 2 (Panel A) summarizes the experiment.' },
    { text: 'Table 1 (Results) reports the measurements.' },
    { text: 'This method (which was validated independently) was retained.' },
    { text: 'The signal was higher in the control group (p = 0.02).' }
  ]);

  assert.deepEqual(entries, []);
  for (const value of ['Figure', 'Panel', 'Table', 'Section', 'Ref']) {
    assert.equal(isCandidateAbbreviation(value), false);
  }
});

test('rejects reagent metadata, genotype labels, cell markers, and descriptor-only aliases', () => {
  const entries = extractArticleAbbreviations([
    { text: 'AP (anti-PIMO (Pab2617)) staining was used for hypoxia detection.' },
    {
      text: 'CD11c+ (CD11c beads; catalog no. 130-108-338, lot no. 5190903182, Miltenyi Biotec) cells were isolated.'
    },
    { text: 'Ccr2-KO (Ccr2 knockout) mice were compared with controls.' },
    { text: 'The cDC1 population was labeled conventional DC (cDC1).' },
    { text: 'Subclusters included cDC2a (cluster 6) and cDC2b (cluster 8).' },
    {
      text: 'Conventional dendritic cell type 2 (cDC2) abundance was quantified by cellular indexing of transcriptomes and epitopes by sequencing (CITE-seq).'
    }
  ]);

  assert.deepEqual(entries.map(entry => entry.abbreviation), ['cDC2', 'CITE-seq']);
  assert.equal(
    entries.find(entry => entry.abbreviation === 'cDC2').fullName,
    'Conventional dendritic cell type 2'
  );
  assert.equal(isCandidateAbbreviation('CD11c+'), false);
  assert.equal(isCandidateAbbreviation('Ccr2-KO'), false);
  assert.equal(expansionScore('AP', 'anti-PIMO (Pab2617'), -1);
  assert.equal(expansionScore('cDC2a', 'cluster 6'), -1);
  assert.equal(expansionScore('cDC1', 'conventional DC'), -1);
});

test('locates the first literal occurrence for source navigation', () => {
  const entries = extractArticleAbbreviations([
    {
      paragraphId: 'sec-abstract-p-001',
      sourceKey: 'abstract-aav-first',
      navigationRevision: 19,
      text: 'AAV delivery restored lymphatic drainage in aged mice.'
    },
    {
      paragraphId: 'sec-results-p-001',
      sourceKey: 'results-cdc2a',
      navigationRevision: 19,
      text: 'The cDC2a subset was analyzed separately.'
    },
    {
      paragraphId: 'sec-methods-p-001',
      sourceKey: 'methods-definitions',
      navigationRevision: 19,
      text: 'Adeno-associated virus (AAV) was administered intranasally, and conventional dendritic cell type 2 (cDC2) abundance was quantified.'
    }
  ]);

  const aav = entries.find(entry => entry.abbreviation === 'AAV');
  const cdc2 = entries.find(entry => entry.abbreviation === 'cDC2');
  assert.deepEqual(
    {
      sourceIndex: aav.sourceIndex,
      paragraphId: aav.paragraphId,
      sourceKey: aav.sourceKey,
      navigationRevision: aav.navigationRevision
    },
    {
      sourceIndex: 0,
      paragraphId: 'sec-abstract-p-001',
      sourceKey: 'abstract-aav-first',
      navigationRevision: 19
    }
  );
  assert.equal(cdc2.sourceIndex, 2);
  assert.equal(cdc2.paragraphId, 'sec-methods-p-001');
});

test('rejects sentence fragments injected by bilingual translation extensions', () => {
  const entries = extractArticleAbbreviations([
    {
      text: 'Gasdermins (GSDMs) are a family of pore-forming proteins. ' +
        '有人建议将焦亡定义为由气体凝集素（GSDM）执行的细胞死亡。'
    },
    {
      text: 'This function of GSDMs was initially identified from studies of ' +
        'gasdermin D (GSDMD). 的这一功能最初来源于对气体孔蛋白 D（GSDMD）的研究。'
    },
    { text: 'Gasdermin E (GSDME) is also known as DFNA5. 亦称 DFNA5（GSDME）。' }
  ]);

  assert.equal(entries.find(entry => entry.abbreviation === 'GSDM'), undefined);
  assert.equal(
    entries.find(entry => entry.abbreviation === 'GSDMD').fullName,
    'gasdermin D'
  );
  assert.equal(
    entries.find(entry => entry.abbreviation === 'GSDME').fullName,
    'Gasdermin E'
  );
});

test('combines automatic, manual, global, excluded, and translated article entries', () => {
  const paragraphs = [{
    paragraphId: 'p-1',
    sourceKey: 'source-1',
    text: 'Tumor necrosis factor (TNF) and interleukin 6 (IL-6) were measured.'
  }];
  const memory = normalizeGlobalAbbreviationMemory({
    entries: [{
      abbreviation: 'TNF',
      fullName: 'Tumor necrosis factor',
      meaningZh: '肿瘤坏死因子'
    }]
  });
  let articleState = upsertArticleManualAbbreviation({}, {
    abbreviation: 'IL-6',
    fullName: 'interleukin 6'
  });
  articleState = updateArticleAbbreviationTranslations(articleState, [{
    abbreviation: 'IL-6',
    fullName: 'interleukin 6',
    meaningZh: '白细胞介素 6',
    origin: 'manual'
  }]);
  let composed = composeArticleAbbreviations({
    paragraphs,
    globalMemory: memory,
    articleState
  });

  assert.equal(composed.entries.find(item => item.abbreviation === 'TNF').meaningZh, '肿瘤坏死因子');
  assert.equal(composed.entries.find(item => item.abbreviation === 'TNF').sourceType, 'automatic+global');
  assert.equal(composed.entries.find(item => item.abbreviation === 'IL-6').meaningZh, '白细胞介素 6');
  assert.equal(composed.entries.find(item => item.abbreviation === 'IL-6').sourceType, 'manual');
  assert.equal(composed.translatedCount, 2);

  articleState = excludeArticleAbbreviation(articleState, 'IL-6');
  composed = composeArticleAbbreviations({ paragraphs, globalMemory: memory, articleState });
  assert.deepEqual(composed.entries.map(item => item.abbreviation), ['TNF']);
  assert.deepEqual(normalizeArticleAbbreviationState(articleState).translations, []);
});

test('global memory never injects entries that are absent from the current article', () => {
  const paragraphs = [{
    paragraphId: 'current-p-1',
    sourceKey: 'current-source-1',
    text: 'Gasdermins (GSDMs) execute pyroptosis in cancer cells.'
  }];
  const globalMemory = normalizeGlobalAbbreviationMemory({
    entries: [
      { abbreviation: 'CGRP', fullName: 'calcitonin gene-related peptide' },
      { abbreviation: 'DRG', fullName: 'dorsal root ganglia' },
      { abbreviation: 'GSDMs', fullName: 'Gasdermins' }
    ]
  });

  const composed = composeArticleAbbreviations({ paragraphs, globalMemory });

  assert.deepEqual(composed.entries.map(item => item.abbreviation), ['GSDMs']);
  assert.equal(composed.entries[0].paragraphId, 'current-p-1');
  assert.equal(composed.globalCount, 1);
});

test('global abbreviation memory export is shareable and omits article navigation metadata', () => {
  const merged = mergeGlobalAbbreviationMemory({}, [{
    abbreviation: 'AAV',
    fullName: 'adeno-associated virus',
    meaningZh: '腺相关病毒',
    paragraphId: 'private-paragraph-id',
    sourceKey: 'private-source-key'
  }], { incrementSupport: true });
  const exported = createGlobalAbbreviationMemoryExport(
    merged.memory,
    '2026-07-30T10:00:00.000Z'
  );
  const roundTrip = parseGlobalAbbreviationMemoryImport(exported);

  assert.equal(exported.entryCount, 1);
  assert.equal(exported.entries[0].meaningZh, '腺相关病毒');
  assert.equal('paragraphId' in exported.entries[0], false);
  assert.equal('sourceKey' in exported.entries[0], false);
  assert.deepEqual(roundTrip.entries, merged.memory.entries);
});

test('validates complete Chinese translation batches for the paragraph-summary model', () => {
  const entries = [
    { abbreviation: 'TNF', fullName: 'tumor necrosis factor' },
    { abbreviation: 'AAV', fullName: 'adeno-associated virus' }
  ];
  const prompt = compileAbbreviationTranslationPrompt(entries);
  const translated = validateAbbreviationTranslationResult({
    translations: [
      { abbreviation: 'TNF', meaning_zh: '肿瘤坏死因子' },
      { abbreviation: 'AAV', meaning_zh: '腺相关病毒' }
    ]
  }, entries);

  assert.equal(prompt.schemaName, 'abbreviation_chinese_meanings');
  assert.deepEqual(translated.map(item => item.meaningZh), [
    '肿瘤坏死因子', '腺相关病毒'
  ]);
  assert.throws(() => validateAbbreviationTranslationResult({
    translations: [{ abbreviation: 'TNF', meaning_zh: 'tumor necrosis factor' }]
  }, entries), error => error.code === 'INVALID_RESPONSE');
});

test('infers the text outside parentheses as the full name and the text inside as the abbreviation', () => {
  assert.deepEqual(
    inferSelectedAbbreviationDraft('nanoparticles (NPs)'),
    { abbreviation: 'NPs', fullName: 'nanoparticles' }
  );
  assert.deepEqual(
    inferSelectedAbbreviationDraft('single-cell RNA sequencing（scRNA-seq）'),
    { abbreviation: 'scRNA-seq', fullName: 'single-cell RNA sequencing' }
  );
});

test('accepts partial Chinese translation batches for automatic repair', () => {
  const entries = [
    { abbreviation: 'TNF', fullName: 'tumor necrosis factor' },
    { abbreviation: 'AAV', fullName: 'adeno-associated virus' }
  ];
  const prompt = compileAbbreviationTranslationPrompt(entries, {
    allowPartial: true
  });
  const translated = validateAbbreviationTranslationResult({
    translations: [
      { abbreviation: 'AAV', meaning_zh: '腺相关病毒' }
    ]
  }, entries, { allowPartial: true });

  assert.equal(prompt.responseSchema.properties.translations.minItems, 1);
  assert.deepEqual(translated.map(item => item.abbreviation), ['AAV']);
});
