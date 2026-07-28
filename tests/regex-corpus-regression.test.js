const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/category-store.js');
const { createUnifiedCategoryCatalog } = require('../core/adaptive-catalog.js');

const catalog = createUnifiedCategoryCatalog();

const CASES = {
  hypothesis: {
    positive: [
      'We hypothesized that microglial activation precedes neuronal loss.',
      'We tested the hypothesis that the treatment changes synaptic density.',
      'It is plausible that the phenotype is mediated by altered metabolism.'
    ],
    negative: [
      'These results are consistent with our hypothesis.',
      'We propose a computational method for cell segmentation.',
      'The effect was presumably caused by batch variation.'
    ]
  },
  objective: {
    positive: [
      'To determine whether activity changes synaptic density, we recorded both groups.',
      'The primary aim of this study was to compare the two treatment groups.',
      'We sought to identify markers of treatment resistance.',
      'We next sought to evaluate the generality of the response.',
      'To address this question, we analyzed an independent cohort.',
      'In this study, we investigate whether the signal is periodic.'
    ],
    negative: [
      'Several trials were initiated to assess therapeutic efficacy.',
      'This work was supported by the national research council.',
      'The present study was cited in a subsequent review.'
    ]
  },
  method: {
    positive: [
      'We performed single-cell RNA sequencing on paired samples.',
      'Samples were collected before and after treatment.',
      'METHODS: Participants were randomly assigned in a 1:1 ratio.',
      'Applying radial velocity analysis to the spectra, we find a periodic signal.'
    ],
    negative: [
      'The method was described in an earlier publication.',
      'Previous studies used a different sequencing platform.',
      'The protocol registration number is shown in the appendix.'
    ]
  },
  result: {
    positive: [
      'We found that treatment reduced tumor volume.',
      'Our results indicate a dose-dependent response.',
      'RESULTS: Mortality was lower in the intervention group.',
      'Here we show that the response depends on receptor activity.',
      'Our data revealed a reproducible transcriptional program.',
      'We find a periodic signal of at least one orbiting satellite.',
      'We identified a reproducible cell state in both cohorts.'
    ],
    negative: [
      'Earlier studies demonstrated that the marker is nonspecific.',
      'It was found in a public reference database.',
      'The reported result was used to calculate sample size.'
    ]
  },
  conclusion: {
    positive: [
      'In conclusion, the intervention improved functional recovery.',
      'Overall, our findings support prospective validation.',
      'CONCLUSIONS: Treatment was associated with improved survival.',
      'Together, these findings highlight a tractable therapeutic pathway.'
    ],
    negative: [
      'Overall survival was estimated with the Kaplan-Meier method.',
      'We demonstrate the workflow in Figure 2.',
      'These results indicate which samples passed quality control.'
    ]
  },
  comparison: {
    positive: [
      'Expression was higher compared with the untreated group.',
      'In contrast, the control group showed no change.'
    ],
    negative: [
      'The samples were processed while investigators were blinded.',
      'Different batches were normalized separately.'
    ]
  },
  limitation: {
    positive: [
      'Our study has several limitations.',
      'A major limitation of this study is the small sample size.',
      'We acknowledge two limitations of the present analysis.',
      'There are several limitations in our current study.',
      'The present study still has some limitations.'
    ],
    negative: [
      'Clearance limitations increased the measured concentration.',
      'A limitation of this clinical approach is its high cost.',
      'The instrument was limited by its maximum acquisition rate.'
    ]
  },
  future: {
    positive: [
      'Further studies are needed to validate these findings.',
      'Future research should test the mechanism prospectively.',
      'Our findings warrant additional investigation.',
      'This observation warrants further exploration.',
      'The mechanism needs to be further investigated.'
    ],
    negative: [
      'Samples were included in the follow-up analysis.',
      'The participants returned for follow-up imaging.',
      'The value remains to be calculated from the archived data.'
    ]
  },
  causality: {
    positive: [
      'The response decreased because receptor signaling was blocked.',
      'Treatment led to a sustained reduction in inflammation.'
    ],
    negative: [
      'The receptor and its ligand were measured together.',
      'The groups had similar baseline characteristics.'
    ]
  },
  emphasis: {
    positive: [
      'Importantly, the effect was replicated in an independent cohort.',
      'Of note, no severe adverse events occurred.'
    ],
    negative: [
      'The signal was particularly strong in older participants.',
      'Cells were critically evaluated before sequencing.'
    ]
  },
  evidence: {
    positive: [
      'Previous studies have linked this pathway to inflammation.',
      'Evidence suggests that the response is cell-type specific.',
      'These data corroborate earlier findings.',
      'We present evidence of an exosatellite orbiting the companion.',
      'The experiment provides direct evidence for receptor activation.'
    ],
    negative: [
      'The supporting table lists all reagent identifiers.',
      'A corroborating author approved the final manuscript.'
    ]
  },
  interpretation: {
    positive: [
      'This suggests that receptor signaling mediates the response.',
      'The pattern is consistent with impaired mitochondrial function.'
    ],
    negative: [
      'The suggesting author information was removed.',
      'Consistency checks were applied to every sample.'
    ]
  }
};

for (const [categoryId, cases] of Object.entries(CASES)) {
  test(`${categoryId} regex accepts curated positives and rejects corpus-like negatives`, () => {
    const category = catalog[categoryId];
    cases.positive.forEach(text => {
      assert.equal(matches(category, text), true, `expected positive: ${text}`);
    });
    cases.negative.forEach(text => {
      assert.equal(matches(category, text), false, `expected negative: ${text}`);
    });
  });
}

function matches(category, text) {
  const flags = category.regex.caseSensitive ? '' : 'i';
  const phraseMatch = category.regex.phrases.some(phrase => {
    const index = category.regex.caseSensitive
      ? text.indexOf(phrase) : text.toLowerCase().indexOf(phrase.toLowerCase());
    if (index < 0) return false;
    if (!category.regex.wholeWord) return true;
    return !isWordCharacter(text[index - 1]) &&
      !isWordCharacter(text[index + phrase.length]);
  });
  if (phraseMatch) return true;
  return category.regex.expressions.some(expression =>
    new RegExp(expression, flags).test(text)
  );
}

function isWordCharacter(value) {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
}
