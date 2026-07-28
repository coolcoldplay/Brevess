const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateUnifiedCategory
} = require('../core/category-store.js');
const {
  createAdaptiveCategoryCatalog,
  createUnifiedCategoryCatalog
} = require('../core/adaptive-catalog.js');

const catalog = createUnifiedCategoryCatalog();
const adaptiveCategoryIds = Object.keys(createAdaptiveCategoryCatalog())
  .filter(categoryId => ![
    'hypothesis', 'objective', 'method', 'result', 'conclusion', 'comparison',
    'limitation', 'future', 'causality', 'emphasis', 'evidence',
    'interpretation', 'semantic_match'
  ].includes(categoryId));

const CASES = {
  known_background: {
    positive: 'Previous studies have shown that microglia remodel synapses.',
    negative: 'We found that microglia remodeled synapses after treatment.'
  },
  knowledge_gap: {
    positive: 'How microglia select synapses remains unclear.',
    negative: 'We measured how microglia selected synapses.'
  },
  study_strategy: {
    positive: 'To address this question, we combined imaging and perturbation.',
    negative: 'Sections were washed and imaged three times.'
  },
  key_result: {
    positive: 'The key finding was that receptor loss prevented degeneration.',
    negative: 'A quality-control result is provided in Supplementary Table 2.'
  },
  significance_novelty: {
    positive: 'To our knowledge, this study is the first to connect these pathways.',
    negative: 'This pathway is important in many tissues.'
  },
  driver_intervention: {
    positive: 'Following treatment with the inhibitor, signaling declined.',
    negative: 'The inhibitor is widely used in biochemical assays.'
  },
  association_evidence: {
    positive: 'Receptor abundance was positively correlated with survival.',
    negative: 'Receptor blockade prevented neuronal loss.'
  },
  causal_effect: {
    positive: 'The intervention led to a sustained reduction in inflammation.',
    negative: 'Inflammation and age were measured at baseline.'
  },
  mechanism_mediator: {
    positive: 'The protective effect was mediated by receptor signaling.',
    negative: 'Receptor signaling changed after treatment.'
  },
  necessity_evidence: {
    positive: 'Receptor signaling was required for the protective response.',
    negative: 'Receptor signaling was detected during the response.'
  },
  sufficiency_evidence: {
    positive: 'Receptor activation alone was sufficient to induce recovery.',
    negative: 'Receptor activation accompanied recovery.'
  },
  rescue_evidence: {
    positive: 'Re-expression of the receptor fully rescued the phenotype.',
    negative: 'Re-expression altered receptor abundance.'
  },
  temporal_dose_evidence: {
    positive: 'The response increased in a dose-dependent manner.',
    negative: 'The response differed between treatment groups.'
  },
  cross_system_validation: {
    positive: 'The finding was replicated in an independent cohort.',
    negative: 'The finding was reanalyzed in the discovery cohort.'
  },
  mechanism_gap: {
    positive: 'The underlying mechanism remains unknown.',
    negative: 'The mechanism involves receptor phosphorylation.'
  },
  alternative_mechanism: {
    positive: 'The phenotype could instead reflect altered metabolism.',
    negative: 'The phenotype reflected altered metabolism.'
  },
  design_control: {
    positive: 'Participants were randomized to a double-blind placebo-controlled trial.',
    negative: 'Participants were observed during routine clinical care.'
  },
  sample_population: {
    positive: 'We enrolled 120 patients from three hospitals.',
    negative: 'The assay was repeated 120 times.'
  },
  measurement_validity: {
    positive: 'Inter-rater reliability was assessed before the primary analysis.',
    negative: 'Two investigators collected the measurements.'
  },
  effect_uncertainty: {
    positive: 'The hazard ratio was 0.72 with a 95% confidence interval.',
    negative: 'Survival was higher in the treatment group.'
  },
  statistical_robustness: {
    positive: 'The association persisted in a prespecified sensitivity analysis.',
    negative: 'The association had a nominal P value of 0.04.'
  },
  confounding_reverse_causality: {
    positive: 'Residual confounding and reverse causality cannot be excluded.',
    negative: 'Covariates were recorded at enrollment.'
  },
  causal_overreach: {
    positive: 'The observational design precludes causal inference.',
    negative: 'The randomized intervention reduced the primary outcome.'
  },
  alternative_explanation: {
    positive: 'Another possible explanation is differential follow-up.',
    negative: 'Differential follow-up was not observed.'
  },
  replication_external_validation: {
    positive: 'The model was externally validated in a separate hospital.',
    negative: 'The model was tuned using cross-validation in the development data.'
  },
  generalizability: {
    positive: 'These findings may not be generalizable to older adults.',
    negative: 'Older adults were included in the study.'
  },
  statistical_vs_practical_significance: {
    positive: 'The difference was statistically significant but not clinically meaningful.',
    negative: 'The difference met the prespecified significance threshold.'
  },
  transparency_reproducibility: {
    positive: 'Data and source code are available in a public repository.',
    negative: 'The authors analyzed the source data.'
  },
  review_scope_thesis: {
    positive: 'This review summarizes the current evidence on microglial signaling.',
    negative: 'This experiment tested microglial signaling in mice.'
  },
  evidence_consensus: {
    positive: 'Multiple studies have shown a consistent protective effect.',
    negative: 'One study reported a protective effect.'
  },
  conflicting_evidence: {
    positive: 'Studies have yielded conflicting findings.',
    negative: 'All studies reported the same direction of effect.'
  },
  heterogeneity_source: {
    positive: 'Substantial between-study heterogeneity reflected population differences.',
    negative: 'The studies enrolled participants from several populations.'
  },
  evidence_quality_certainty: {
    positive: 'The evidence was rated as low certainty because of risk of bias.',
    negative: 'The review included several randomized trials.'
  },
  integrative_framework: {
    positive: 'We propose an integrative framework that connects these findings.',
    negative: 'We analyzed each finding separately.'
  },
  author_synthesis: {
    positive: 'Taken together, the evidence supports a context-dependent effect.',
    negative: 'Smith et al. reported a context-dependent effect.'
  }
};

