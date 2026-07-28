const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractArticleAbbreviations,
  isCandidateAbbreviation,
  expansionScore
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
