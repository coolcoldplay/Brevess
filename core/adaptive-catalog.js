(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const STUDY_TYPES = Object.freeze({
    basic_mechanistic: { name: '基础机制研究' },
    preclinical_translational: { name: '临床前/转化研究' },
    observational: { name: '观察性研究' },
    clinical_trial: { name: '临床试验' },
    diagnostic_prognostic: { name: '诊断/预后研究' },
    omics_high_throughput: { name: '组学/高通量研究' },
    narrative_review: { name: '叙述性综述（机制/转化）' },
    systematic_review_meta: { name: '系统综述/Meta 分析' },
    methods_resource: { name: '方法/工具/资源研究' }
  });

  const READING_VIEWS = Object.freeze({
    quick_story: {
      name: '快速主线',
      description: '为什么做、如何验证、发现什么、说明什么',
      categoryIds: [
        'known_background', 'scientific_question', 'method', 'result',
        'interpretation', 'limitation', 'significance_novelty', 'future'
      ]
    },
    mechanism_chain: {
      legacyOnly: true,
      name: '机制证据链',
      description: '起始因素、机制中介、证据强度与下游结局',
      categoryIds: [
        'driver_intervention', 'association_evidence', 'causal_effect',
        'mechanism_mediator', 'necessity_evidence', 'sufficiency_evidence',
        'rescue_evidence', 'temporal_dose_evidence', 'cross_system_validation',
        'mechanism_gap', 'alternative_mechanism',
        'evidence', 'interpretation'
      ]
    },
    critical_review: {
      name: '批判精读',
      description: '必要性、充分性、挽救实验、关键对照与原文存疑点',
      categoryIds: [
        'necessity_evidence', 'sufficiency_evidence', 'rescue_evidence',
        'design_control', 'review_question'
      ]
    },
    review_synthesis: {
      name: '综述阅读',
      description: '范围、共识、矛盾、异质性、证据质量与作者综合判断',
      categoryIds: [
        'review_scope_thesis', 'evidence_consensus', 'conflicting_evidence',
        'evidence_quality_certainty', 'future'
      ]
    }
  });

  const TYPE_OVERLAYS = Object.freeze({
    basic_mechanistic: Object.freeze({ quick_story: [], mechanism_chain: [], critical_review: [], review_synthesis: [] }),
    preclinical_translational: Object.freeze({ quick_story: [], mechanism_chain: [], critical_review: [], review_synthesis: [] }),
    observational: Object.freeze({
      quick_story: [],
      mechanism_chain: ['confounding_reverse_causality'],
      critical_review: [],
      review_synthesis: []
    }),
    clinical_trial: Object.freeze({
      quick_story: [],
      mechanism_chain: ['design_control'],
      critical_review: [],
      review_synthesis: []
    }),
    diagnostic_prognostic: Object.freeze({
      quick_story: [],
      mechanism_chain: ['measurement_validity', 'replication_external_validation'],
      critical_review: [],
      review_synthesis: []
    }),
    omics_high_throughput: Object.freeze({
      quick_story: [],
      mechanism_chain: ['statistical_robustness', 'replication_external_validation'],
      critical_review: [],
      review_synthesis: []
    }),
    narrative_review: Object.freeze({
      quick_story: ['review_scope_thesis', 'author_synthesis'],
      mechanism_chain: ['evidence_consensus', 'conflicting_evidence', 'author_synthesis'],
      critical_review: [
        'review_scope_thesis', 'evidence_quality_certainty',
        'integrative_framework', 'author_synthesis'
      ],
      review_synthesis: []
    }),
    systematic_review_meta: Object.freeze({
      quick_story: [],
      mechanism_chain: ['effect_uncertainty', 'statistical_robustness'],
      critical_review: [],
      review_synthesis: []
    }),
    methods_resource: Object.freeze({
      quick_story: [],
      mechanism_chain: ['measurement_validity', 'replication_external_validation'],
      critical_review: [],
      review_synthesis: []
    })
  });

  const TYPE_PROMPT_GUIDANCE = Object.freeze({
    basic_mechanistic: [
      'Prioritize perturbation, target engagement, necessity, sufficiency and rescue in the stated biological model.',
      'A molecular change after an intervention is not by itself a mediator, necessity test, sufficiency test or rescue.',
      'Co-occurrence, localization and pathway membership are association evidence unless the experiment establishes the directed link.'
    ].join(' '),
    preclinical_translational: [
      'Distinguish model efficacy from human validation; examine dose, safety, biomarkers and cross-species consistency.',
      'Animal efficacy, a human-like biomarker or human tissue association does not establish clinical benefit.',
      'Cross-system validation requires a genuinely independent model, species, cohort or human material rather than repeat measurement of the same samples.'
    ].join(' '),
    observational: [
      'Identify exposure, outcome, time order, adjusted effect, selection bias, confounding and reverse causality.',
      'Never upgrade an adjusted association, propensity analysis or temporal ordering to causal proof by itself.',
      'Adjustment reduces specified confounding only; it does not exclude residual confounding, selection bias or reverse causality.'
    ].join(' '),
    clinical_trial: [
      'Identify PICO, allocation, blinding, prespecified primary outcomes, effect intervals, safety, attrition, multiplicity and subgroup status.',
      'Randomization supports causal interpretation only for the randomized intervention and the analyzed outcome, not post-randomization exposures.',
      'Do not treat exploratory subgroup, secondary, per-protocol or post hoc results as the prespecified primary result.',
      'A p value without effect magnitude and uncertainty is not effect uncertainty or practical significance.'
    ].join(' '),
    diagnostic_prognostic: [
      'Identify target population, index or predictor, reference standard, discrimination, calibration, threshold, external validation and clinical utility.',
      'Discrimination, calibration and clinical utility are distinct; a high AUC alone establishes neither calibration nor utility.',
      'A random split, resampling or cross-validation within the development data is internal validation, not external validation.',
      'Require a clearly stated reference standard before treating performance as diagnostic validity.'
    ].join(' '),
    omics_high_throughput: [
      'Identify sampling, batches, preprocessing, quality control, multiplicity, discovery-validation separation and limits of pathway inference.',
      'Differential expression, enrichment, network centrality or pseudotime alone does not establish a biological mechanism or causal mediator.',
      'Technical replicates, reanalysis and cross-validation in the same dataset are not independent biological replication.',
      'Distinguish correction of batch structure from validation that the retained signal is biological.'
    ].join(' '),
    narrative_review: [
      'Identify the review scope, organizing thesis, mechanistic framework, cited evidence, disagreements, translational bridge, limitations and open questions.',
      'Distinguish the review authors\' synthesis from findings attributed to individual primary studies.',
      'A cited association, animal result or pathway model is not direct causal or clinical evidence from the review itself.',
      'Clinical promise supported only by preclinical evidence must remain a translational hypothesis rather than an established patient benefit.'
    ].join(' '),
    systematic_review_meta: [
      'Identify search and inclusion, risk of bias, heterogeneity, pooled effect, publication bias and certainty of evidence.',
      'A pooled association inherits the causal limitations of included study designs.',
      'A nonsignificant heterogeneity or publication-bias test does not prove homogeneity or absence of reporting bias.',
      'Do not equate a precise pooled estimate with high certainty when risk of bias or indirectness remains.'
    ].join(' '),
    methods_resource: [
      'Identify baseline comparisons, evaluation metrics, external datasets, ablations, reproducibility and domain limits.',
      'Benchmark improvement on reused or tuned datasets is not external validation.',
      'An ablation supports the contribution of a method component, not a biological causal mechanism.',
      'Availability of code or data supports transparency but does not by itself establish correctness or generalizability.'
    ].join(' ')
  });

  const VIEW_PROMPT_GUIDANCE = Object.freeze({
    quick_story: [
      'Keep the view blueprint-centered, while preserving complete coverage of every explicit claim that matches an enabled category.',
      'A key result should answer the central research question or primary outcome; also retain secondary, confirmatory, null, and selectivity results when they satisfy an enabled category.',
      'Do not label prior literature, routine methods or generic importance statements as this paper\'s result, strategy or novelty.'
    ].join(' '),
    mechanism_chain: [
      'Build directed relationships only from evidence in the current paper.',
      'Keep association, intervention effect, mediation, necessity, sufficiency and rescue at their distinct evidence levels.',
      'Do not infer a complete pathway from consecutive sentences that only list separate changes.'
    ].join(' '),
    critical_review: [
      'Highlight concrete design or statistical facts and text-supported concerns, not generic textbook criticism.',
      'For inferred warnings, pair the exact author claim with the exact evidence that makes the warning applicable.',
      'Absence of reporting becomes an audit item, never a fabricated highlighted sentence.'
    ].join(' '),
    review_synthesis: [
      'Distinguish the current review authors\' synthesis from results merely attributed to one cited study.',
      'Consensus and conflict require at least two distinct, comparable evidence sources tied to the same target claim.',
      'Do not infer agreement, disagreement or heterogeneity from citation counts, author-year strings or discourse markers alone.',
      'Highlight a heterogeneity source only when the authors link divergent findings to a concrete population, model, dose, endpoint, time, method, bias or context difference.',
      'Missing reporting belongs in an audit item, never a fabricated highlighted sentence.'
    ].join(' ')
  });

  const ADAPTIVE_REGEX_RULES = Object.freeze({
    known_background: Object.freeze({
      phrases: Object.freeze([
        'it is well established that', 'it is widely accepted that',
        'it is known that', 'is known to', 'are known to',
        'has long been recognized', 'has long been recognised',
        'previous work has shown', 'previous studies have shown',
        'prior studies have shown', 'a growing body of evidence'
      ]),
      expressions: Object.freeze([
        '\\b(?:is|are|was|were) well established\\b',
        '\\b(?:evidence|studies) consistently (?:shows?|indicates?|supports?)\\b'
      ])
    }),
    knowledge_gap: Object.freeze({
      phrases: Object.freeze([
        'remains unclear', 'remain unclear', 'remains unknown', 'remain unknown',
        'poorly understood', 'not fully understood', 'little is known about',
        'has yet to be determined', 'have yet to be determined',
        'is not known whether', 'it is unclear whether',
        'has not been established', 'have not been established',
        'lacks a formal definition', 'has no formal definition'
      ]),
      expressions: Object.freeze([
        '\\bit (?:is|remains) not clear (?:whether|if|how|why|when|where)\\b',
        '\\b(?:precise |exact |underlying )?mechanism remains (?:unclear|unknown)\\b',
        '\\b(?:question|issue) remains (?:unanswered|unresolved)\\b'
      ])
    }),
    study_strategy: Object.freeze({
      phrases: Object.freeze([
        'to address this question', 'to address these questions',
        'to address this gap', 'to test this hypothesis',
        'to investigate this question', 'to examine this question',
        'we combined', 'we integrated', 'we leveraged',
        'our strategy was to', 'our approach was to'
      ]),
      expressions: Object.freeze([
        '\\b(?:in this (?:study|work)|here),?\\s+we (?:combined|integrated|leveraged|applied|employed|used)\\b',
        '\\bwe (?:designed|developed) (?:a|an|the) (?:study|approach|framework|pipeline|strategy)\\b',
        '\\bwe used (?:a|an) (?:integrated|multimodal|multi-omic|multiscale) approach\\b'
      ])
    }),
    key_result: Object.freeze({
      phrases: Object.freeze([
        'the key finding', 'our key finding', 'the main finding',
        'our main finding', 'the principal finding', 'our principal finding',
        'most importantly, we found', 'most importantly, our results',
        'a central finding of this study', 'a major finding of this study',
        'one of the main findings', 'one of our main findings',
        'the primary finding', 'our primary finding',
        'most strikingly, we found',
        'a striking finding was', 'the most striking finding',
        'a major finding', 'one major finding', 'another major finding',
        'our major finding', 'the main result of this study',
        'our main result'
      ]),
      expressions: Object.freeze([
        '\\b(?:our|the) (?:key|main|principal|central) (?:finding|result) (?:is|was) that\\b',
        '\\bmost importantly,? (?:we|our (?:data|results|findings))\\b'
      ])
    }),
    significance_novelty: Object.freeze({
      phrases: Object.freeze([
        'for the first time', 'to our knowledge',
        'our findings provide new insights', 'these findings provide new insights',
        'our findings provide novel insights', 'these findings provide novel insights',
        'our study provides new insights', 'this study provides new insights',
        'a marked step towards', 'a marked step toward'
      ]),
      expressions: Object.freeze([
        '\\bthis (?:study|work) is the first to\\b',
        '\\b(?:our|these) findings (?:provide|offer) (?:new|novel|important) insights?\\b',
        '\\b(?:our|these) findings have (?:important|broad|clinical) implications\\b',
        '\\b(?:our|these) findings (?:advance|advances) our understanding\\b',
        '\\b(?:this|our|the present) (?:study|work|approach|method|findings?|results?) (?:paves?|paved) the way for\\b',
        '\\b(?:our|these|the) (?:findings?|results?) open(?:s|ed)? new avenues for\\b'
      ])
    }),
    driver_intervention: Object.freeze({
      phrases: Object.freeze([
        'following treatment with', 'after treatment with', 'in response to',
        'upon stimulation', 'upon inhibition', 'upon activation',
        'knockdown of', 'depletion of', 'deletion of', 'overexpression of',
        'pharmacological inhibition', 'genetic ablation',
        'were treated with', 'was treated with'
      ]),
      expressions: Object.freeze([
        '\\b(?:cells?|mice|animals?|patients?|participants?) (?:were|was) (?:treated|stimulated|exposed) with\\b',
        '\\bfollowing (?:treatment|stimulation|inhibition|activation)\\b'
      ])
    }),
    association_evidence: Object.freeze({
      phrases: Object.freeze([
        'associated with', 'association between', 'correlated with',
        'correlation between', 'linked to', 'relationship between',
        'covaried with'
      ]),
      expressions: Object.freeze([
        '\\b(?:positively|negatively|significantly) correlat(?:e|es|ed) with\\b',
        '\\b(?:positive|negative|significant) correlation (?:with|between)\\b'
      ])
    }),
    causal_effect: Object.freeze({
      phrases: Object.freeze([
        'caused a', 'caused an',
        'was abolished by', 'were abolished by',
        'was prevented by', 'were prevented by',
        'was blocked by', 'were blocked by'
      ]),
      expressions: Object.freeze([
        '\\b(?:treatments?|intervention|stimulation|activation|inhibition|depletion|deletion|knockdown|overexpression|exposure)[^,.;]{0,48}\\b(?:resulted in|led to|caused|induced|promoted|suppressed|reduced|increased|decreased)\\b',
        '\\b(?:caused|induced) (?:an?|the) (?:increase|decrease|reduction|response|effect|phenotype)\\b'
      ])
    }),
    mechanism_mediator: Object.freeze({
      phrases: Object.freeze([
        'is mediated by', 'was mediated by', 'are mediated by', 'were mediated by',
        'mediated through', 'acts through', 'acted through'
      ]),
      expressions: Object.freeze([
        '\\b(?:effect|response|phenotype) (?:is|was) mediated by\\b',
        '\\bthrough (?:activation|inhibition|induction|suppression) of\\b',
        '\\b(?:effect|response|phenotype|activity|progression|survival) (?:depends|depended) on\\b'
      ])
    }),
    necessity_evidence: Object.freeze({
      phrases: Object.freeze([
        'is required for', 'was required for', 'are required for', 'were required for',
        'is necessary for', 'was necessary for', 'are necessary for',
        'is essential for', 'was essential for',
        'was abolished by', 'was prevented by', 'was blocked by',
        'loss of function abolished', 'loss-of-function abolished'
      ]),
      expressions: Object.freeze([
        '\\b(?:required|necessary|essential) for (?:the )?(?:effect|response|phenotype|development|formation|maintenance)\\b',
        '\\b(?:inhibition|depletion|deletion|knockdown) (?:abolished|prevented|blocked)\\b'
      ])
    }),
    sufficiency_evidence: Object.freeze({
      phrases: Object.freeze([
        'is sufficient to', 'was sufficient to', 'are sufficient to',
        'alone is sufficient', 'alone was sufficient',
        'by itself was sufficient', 'by itself is sufficient',
        'in the absence of the upstream', 'without the upstream stimulus'
      ]),
      expressions: Object.freeze([
        '\\b(?:expression|activation|stimulation|treatment) alone (?:is|was) sufficient to\\b',
        '\\b(?:alone|by itself) (?:induced|triggered|produced|recapitulated)\\b'
      ])
    }),
    rescue_evidence: Object.freeze({
      phrases: Object.freeze([
        'rescued the', 'rescues the', 'partially rescued', 'fully rescued',
        'was rescued by', 'were rescued by', 'could be rescued by',
        'restored the', 'restores the', 'restored to control levels',
        'reversed the', 'reverses the', 'rescue experiment'
      ]),
      expressions: Object.freeze([
        '\\b(?:rescue|restoration) of (?:the )?(?:phenotype|effect|response|defect)\\b',
        '\\b(?:restored|rescued|reversed) (?:the )?(?:phenotype|effect|response|defect)\\b'
      ])
    }),
    temporal_dose_evidence: Object.freeze({
      phrases: Object.freeze([
        'dose-dependent', 'dose dependent', 'concentration-dependent',
        'concentration dependent', 'time-dependent', 'time dependent',
        'in a dose-dependent manner', 'in a time-dependent manner',
        'with increasing doses', 'with increasing concentrations',
        'dose-response relationship', 'time course'
      ]),
      expressions: Object.freeze([
        '\\b(?:dose|concentration|time)[ -]dependent\\b',
        '\\bat (?:increasing|higher) (?:doses|concentrations)\\b'
      ])
    }),
    cross_system_validation: Object.freeze({
      phrases: Object.freeze([
        'independent cohort', 'independent dataset', 'independent data set',
        'consistent across', 'in both human and mouse',
        'in both humans and mice',
        'validated in a separate', 'validated in an independent',
        'replicated in a separate', 'replicated in an independent',
        'confirmed in a separate', 'confirmed in an independent'
      ]),
      expressions: Object.freeze([
        '\\b(?:validated|confirmed|replicated) in (?:a|an) independent (?:cohort|dataset|sample|population)\\b',
        '\\bconsistent across (?:models|datasets|cohorts|species|systems)\\b',
        '\\b(?:demonstrated|confirmed|validated|observed|replicated|recapitulated|shown) (?:both )?in vitro and in vivo\\b',
        '\\b(?:both )?in vitro and in vivo (?:studies|experiments|models|results)[^,.;]{0,36}\\b(?:show|showed|demonstrate|demonstrated|confirm|confirmed|indicate|indicated|support|supported)\\b'
      ])
    }),
    mechanism_gap: Object.freeze({
      phrases: Object.freeze([
        'mechanism remains unclear', 'mechanisms remain unclear',
        'mechanism remains unknown', 'mechanisms remain unknown',
        'underlying mechanism is unknown', 'underlying mechanisms are unknown',
        'mechanistic basis remains unclear', 'mechanistic basis remains unknown',
        'mechanism has yet to be determined', 'mechanisms have yet to be determined',
        'requires further mechanistic study', 'requires further mechanistic investigation'
      ]),
      expressions: Object.freeze([
        '\\b(?:precise |exact |underlying )?mechanisms? (?:remains?|is|are) (?:unclear|unknown|unresolved)\\b',
        '\\bmechanisms? (?:by|through) which[^,.;]{0,80}\\b(?:remain|remains|is|are) (?:unclear|unknown|poorly understood)\\b'
      ])
    }),
    alternative_mechanism: Object.freeze({
      phrases: Object.freeze([
        'an alternative mechanism', 'another possible mechanism',
        'another mechanism may', 'a different mechanism',
        'an alternative pathway', 'a parallel mechanism',
        'may also be mediated by', 'might also be mediated by',
        'could instead reflect', 'may instead reflect', 'might instead reflect',
        'could instead involve', 'may instead involve'
      ]),
      expressions: Object.freeze([
        '\\b(?:may|might|could) instead (?:reflect|involve|result from)\\b'
      ])
    }),
    design_control: Object.freeze({
      phrases: Object.freeze([
        'randomized controlled', 'randomised controlled', 'double-blind',
        'double blind', 'single-blind', 'single blind', 'placebo-controlled',
        'placebo controlled', 'vehicle control', 'sham control',
        'negative control', 'positive control', 'matched controls',
        'allocation concealment'
      ]),
      expressions: Object.freeze([
        '\\bparticipants? (?:were|was) randomi[sz]ed\\b',
        '\\b(?:age|sex|baseline)[ -]matched controls?\\b'
      ])
    }),
    sample_population: Object.freeze({
      phrases: Object.freeze([
        'sample size', 'study population', 'participants were', 'patients were',
        'subjects were', 'inclusion criteria', 'exclusion criteria',
        'eligible patients', 'eligible participants',
        'cohort consisted of', 'we enrolled', 'we recruited'
      ]),
      expressions: Object.freeze([
        '\\b[nN] ?= ?\\d+\\b',
        '\\bwe (?:enrolled|recruited|included) \\d+ (?:patients|participants|subjects|mice|animals)\\b'
      ])
    }),
    measurement_validity: Object.freeze({
      phrases: Object.freeze([
        'sensitivity and specificity', 'inter-rater reliability',
        'interrater reliability', 'intra-rater reliability',
        'intrarater reliability', 'measurement error', 'validated assay',
        'validated instrument', 'limit of detection', 'limit of quantification',
        'technical replicates', 'reference standard'
      ]),
      expressions: Object.freeze([
        '\\b(?:assay|instrument|questionnaire|scale) was validated\\b',
        '\\b(?:reliability|validity) (?:was|were) assessed\\b'
      ])
    }),
    effect_uncertainty: Object.freeze({
      phrases: Object.freeze([
        'confidence interval', 'credible interval', 'effect size',
        'standard error', 'hazard ratio', 'odds ratio', 'risk ratio',
        'relative risk', 'mean difference', 'standardized mean difference',
        'standardised mean difference'
      ]),
      expressions: Object.freeze([
        '\\b95% (?:CI|confidence interval)\\b',
        '\\b(?:HR|OR|RR) ?[=:] ?\\d'
      ])
    }),
    statistical_robustness: Object.freeze({
      phrases: Object.freeze([
        'false discovery rate', 'multiple testing correction',
        'multiple comparison correction', 'adjusted p value',
        'adjusted p-value', 'sensitivity analysis', 'permutation test',
        'bootstrap analysis', 'bootstrapping', 'cross-validation',
        'cross validation', 'robustness check'
      ]),
      expressions: Object.freeze([
        '\\b(?:bonferroni|benjamini-hochberg) correction\\b',
        '\\bresults? (?:remained|were) (?:robust|significant) after\\b'
      ])
    }),
    confounding_reverse_causality: Object.freeze({
      phrases: Object.freeze([
        'residual confounding', 'potential confounding', 'unmeasured confounding',
        'reverse causality', 'confounding factors', 'adjusted for confounders',
        'cannot exclude confounding', 'cannot rule out confounding'
      ]),
      expressions: Object.freeze([
        '\\bcannot exclude (?:residual |unmeasured )?confounding\\b',
        '\\bthe possibility of reverse causality\\b'
      ])
    }),
    causal_overreach: Object.freeze({
      phrases: Object.freeze([
        'association does not imply causation',
        'association cannot establish causality',
        'causality cannot be inferred', 'cannot infer causality',
        'does not prove causation', 'precludes causal inference',
        'observational design precludes', 'cannot establish causality',
        'cannot determine causality', 'unable to establish causality',
        'does not allow causal inference', 'cannot draw causal conclusions',
        'causal relationship cannot be established',
        'causal direction cannot be determined',
        'causal direction is unclear', 'causal direction remains unclear',
        'limits causal inference', 'limit causal inference',
        'restricts causal inference', 'restrict causal inference',
        'constrains causal inference', 'constrain causal inference',
        'limits causal interpretation', 'limit causal interpretation'
      ]),
      expressions: Object.freeze([
        '\\b(?:cannot|could not) (?:establish|infer|determine) causality\\b',
        '\\bno causal (?:claim|conclusion|inference) can be made\\b',
        '\\b(?:observational|cross-sectional) design (?:limits|restricts|precludes) causal (?:inference|interpretation)\\b',
        '\\bcausal inferences? should (?:still )?be interpreted with caution\\b',
        '\\bdoes not allow (?:for )?(?:strong )?causal inference\\b'
      ])
    }),
    alternative_explanation: Object.freeze({
      phrases: Object.freeze([
        'alternative explanation', 'another explanation',
        'may reflect', 'might reflect', 'could reflect',
        'could be explained by', 'may be explained by',
        'may be attributable to', 'might be attributable to'
      ]),
      expressions: Object.freeze([
        '\\b(?:may|might|could) instead be (?:due|attributable) to\\b',
        '\\b(?:one|another) possible explanation (?:is|was)\\b'
      ])
    }),
    replication_external_validation: Object.freeze({
      phrases: Object.freeze([
        'external validation cohort', 'external validation dataset',
        'independent validation cohort', 'independent validation dataset',
        'replication cohort', 'validation cohort',
        'validated using an independent', 'validated in an independent',
        'for independent validation that'
      ]),
      expressions: Object.freeze([
        '\\b(?:validated|replicated|reproduced) in (?:a|an) independent (?:cohort|dataset|sample|population)\\b',
        '\\bexternally validated (?:in|using)\\b'
      ])
    }),
    generalizability: Object.freeze({
      phrases: Object.freeze([
        'may not generalize', 'may not generalise',
        'might not generalize', 'might not generalise',
        'limited generalizability', 'limited generalisability',
        'external validity', 'generalizable to', 'generalisable to',
        'applicability to other'
      ]),
      expressions: Object.freeze([
        '\\b(?:results|findings) (?:may|might) not be generali[sz]able\\b',
        '\\bthe generali[sz]ability of (?:these|our) findings\\b'
      ])
    }),
    statistical_vs_practical_significance: Object.freeze({
      phrases: Object.freeze([
        'clinically meaningful', 'practical significance',
        'biologically meaningful', 'statistically significant but',
        'despite statistical significance', 'not clinically meaningful',
        'not clinically significant', 'not biologically meaningful'
      ]),
      expressions: Object.freeze([
        '\\bstatistical significance does not (?:necessarily )?imply\\b',
        '\\b(?:small|modest) effect despite (?:statistical )?significance\\b'
      ])
    }),
    transparency_reproducibility: Object.freeze({
      phrases: Object.freeze([
        'data are available', 'data is available', 'code is available',
        'source code is available', 'publicly available repository',
        'preregistered', 'pre-registered', 'registered protocol',
        'analysis plan', 'reporting guideline', 'reproducible workflow',
        'materials are available', 'protocol is available'
      ]),
      expressions: Object.freeze([
        '\\b(?:data|code|materials|protocols?) (?:is|are) (?:publicly )?available\\b',
        '\\b(?:scripts?|code) (?:is|are) available (?:at|from|on)\\b'
      ])
    }),
    review_scope_thesis: Object.freeze({
      phrases: Object.freeze([
        'this review summarizes', 'this review summarises',
        'this review discusses', 'this review examines',
        'this review focuses on', 'we review',
        'we provide an overview', 'the aim of this review',
        'the purpose of this review'
      ]),
      expressions: Object.freeze([
        '\\bthis (?:review|article) (?:provides|presents) (?:a|an) (?:overview|synthesis)\\b',
        '\\bwe (?:summari[sz]e|synthesize|synthesise) (?:the|current) evidence\\b'
      ])
    }),
    evidence_consensus: Object.freeze({
      phrases: Object.freeze([
        'consistent evidence', 'evidence consistently',
        'broad consensus', 'general consensus', 'there is consensus',
        'multiple studies have shown', 'studies consistently show',
        'converging evidence', 'convergent evidence'
      ]),
      expressions: Object.freeze([
        '\\bthe literature consistently (?:shows|indicates|supports)\\b',
        '\\bfindings (?:are|were) consistent across (?:studies|cohorts|datasets)\\b'
      ])
    }),
    conflicting_evidence: Object.freeze({
      phrases: Object.freeze([
        'conflicting evidence', 'inconsistent findings', 'mixed results',
        'contradictory findings', 'studies have yielded conflicting',
        'remains controversial', 'remain controversial',
        'is controversial', 'are controversial', 'debate remains'
      ]),
      expressions: Object.freeze([
        '\\b(?:evidence|results|findings) (?:is|are|were) (?:mixed|inconsistent|conflicting)\\b',
        '\\bstudies (?:have )?(?:reported|produced|yielded) (?:mixed|inconsistent|conflicting) (?:results|findings)\\b'
      ])
    }),
    heterogeneity_source: Object.freeze({
      phrases: Object.freeze([
        'between-study heterogeneity', 'between study heterogeneity',
        'heterogeneity may be due to', 'heterogeneity could reflect',
        'sources of heterogeneity', 'source of heterogeneity',
        'heterogeneity was driven by', 'heterogeneity is driven by',
        'heterogeneity can be explained by', 'heterogeneity was explained by',
        'between-study differences'
      ]),
      expressions: Object.freeze([
        '\\bheterogeneity (?:arose|arises|resulted) from\\b',
        '\\bvariability across (?:studies|cohorts|populations|assays|models)\\b',
        '\\b(?:population|methodological|clinical|design) differences (?:accounted for|explained|drove) (?:the )?heterogeneity\\b'
      ])
    }),
    evidence_quality_certainty: Object.freeze({
      phrases: Object.freeze([
        'quality of evidence', 'certainty of evidence',
        'low-certainty evidence', 'low certainty evidence',
        'moderate-certainty evidence', 'moderate certainty evidence',
        'high-certainty evidence', 'high certainty evidence',
        'risk of bias', 'publication bias', 'GRADE assessment'
      ]),
      expressions: Object.freeze([
        '\\bthe evidence was rated as (?:very low|low|moderate|high) certainty\\b',
        '\\b(?:low|moderate|high) quality evidence\\b'
      ])
    }),
    integrative_framework: Object.freeze({
      phrases: Object.freeze([
        'conceptual framework', 'integrative framework',
        'unifying framework', 'working model', 'unified model',
        'we propose a model', 'we propose a framework',
        'provides a framework', 'integrated model'
      ]),
      expressions: Object.freeze([
        '\\b(?:this|the) framework integrates\\b',
        '\\bwe propose (?:a|an) (?:integrative|unifying|conceptual) (?:model|framework)\\b'
      ])
    }),
    author_synthesis: Object.freeze({
      phrases: Object.freeze([
        'we conclude that', 'we propose that', 'we argue that',
        'we suggest that', 'taken together', 'collectively, these studies',
        'collectively, the evidence', 'overall, the evidence',
        'in our view', 'we synthesize', 'we synthesise'
      ]),
      expressions: Object.freeze([
        '\\bbased on (?:the|this|these) (?:evidence|literature|findings),? we\\b',
        '\\bwe synthesi[sz]e (?:these|the) findings\\b'
      ])
    })
  });

  function defineCategory(input) {
    return Object.freeze({
      categoryId: input.categoryId,
      name: input.name,
      definition: input.definition,
      decisionQuestion: input.decisionQuestion,
      includeAll: [...input.includeAll],
      excludeAny: [...input.excludeAny],
      requiredSlots: [...input.requiredSlots],
      allowedQuoteRoles: [...input.allowedQuoteRoles],
      positiveExamples: [...input.positiveExamples],
      hardNegativeExamples: [...input.hardNegativeExamples],
      includeWhen: [...input.includeAll],
      excludeWhen: [...input.excludeAny],
      negativeExamples: [...input.hardNegativeExamples],
      spanPolicy: input.spanPolicy || 'clause',
      minimumConfidence: Number(input.minimumConfidence) || 0.8,
      claimMode: input.claimMode || 'explicit',
      relationRequired: Boolean(input.relationRequired),
      enabledEngines: (input.regex?.phrases?.length || input.regex?.expressions?.length)
        ? ['llm', 'regex'] : ['llm'],
      regex: Object.freeze({
        phrases: Object.freeze([...(input.regex?.phrases || [])]),
        expressions: Object.freeze([...(input.regex?.expressions || [])]),
        caseSensitive: Boolean(input.regex?.caseSensitive),
        wholeWord: input.regex?.wholeWord !== false
      }),
      color: input.color,
      version: Number(input.version) || 1,
      persistence: 'saved',
      builtIn: true
    });
  }

  function makeCase({
    id, name, definition, question, include, exclude, slots, roles,
    positive, negative, color, minimumConfidence = 0.8,
    claimMode = 'explicit', relationRequired = false, version = 1
  }) {
    return defineCategory({
      categoryId: id,
      name,
      definition,
      decisionQuestion: question,
      includeAll: include,
      excludeAny: exclude,
      requiredSlots: slots,
      allowedQuoteRoles: roles,
      positiveExamples: [positive],
      hardNegativeExamples: [negative],
      spanPolicy: 'clause',
      minimumConfidence,
      claimMode,
      relationRequired,
      regex: {
        ...(ADAPTIVE_REGEX_RULES[id] || {}),
        caseSensitive: false,
        wholeWord: true
      },
      version,
      color
    });
  }

  const CASES = [
    {
      id: 'scientific_question', name: '科学问题', color: '#7C3AED',
      definition: '作者明确提出本研究要回答的未知、问题、目标或可检验假设；合并旧的缺口、目的和假设入口。',
      question: '原文是否明确说明本研究要弄清什么，而不是只说做了什么或发现什么？',
      include: ['可定位的未知关系、研究问题、目的或待检验命题', '明确与当前研究有关'],
      exclude: ['一般重要性或背景事实', '只有操作步骤或已经得到的结果', '本文之后才拟开展的研究'],
      slots: ['research_question'], roles: ['question_statement'],
      positive: 'We sought to determine whether neuronal activity is required for synapse elimination.',
      negative: 'We quantified synapses using confocal microscopy.'
    },
    {
      id: 'review_question', name: '存疑点（原文）', color: '#B45309',
      definition: '作者在原文明确承认的解释不确定性、证据疑点、替代解释或尚未排除的偏倚；不包括 AI 自行提出的质疑。',
      question: '是否能直接引用作者对具体证据或结论保留疑问的原句，而无需补写未提到的信息？',
      include: ['明确的担忧、未排除的解释或不确定性', '指向具体结论、证据、设计或适用范围'],
      exclude: ['由未提到某方法推断作者没有做', 'AI 的审稿问题或外部知识补充', '普通研究问题或后续工作但未表述疑点'],
      slots: ['concern'], roles: ['concern_statement'],
      positive: 'We cannot exclude that the apparent benefit reflects differences in baseline disease severity.',
      negative: 'Baseline disease severity was recorded for all participants.'
    },
    {
      id: 'known_background', name: '已知背景', color: '#7EA8BE',
      definition: '论文用于建立问题语境的公认知识。',
      question: '该片段是否陈述研究开始前已知且与当前问题直接相关的知识？',
      include: ['陈述既有知识', '与当前研究问题相关'],
      exclude: ['当前研究新结果', '仅有宽泛常识'],
      slots: [], roles: ['background_statement'], version: 2,
      positive: 'Microglia eliminate synapses during development.',
      negative: 'We found that microglia eliminated synapses after treatment.'
    },
    {
      id: 'knowledge_gap', name: '知识缺口', color: '#E07A5F',
      definition: '作者明确指出尚未知、不一致或未解决的问题。',
      question: '是否明确存在未知、不一致或缺乏验证，并构成当前研究理由？',
      include: ['明确未知或争议', '与研究问题相关'],
      exclude: ['只说研究很重要', '当前实验尚未完成'],
      slots: ['unknown_question', 'scope'], roles: ['gap_statement'],
      positive: 'How neuronal activity recruits complement remains unknown.',
      negative: 'Neuronal activity is important for brain function.'
    },
    {
      id: 'study_strategy', name: '研究策略', color: '#81B29A',
      definition: '用于回答主要问题的总体设计路线。',
      question: '是否概括研究系统、核心干预或比较及主要结局，而非罗列操作步骤？',
      include: ['包含总体设计', '直接服务主要问题'],
      exclude: ['缓冲液或仪器细节', '单一测量步骤'],
      slots: ['system', 'core_design', 'primary_outcome'], roles: ['strategy_statement'],
      positive: 'We combined chemogenetic manipulation with imaging to test activity-dependent synapse loss.',
      negative: 'Sections were washed three times in PBS.'
    },
    {
      id: 'key_result', name: '关键结果', color: '#F2CC8F',
      definition: '直接回答研究问题或支撑主结论的主要发现。',
      question: '该结果是否检验核心假设、对应主要结局或被主结论依赖？',
      include: ['当前研究结果', '直接关联蓝图主要问题'],
      exclude: ['次要质量控制结果', '仅因统计显著'],
      slots: ['finding', 'primary_outcome', 'blueprint_link'], roles: ['key_finding'],
      positive: 'C1q blockade prevented activity-induced loss of VGLUT2 terminals.',
      negative: 'Body weight differed significantly on day 2.'
    },
    {
      id: 'significance_novelty', name: '创新点（作者声明）', color: '#F4A261', version: 2,
      definition: '作者明确陈述研究贡献、新颖性或对领域的影响。',
      question: '是否说明本研究新增了什么认识或改变了什么解释框架？',
      include: ['明确贡献或新颖性', '基于当前研究'],
      exclude: ['一般重要性口号', '未来工作建议'],
      slots: ['contribution'], roles: ['significance_statement'],
      positive: 'These data reveal an immune mechanism linking activity to synapse refinement.',
      negative: 'We hypothesized that the intervention would reveal a new mechanism.'
    },
    {
      id: 'driver_intervention', name: '起始因素或干预', color: '#F4A261',
      definition: '机制链中的起始暴露、扰动或实验干预。',
      question: '是否明确改变、比较或暴露了可作为关系起点的因素？',
      include: ['明确因素或干预', '可作为关系起点'],
      exclude: ['只提到背景分子', '没有改变或暴露'],
      slots: ['source_factor', 'manipulation'], roles: ['driver_statement'],
      positive: 'We increased neuronal activity using hM3Dq.',
      negative: 'Neuronal activity is widely studied.', relationRequired: true
    },
    {
      id: 'association_evidence', name: '相关性证据', color: '#E9C46A',
      definition: '变量共同变化但未建立干预因果的证据。',
      question: '是否报告变量间关联，同时缺少足以支持因果的操纵？',
      include: ['至少两个变量', '明确关联或共同变化'],
      exclude: ['随机或机制干预直接改变结局', '只有单变量描述'],
      slots: ['variable_a', 'variable_b', 'association'], roles: ['association_statement'],
      positive: 'C1q abundance correlated with synapse loss.',
      negative: 'C1q blockade prevented synapse loss.', relationRequired: true
    },
    {
      id: 'causal_effect', name: '因果效应', color: '#E76F51',
      definition: '干预或明确机制作用导致目标结局改变。',
      question: '是否有干预、方向明确的结果和支持因果的设计？',
      include: ['作用因素或干预', '目标结局及方向'],
      exclude: ['只有相关性', 'as shown in 等非因果用法'],
      slots: ['source', 'relation', 'target', 'evidence_type'],
      roles: ['cause_statement', 'effect_statement'],
      positive: 'Neuronal activation caused increased C1q deposition.',
      negative: 'As shown in Fig. 1, C1q deposition increased.', relationRequired: true
    },
    {
      id: 'mechanism_mediator', name: '机制中介', color: '#D264B6',
      definition: '连接上游因素与下游结局的中介过程或实体。',
      question: '是否有证据把候选中介放在上游与下游之间？',
      include: ['上游因素', '候选中介', '下游结局'],
      exclude: ['只描述候选分子变化', '没有链式联系'],
      slots: ['upstream', 'mediator', 'downstream'],
      roles: ['upstream_statement', 'mediator_statement', 'downstream_statement'],
      positive: 'Activity increased C1q, which mediated subsequent synapse loss.',
      negative: 'C1q levels increased after treatment.', relationRequired: true
    },
    {
      id: 'necessity_evidence', name: '必要性证据', color: '#C77DFF',
      definition: '阻断或移除候选中介后，上游因素对目标结局的效应消失或明显减弱。',
      question: '是否同时存在上游因素、中介阻断、同一目标结局以及效应减弱？',
      include: ['存在候选中介的阻断或移除', '比较阻断前后同一目标结局', '原有效应消失或显著减弱'],
      exclude: ['只有中介与结局相关', '只有敲除组与对照组差异', '没有原始上游效应作为参照'],
      slots: ['upstream_factor', 'blocked_mediator', 'target_outcome', 'effect_reduction'],
      roles: ['upstream_effect', 'blocked_mediator', 'reduced_outcome'],
      positive: 'Blocking C1q abolished activity-induced loss of VGLUT2 terminals.',
      negative: 'C1q-deficient mice had more VGLUT2 terminals than controls.', relationRequired: true
    },
    {
      id: 'sufficiency_evidence', name: '充分性证据', color: '#9D4EDD',
      definition: '缺少原始上游刺激时，单独激活候选中介仍产生目标效应。',
      question: '是否明确表明单独激活候选中介即可产生目标结局？',
      include: ['候选中介被单独激活或加入', '原始上游刺激不存在', '出现目标结局'],
      exclude: ['候选中介与上游刺激同时存在', '只有相关性', '未报告目标结局'],
      slots: ['activated_mediator', 'absent_upstream_stimulus', 'target_outcome'],
      roles: ['mediator_activation', 'upstream_absence', 'induced_outcome'],
      positive: 'C1q administration alone reduced VGLUT2 terminal density without neuronal stimulation.',
      negative: 'C1q increased after neuronal stimulation.', relationRequired: true
    },
    {
      id: 'rescue_evidence', name: 'Rescue/逆转证据', color: '#7B2CBF',
      definition: '补救动作使初始扰动造成的同一异常结局恢复或减轻。',
      question: '是否存在初始扰动、异常结局、独立补救动作和同一结局的恢复？',
      include: ['存在初始扰动及异常结局', '存在补救动作', '同一结局恢复或显著减轻'],
      exclude: ['只有普通治疗改善', '补救前没有相关异常', '比较的是不同结局'],
      slots: ['initial_perturbation', 'abnormal_outcome', 'rescue_action', 'rescued_outcome'],
      roles: ['initial_abnormality', 'rescue_action', 'rescued_outcome'],
      positive: 'Re-expression of C1q restored synapse loss in the knockout model.',
      negative: 'Drug treatment improved survival compared with vehicle.', relationRequired: true
    },
    {
      id: 'temporal_dose_evidence', name: '时间与剂量证据', color: '#2A9D8F',
      definition: '时间先后或剂量反应支持关系方向。',
      question: '是否明确报告先后顺序、时间轨迹或随剂量变化的结局？',
      include: ['时间或剂量维度', '同一关系结局'],
      exclude: ['只有单一时间点', '剂量仅属于方法描述'],
      slots: ['factor', 'time_or_dose', 'outcome'], roles: ['time_dose_statement'],
      positive: 'C1q increased before synapse loss and rose with stimulation duration.',
      negative: 'Mice received 2 mg/kg CNO.', relationRequired: true
    },
    {
      id: 'cross_system_validation', name: '跨体系验证', color: '#00A896',
      definition: '同一主张在不同模型、物种、队列或测量体系中得到验证。',
      question: '是否在独立体系检验同一方向的主张？',
      include: ['至少两个独立体系', '同一核心主张'],
      exclude: ['同一样本的技术重复', '只换测量单位'],
      slots: ['claim', 'system_a', 'system_b'], roles: ['primary_system', 'validation_system'],
      positive: 'The effect was reproduced in mice and independent human tissue.',
      negative: 'The same mouse sections were imaged twice.', relationRequired: true
    },
    {
      id: 'mechanism_gap', name: '机制缺口', color: '#8E7DBE',
      definition: '作者明确承认机制链中尚未解决的环节。',
      question: '是否明确指出具体机制环节仍未知或未被本研究检验？',
      include: ['明确未解决环节', '属于机制链'],
      exclude: ['一般局限', 'AI 根据缺失信息推测'],
      slots: ['unresolved_link', 'scope'], roles: ['gap_statement'],
      positive: 'How C1q recruits downstream phagocytes remains unresolved.',
      negative: 'The sample size was small.'
    },
    {
      id: 'alternative_mechanism', name: '替代机制', color: '#B56576',
      definition: '作者提出可解释同一结果的不同生物机制。',
      question: '是否提出与主机制不同且能解释相同发现的机制？',
      include: ['替代机制', '同一观察结果'],
      exclude: ['主机制重述', '无依据的宽泛可能性'],
      slots: ['observed_result', 'alternative_mechanism'], roles: ['result_statement', 'alternative_statement'],
      positive: 'The effect may instead reflect altered inhibitory input.',
      negative: 'The mechanism may be complex.', relationRequired: true
    },
    {
      id: 'design_control', name: '关键设计与对照', color: '#457B9D',
      definition: '决定因果或比较解释力的研究设计与关键对照。',
      question: '是否描述随机化、盲法、匹配、阴阳性对照或核心比较框架？',
      include: ['关键设计或对照', '影响解释力'],
      exclude: ['普通操作步骤', '没有比较作用'],
      slots: ['design_element', 'comparison_or_control'], roles: ['design_statement'],
      positive: 'Animals were randomized and outcome assessors were blinded.',
      negative: 'Sections were mounted on slides.'
    },
    {
      id: 'sample_population', name: '样本与人群边界', color: '#577590',
      definition: '样本来源、纳入范围和代表性边界。',
      question: '是否说明研究对象是谁以及该样本限制了哪些推论？',
      include: ['样本或人群定义', '与适用范围相关'],
      exclude: ['单纯样本编号', '无边界意义'],
      slots: ['population', 'sampling_scope'], roles: ['population_statement'],
      positive: 'Participants were treatment-naive adults from one tertiary center.',
      negative: 'Sample 17 was stored at minus 80 degrees.'
    },
    {
      id: 'measurement_validity', name: '测量有效性', color: '#4D908E',
      definition: '测量、指标或参考标准能否有效代表目标构念。',
      question: '是否评价测量与目标构念、参考标准或误差之间的关系？',
      include: ['测量或指标', '效度或误差依据'],
      exclude: ['只说明使用仪器', '没有效度信息'],
      slots: ['construct', 'measurement', 'validity_basis'], roles: ['measurement_statement'],
      positive: 'The assay was validated against the clinical reference standard.',
      negative: 'Fluorescence was measured with a microscope.'
    },
    {
      id: 'effect_uncertainty', name: '效应量与不确定性', color: '#43AA8B',
      definition: '效应大小及其置信区间、后验区间或精度。',
      question: '是否同时报告可解释的效应量和不确定性？',
      include: ['效应大小', '不确定性范围'],
      exclude: ['只有 p 值', '只有方向无大小'],
      slots: ['effect_measure', 'estimate', 'uncertainty'], roles: ['effect_statement'],
      positive: 'The hazard ratio was 0.72 with a 95% confidence interval of 0.61 to 0.84.',
      negative: 'The result was significant at p below 0.05.'
    },
    {
      id: 'statistical_robustness', name: '统计稳健性', color: '#90BE6D',
      definition: '模型假设、多重检验、敏感性分析或稳健性检查。',
      question: '是否提供能检验统计结论稳定性的分析或限制？',
      include: ['统计风险或稳健性检查', '关联当前结论'],
      exclude: ['只给软件名称', '普通显著性报告'],
      slots: ['analysis_risk', 'robustness_action'], roles: ['robustness_statement'],
      positive: 'The association persisted across prespecified sensitivity analyses after multiplicity correction.',
      negative: 'Analyses were performed in R.'
    },
    {
      id: 'confounding_reverse_causality', name: '混杂与反向因果', color: '#F94144',
      definition: '证据可能受未控制混杂或因果方向倒置影响。',
      question: '原文证据是否支持某个具体混杂因素或反向方向能够解释结果？',
      include: ['明确暴露与结局', '具体混杂或反向路径', '有原文证据'],
      exclude: ['仅因研究是观察性就自动警告', '没有具体替代路径'],
      slots: ['exposure', 'outcome', 'bias_path'], roles: ['claim', 'evidence'],
      positive: 'Disease severity may increase both treatment exposure and the measured outcome.',
      negative: 'Observational studies can have confounding.',
      claimMode: 'inferred', minimumConfidence: 0.9, relationRequired: true
    },
    {
      id: 'causal_overreach', name: '因果过度推断', color: '#D90429',
      definition: '作者因果措辞强于研究设计或结果证据。',
      question: '是否能用结论原文和证据原文证明因果强度超过证据强度？',
      include: ['因果性结论原文', '较弱证据原文'],
      exclude: ['已有随机或机制干预证据', '只有措辞判断无证据引用'],
      slots: ['claim_strength', 'evidence_strength'], roles: ['claim', 'evidence'],
      positive: 'The cohort association was described as proving that exposure causes disease.',
      negative: 'A randomized intervention changed the prespecified outcome.',
      claimMode: 'inferred', minimumConfidence: 0.9, relationRequired: true
    },
    {
      id: 'alternative_explanation', name: '替代解释', color: '#EF233C',
      definition: '原文证据支持但作者未充分排除的其他解释。',
      question: '是否存在具体且由原文支持的替代解释，而非通用猜测？',
      include: ['目标发现', '具体替代解释', '原文支持'],
      exclude: ['泛泛而谈', '与研究内容无关'],
      slots: ['finding', 'alternative', 'support'], roles: ['claim', 'evidence'],
      positive: 'The apparent treatment effect may reflect baseline disease severity imbalance.',
      negative: 'Other explanations are possible.',
      claimMode: 'inferred', minimumConfidence: 0.9, relationRequired: true
    },
    {
      id: 'replication_external_validation', name: '复现与外部验证', color: '#277DA1',
      definition: '独立样本、队列、实验室或数据集中的重复验证。',
      question: '是否使用独立来源验证相同主张并区分内部重复？',
      include: ['独立验证来源', '同一主张'],
      exclude: ['训练集内部交叉验证冒充外部验证', '技术重复'],
      slots: ['claim', 'validation_source', 'result'], roles: ['discovery_statement', 'validation_statement'],
      positive: 'The model retained calibration in an independent external cohort.',
      negative: 'Performance was estimated by cross-validation in the training cohort.'
    },
    {
      id: 'generalizability', name: '外推边界', color: '#6A4C93',
      definition: '研究结果适用于哪些人群、系统或情境的边界。',
      question: '是否明确说明当前证据不能直接外推到某类对象或环境？',
      include: ['目标外推范围', '证据边界'],
      exclude: ['只说需要更多研究', '没有适用范围'],
      slots: ['evidence_population', 'target_population', 'boundary'], roles: ['boundary_statement'],
      positive: 'Findings from young male mice may not generalize to aged females or humans.',
      negative: 'More work is needed.'
    },
    {
      id: 'statistical_vs_practical_significance', name: '统计意义与实际意义', color: '#F8961E',
      definition: '区分统计显著与生物学或临床重要性。',
      question: '是否比较统计结果与效应大小、临床阈值或生物学意义？',
      include: ['统计证据', '实际意义标准'],
      exclude: ['只有 significant 一词', '只有效应方向'],
      slots: ['statistical_result', 'practical_threshold'], roles: ['statistical_statement', 'practical_statement'],
      positive: 'The difference was statistically significant but below the prespecified clinically important threshold.',
      negative: 'The difference was statistically significant.'
    },
    {
      id: 'transparency_reproducibility', name: '数据与方法透明度', color: '#577590',
      definition: '数据、代码、预注册、协议和复现材料的可用性。',
      question: '是否明确说明关键复现材料可用、受限或缺失？',
      include: ['复现材料或预注册信息', '可用性状态'],
      exclude: ['普通方法引用', '作者单位信息'],
      slots: ['resource', 'availability'], roles: ['transparency_statement'],
      positive: 'Analysis code and deidentified data are available in the stated repository.',
      negative: 'We used a previously published method.'
    }
  ];

  const REVIEW_CASES = [
    {
      id: 'review_scope_thesis', name: '综述范围与中心命题', color: '#4C78A8', version: 2,
      definition: '综述作者明确界定覆盖对象、主题边界、中心问题或核心论点。',
      question: '该片段是否同时说明综述覆盖什么，以及围绕什么中心问题或命题组织证据？',
      include: ['明确综述对象或边界', '明确中心问题、命题或组织轴'],
      exclude: ['普通背景事实或标题重复', '宽泛地说本文将回顾但未界定范围'],
      slots: ['review_scope', 'central_question_or_thesis'], roles: ['scope_statement'],
      positive: 'This review examines how microglial states shape synapse loss across development and neurodegeneration, focusing on complement-dependent mechanisms.',
      negative: 'In this article, we review recent advances in neuroscience.',
      minimumConfidence: 0.85
    },
    {
      id: 'evidence_consensus', name: '一致证据', color: '#54A24B', version: 2,
      definition: '至少两个可区分的研究或证据体系对同一可比主张给出方向一致的结果。',
      question: '是否存在两个不同证据来源，对同一对象和结局给出可比较且同方向的支持？',
      include: ['至少两个不同证据来源', '同一目标主张且方向一致'],
      exclude: ['只有 many studies 等模糊数量词', '单篇研究结果或不可比较的不同结局'],
      slots: ['target_claim', 'evidence_a_direction', 'evidence_b_direction'],
      roles: ['evidence_a', 'evidence_b', 'synthesis_statement'],
      positive: 'Both prospective cohorts and independent animal models consistently associate sustained inflammation with synapse loss.',
      negative: 'Several studies have examined inflammation.',
      minimumConfidence: 0.9, relationRequired: true
    },
    {
      id: 'conflicting_evidence', name: '矛盾证据', color: '#E45756', version: 2,
      definition: '至少两个证据来源针对同一问题或可比结局报告相反、不一致、未复现或条件依赖结果。',
      question: '是否能指出两个不同证据来源在同一可比主张上的不同方向，并说明比较基础？',
      include: ['至少两条不同且可定位的证据', '同一目标主张的相反或条件依赖方向'],
      exclude: ['只依赖 however、while 或 as 等连接词', '不同研究回答不同问题或使用不可比结局'],
      slots: ['target_claim', 'evidence_a_direction', 'evidence_b_direction', 'contrast_basis'],
      roles: ['evidence_a', 'evidence_b', 'synthesis_statement'],
      positive: 'One cohort linked high C1q to decline, whereas a matched cohort found no association using the same endpoint.',
      negative: 'Study A measured C1q, while Study B measured neuronal activity.',
      minimumConfidence: 0.9, relationRequired: true
    },
    {
      id: 'heterogeneity_source', name: '异质性来源', color: '#F58518', version: 2,
      definition: '综述作者把分歧明确归因于人群、模型、剂量、终点、时间窗、方法、偏倚或情境差异。',
      question: '片段是否同时指出分歧结果以及一个具体、可核查的差异轴作为解释？',
      include: ['明确存在分歧或异质结果', '明确具体差异轴及至少两个情境'],
      exclude: ['只报告 I² 或笼统说存在异质性', '只列研究特征但未连接到分歧'],
      slots: ['divergent_finding', 'difference_axis', 'context_a', 'context_b'],
      roles: ['divergence_statement', 'explanation_statement'],
      positive: 'The discrepant effects may reflect acute dosing in rodent studies versus chronic exposure in human cohorts.',
      negative: 'Substantial heterogeneity was observed (I²=78%).',
      minimumConfidence: 0.85, relationRequired: true
    },
    {
      id: 'evidence_quality_certainty', name: '证据质量与确定性', color: '#B279A2', version: 2,
      definition: '对证据体的风险偏倚、设计质量、精确性、一致性、直接性、发表偏倚或总体确定性作出判断。',
      question: '作者是否依据明确质量维度评价某一证据体的可信度或确定性？',
      include: ['明确证据体', '明确质量维度和确定性判断'],
      exclude: ['只有样本量、p 值或 significant', '没有评价对象的宽泛方法学提醒'],
      slots: ['evidence_body', 'quality_dimension', 'certainty_judgment'],
      roles: ['quality_statement'],
      positive: 'Certainty is low because most estimates are imprecise and derived from studies at high risk of selection bias.',
      negative: 'The pooled effect was statistically significant.',
      minimumConfidence: 0.85
    },
    {
      id: 'integrative_framework', name: '概念框架', color: '#72B7B2', version: 2,
      definition: '综述作者把跨研究知识组织为机制模型、阶段、亚型、路径、分类法或概念图式。',
      question: '该片段是否提出一个用于组织多项文献的明确框架结构，而不是简单罗列主题？',
      include: ['覆盖多个证据或主题', '给出阶段、亚型、路径或其他结构关系'],
      exclude: ['只列举多个主题', '只复述单篇研究的机制'],
      slots: ['organized_domain', 'framework_structure'], roles: ['framework_statement'],
      positive: 'We organize microglial responses into initiation, amplification and resolution phases that link molecular states to distinct outcomes.',
      negative: 'Microglia affect synapses, metabolism and inflammation.',
      minimumConfidence: 0.85
    },
    {
      id: 'author_synthesis', name: '作者综合判断', color: '#9D755D', version: 2,
      definition: '当前综述作者跨多个证据来源得出的平衡性结论，并保留适用条件或证据边界。',
      question: '这是否是综述作者基于一个证据范围作出的综合判断，而非单篇研究原结论？',
      include: ['明确综合多个证据来源或证据体', '给出平衡结论或条件边界'],
      exclude: ['单篇被引研究的结果', '没有综合依据的个人主张'],
      slots: ['evidence_scope', 'balanced_conclusion'], roles: ['synthesis_statement'],
      positive: 'Taken together, the evidence supports a context-dependent role for complement, but is insufficient to establish benefit in humans.',
      negative: 'Smith et al. concluded that complement causes synapse loss.',
      minimumConfidence: 0.85
    }
  ];

  const ADAPTIVE_ONLY = Object.freeze(Object.fromEntries(
    [...CASES, ...REVIEW_CASES].map(input => {
      const category = makeCase(input);
      return [category.categoryId, category];
    })
  ));

  function createAdaptiveCategoryCatalog() {
    const base = typeof shared.createBuiltInCategories === 'function'
      ? shared.createBuiltInCategories() : {};
    return { ...base, ...ADAPTIVE_ONLY };
  }

  function createUnifiedCategoryCatalog(overrides = {}) {
    if (typeof shared.toUnifiedCategory !== 'function' ||
        typeof shared.mergeCategoryOverrides !== 'function') {
      throw new Error('Category store must be loaded before adaptive catalog');
    }
    return Object.fromEntries(
      Object.entries(createAdaptiveCategoryCatalog()).map(([categoryId, category]) => [
        categoryId,
        shared.mergeCategoryOverrides(
          shared.toUnifiedCategory(category),
          overrides?.[categoryId] || {}
        )
      ])
    );
  }

  function isStudyType(value) {
    return Object.prototype.hasOwnProperty.call(STUDY_TYPES, value);
  }

  function isReadingView(value) {
    return Object.prototype.hasOwnProperty.call(READING_VIEWS, value);
  }

  function composeReadingView({
    viewId,
    viewDefinition = null,
    studyProfile,
    override,
    customCategories = [],
    categoryOverrides = {},
    deletedBuiltInCategoryIds = [],
    engine = ''
  }) {
    const suppliedView = viewDefinition && typeof viewDefinition === 'object' &&
      Array.isArray(viewDefinition.categoryIds)
      ? {
          id: String(viewDefinition.id || viewId || 'custom_mode'),
          name: String(viewDefinition.name || ''),
          description: String(viewDefinition.description || ''),
          categoryIds: viewDefinition.categoryIds.map(String)
        }
      : null;
    const normalizedViewId = suppliedView?.id ||
      (isReadingView(viewId) ? viewId : 'quick_story');
    const view = suppliedView || READING_VIEWS[normalizedViewId];
    const primaryOverlay = TYPE_OVERLAYS[studyProfile?.primaryType]?.[normalizedViewId] || [];
    const secondaryOverlay = TYPE_OVERLAYS[studyProfile?.secondaryType]?.[normalizedViewId] || [];
    const primary = suppliedView || studyProfile?.useTypeSpecificWarnings === false
      ? [] : [...primaryOverlay];
    const secondary = suppliedView || studyProfile?.useTypeSpecificWarnings === false
      ? [] : [...secondaryOverlay].slice(0, 4);
    const add = !suppliedView && Array.isArray(override?.add) ? override.add.map(String) : [];
    const remove = new Set(!suppliedView && Array.isArray(override?.remove) ? override.remove.map(String) : []);
    const deletedBuiltIns = new Set(
      Array.isArray(deletedBuiltInCategoryIds)
        ? deletedBuiltInCategoryIds.map(String)
        : []
    );
    const customMap = Object.fromEntries(
      customCategories.filter(Boolean).map(category => {
        const unified = typeof shared.toUnifiedCategory === 'function'
          ? shared.flattenUnifiedCategory(shared.toUnifiedCategory(category))
          : category;
        return [unified.categoryId, unified];
      })
    );
    const catalog = { ...createUnifiedCategoryCatalog(categoryOverrides), ...customMap };
    const ordered = [...view.categoryIds, ...primary, ...secondary, ...add];
    const categoryIds = [...new Set(ordered)]
      .filter(categoryId => {
        if (remove.has(categoryId) || deletedBuiltIns.has(categoryId) ||
            !catalog[categoryId]) return false;
        return !engine || catalog[categoryId].enabledEngines?.includes(engine);
      });
    const sources = categoryIds.map(categoryId => ({
      categoryId,
      source: add.includes(categoryId) ? 'manual' :
        secondary.includes(categoryId) ? 'secondary_type' :
          primary.includes(categoryId) ? 'primary_type' : 'view_default'
    }));
    return {
      viewId: normalizedViewId,
      categoryIds,
      categories: categoryIds.map(categoryId => catalog[categoryId]),
      sources
    };
  }

  return {
    STUDY_TYPES,
    READING_VIEWS,
    TYPE_OVERLAYS,
    TYPE_PROMPT_GUIDANCE,
    VIEW_PROMPT_GUIDANCE,
    createAdaptiveCategoryCatalog,
    createUnifiedCategoryCatalog,
    composeReadingView,
    isStudyType,
    isReadingView
  };
});