test('all 35 adaptive categories ship executable and safe built-in regex', () => {
  assert.equal(adaptiveCategoryIds.length, 35);
  assert.deepEqual(adaptiveCategoryIds.sort(), Object.keys(CASES).sort());
  adaptiveCategoryIds.forEach(categoryId => {
    const category = catalog[categoryId];
    assert.ok(category.regex.phrases.length + category.regex.expressions.length > 0,
      categoryId);
    assert.deepEqual(validateUnifiedCategory(category), [], categoryId);
  });
});

for (const [categoryId, cases] of Object.entries(CASES)) {
  test(`${categoryId} conservative regex accepts its cue and rejects a near negative`, () => {
    const category = catalog[categoryId];
    assert.equal(matches(category, cases.positive), true,
      `expected positive: ${cases.positive}`);
    assert.equal(matches(category, cases.negative), false,
      `expected negative: ${cases.negative}`);
  });
}

test('corpus-derived anti-patterns do not activate semantically stronger categories', () => {
  const negatives = {
    causal_effect: [
      'Immunotherapy has led to important clinical advances over the past decade.'
    ],
    mechanism_mediator: [
      'Receptor signaling is required for resistance acquisition.',
      'Mass spectrometry depends on identification of modification-induced shifts.'
    ],
    significance_novelty: [
      'Future technologies will advance our understanding of the disease.',
      'A previously published assay paves the way for routine screening.'
    ],
    cross_system_validation: [
      'Further in vitro and in vivo experiments are necessary.'
    ],
    alternative_mechanism: [
      'Alternatively, a T-tube mixer can be used to mix the reagents.'
    ],
    replication_external_validation: [
      'These preliminary data require independent validation.'
    ],
    statistical_vs_practical_significance: [
      'We evaluated the clinical relevance of the biomarker.',
      'This section discusses the clinical importance of the pathway.'
    ],
    heterogeneity_source: [
      'The trial was not powered to measure subgroup differences.'
    ]
  };
  Object.entries(negatives).forEach(([categoryId, sentences]) => {
    sentences.forEach(sentence => {
      assert.equal(matches(catalog[categoryId], sentence), false,
        `${categoryId}: ${sentence}`);
    });
  });
});

test('concise Nature-style abstracts retain their gap, method, result, evidence, and significance cues', () => {
  const sentences = {
    knowledge_gap:
      'It is not clear if satellites of brown dwarf companions can be called exomoons.',
    method:
      'Applying radial velocity analysis to the spectra, we find a periodic signal.',
    result:
      'We find what appears to be the periodic signal of at least one orbiting satellite.',
    evidence:
      'In this work, we present evidence of an exosatellite orbiting the companion.',
    significance_novelty:
      'It is a marked step towards the first uncontroversial detection.'
  };
  Object.entries(sentences).forEach(([categoryId, sentence]) => {
    assert.equal(matches(catalog[categoryId], sentence), true,
      `${categoryId}: ${sentence}`);
  });
});

function matches(category, text) {
  const flags = category.regex.caseSensitive ? '' : 'i';
  const phraseMatch = category.regex.phrases.some(phrase => {
    const searchable = category.regex.caseSensitive ? text : text.toLowerCase();
    const needle = category.regex.caseSensitive ? phrase : phrase.toLowerCase();
    let index = searchable.indexOf(needle);
    while (index >= 0) {
      if (!category.regex.wholeWord ||
          (!isWordCharacter(text[index - 1]) &&
            !isWordCharacter(text[index + phrase.length]))) {
        return true;
      }
      index = searchable.indexOf(needle, index + Math.max(1, needle.length));
    }
    return false;
  });
  if (phraseMatch) return true;
  return category.regex.expressions.some(expression => {
    const match = text.match(new RegExp(expression, flags));
    if (!match) return false;
    if (!category.regex.wholeWord) return true;
    const index = match.index;
    return !isWordCharacter(text[index - 1]) &&
      !isWordCharacter(text[index + match[0].length]);
  });
}

function isWordCharacter(value) {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
}
