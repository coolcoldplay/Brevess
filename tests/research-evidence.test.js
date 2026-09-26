const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeResearchEvidenceAtom,
  normalizeResearchEvidenceSet,
  buildResearchEvidenceDocument,
  RESEARCH_EVIDENCE_VERSION
} = require('../core/research-evidence.js');

test('normalizes a verified research evidence atom with stable source identity', () => {
  const atom = normalizeResearchEvidenceAtom({
    evidenceId: 'E3', type: 'E',
    statement: ' Experience-dependent PV plasticity is impaired in risk models. ',
    sourceRefs: [{
      paragraphId: 'intro-p4', sourceIdentity: 'intro:4', sourceKey: 'raw-4',
      textHash: 'h4', quote: 'PV plasticity is impaired.', citationRefs: ['Ref12']
    }],
    evidenceRole: 'direct_evidence', directness: 'same_cell_same_region',
    origin: 'author_explicit', confidence: 'high', verificationStatus: 'verified',
    ignored: 'must not escape'
  });
  assert.equal(RESEARCH_EVIDENCE_VERSION, '2');
  assert.deepEqual(atom, {
    evidenceId: 'E3', type: 'prior_evidence',
    statement: 'Experience-dependent PV plasticity is impaired in risk models.',
    sourceRefs: [{
      paragraphId: 'intro-p4', sourceIdentity: 'intro:4', sourceKey: 'raw-4',
      textHash: 'h4', quote: 'PV plasticity is impaired.', citationRefs: ['Ref12'],
      sectionPath: [], documentHash: ''
    }],
    evidenceRole: 'direct_evidence', directness: 'same_cell_same_region',
    origin: 'author_explicit', confidence: 'high', verificationStatus: 'verified'
  });
  assert.ok(Object.isFrozen(atom));
});

test('accepts the B K E X G R Q H A ontology and rejects unsupported atoms', () => {
  const aliases = ['B', 'K', 'E', 'X', 'G', 'R', 'Q', 'H', 'A'];
  const atoms = normalizeResearchEvidenceSet(aliases.map((type, index) => ({
    evidenceId: `${type}${index + 1}`, type, statement: `statement ${type}`,
    verificationStatus: 'evidence_insufficient', origin: 'brevess_reconstructed'
  })));
  assert.deepEqual(atoms.map(item => item.type), [
    'background', 'known_mechanism', 'prior_evidence', 'knowledge_gap',
    'rationale', 'result', 'question', 'hypothesis', 'author_aim'
  ]);
  assert.equal(normalizeResearchEvidenceAtom({ evidenceId: 'Z1', type: 'Z', statement: 'x' }), null);
});

test('deduplicates only identical type statement and source identity', () => {
  const base = {
    evidenceId: 'B1', type: 'B', statement: 'A stable background fact.',
    sourceRefs: [{ paragraphId: 'p1', sourceIdentity: 'intro:p1', textHash: 'h1', quote: 'fact' }],
    origin: 'author_explicit', verificationStatus: 'verified'
  };
  const atoms = normalizeResearchEvidenceSet([
    base,
    { ...base, evidenceId: 'B2', confidence: 'high' },
    { ...base, evidenceId: 'E1', type: 'E' },
    { ...base, evidenceId: 'B3', sourceRefs: [{ paragraphId: 'p2', sourceIdentity: 'intro:p2', quote: 'fact' }] }
  ]);
  assert.equal(atoms.length, 3);
  assert.equal(atoms[0].evidenceId, 'B1');
});

test('builds a deterministic bounded evidence document without translated duplicates', () => {
  const snapshot = {
    title: 'A deterministic paper title',
    documentHash: 'doc-hash',
    paragraphs: [
      { paragraphId: 'm1', sourceIdentity: 'methods:1', sectionKind: 'methods', sectionTitle: 'Methods', text: 'Bulk protocol.' },
      { paragraphId: 'a1', sourceIdentity: 'abstract:1', sectionKind: 'abstract', sectionTitle: 'Abstract', text: 'Abstract evidence.' },
      { paragraphId: 'i1', sourceIdentity: 'intro:1', sectionKind: 'introduction', sectionTitle: 'Introduction', text: 'Introduction background.' },
      { paragraphId: 'i1-zh', sourceIdentity: 'intro:1:translation', sectionKind: 'introduction', sectionTitle: 'Introduction', text: '引言背景。', isTranslated: true },
      { paragraphId: 'r1', sourceIdentity: 'results:1', sectionKind: 'results', sectionTitle: 'Results', text: 'First result.' },
      { paragraphId: 'd1', sourceIdentity: 'discussion:1', sectionKind: 'discussion', sectionTitle: 'Discussion', text: 'A limitation remains.' }
    ]
  };
  const first = buildResearchEvidenceDocument(snapshot, { maxCharacters: 4000 });
  const second = buildResearchEvidenceDocument(snapshot, { maxCharacters: 4000 });
  assert.deepEqual(second, first);
  assert.deepEqual(first.records.map(item => item.paragraphId), ['a1', 'i1', 'r1', 'd1']);
  assert.doesNotMatch(first.stableText, /Bulk protocol|引言背景/);
  assert.match(first.stableText, /sourceIdentity/);
  assert.equal(first.title, 'A deterministic paper title');
  assert.match(first.stableText, /A deterministic paper title/);
  assert.ok(Object.isFrozen(first));
});
