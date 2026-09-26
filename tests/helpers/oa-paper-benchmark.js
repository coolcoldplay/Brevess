const OA_PAPER_BENCHMARK = Object.freeze([
  {
    id: 'science-adv1219',
    title: 'C1q and immunoglobulins mediate activity-dependent synapse loss in the adult brain',
    sourceUrl: 'https://www.science.org/doi/10.1126/science.adv1219',
    expectedPrimaryType: 'basic_mechanistic',
    expectedSecondaryType: 'preclinical_translational',
    stressCases: [
      'Separate activity-associated changes from perturbation-supported causal effects.',
      'Require the initial abnormality and restored same outcome before calling an experiment rescue.'
    ]
  },
  {
    id: 'pmc6343937',
    title: 'Computational translation of genomic responses from experimental model systems to humans',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6343937/',
    expectedPrimaryType: 'preclinical_translational',
    expectedSecondaryType: 'omics_high_throughput',
    stressCases: [
      'Do not equate mouse-to-human signature overlap with demonstrated clinical benefit.',
      'Keep computational cross-species validation distinct from biological rescue.'
    ]
  },
  {
    id: 'pmc12448834',
    title: 'Confounding mechanisms and adjustment strategies in air pollution epidemiology',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12448834/',
    expectedPrimaryType: 'observational',
    expectedSecondaryType: null,
    stressCases: [
      'An adjusted hazard ratio remains association evidence.',
      'A reversal after removing a covariate supports a confounding warning, not a second causal effect.'
    ]
  },
  {
    id: 'pmc5113234',
    title: 'Open-label placebo treatment in chronic low back pain: a randomized controlled trial',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5113234/',
    expectedPrimaryType: 'clinical_trial',
    expectedSecondaryType: null,
    stressCases: [
      'Keep prespecified primary outcomes separate from exploratory follow-up.',
      'Require effect magnitude and uncertainty rather than a p value alone.'
    ]
  },
  {
    id: 'pmc9339006',
    title: 'Localization-adjusted diagnostic performance and assistance effect of a computer-aided detection system',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9339006/',
    expectedPrimaryType: 'diagnostic_prognostic',
    expectedSecondaryType: 'clinical_trial',
    stressCases: [
      'Do not infer calibration or clinical utility from AUROC alone.',
      'Distinguish external diagnostic validation from the separate clinician-assistance experiment.'
    ]
  },
  {
    id: 'pmc9284682',
    title: 'Batch effect detection and correction in RNA-seq data using machine-learning-based automated assessment of quality',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9284682/',
    expectedPrimaryType: 'omics_high_throughput',
    expectedSecondaryType: 'methods_resource',
    stressCases: [
      'Batch correction performance is not biological mechanism evidence.',
      'Evaluation across published datasets is not automatically independent experimental replication.'
    ]
  },
  {
    id: 'pmc10331582',
    title: 'The effects of oral ferrous bisglycinate supplementation: a systematic review and meta-analysis',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10331582/',
    expectedPrimaryType: 'systematic_review_meta',
    expectedSecondaryType: null,
    stressCases: [
      'Keep pooled effects, heterogeneity, risk of bias and certainty as separate evidence dimensions.',
      'Do not treat lack of statistical significance as proof of no effect.'
    ]
  },
  {
    id: 'gendis-2025-101935',
    title: 'Lactylation-driven therapeutic strategies in cancer: mechanisms and therapeutic opportunities',
    sourceUrl: 'https://doi.org/10.1016/j.gendis.2025.101935',
    expectedPrimaryType: 'narrative_review',
    expectedSecondaryType: 'preclinical_translational',
    stressCases: [
      'Separate the review authors’ mechanistic framework from findings reported by individual cited studies.',
      'Preclinical therapeutic promise must not be summarized as established clinical benefit.'
    ]
  },
  {
    id: 'pmc9048693',
    title: 'POIBM: batch correction of heterogeneous RNA-seq datasets through latent sample matching',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9048693/',
    expectedPrimaryType: 'methods_resource',
    expectedSecondaryType: 'omics_high_throughput',
    stressCases: [
      'Benchmark superiority is a method result, not external validity unless the test data are independent.',
      'Parameter sensitivity and stated failure cases belong in critical review.'
    ]
  },
  {
    id: 'pmc5905597',
    title: 'Conditional ablation and conditional rescue models for Casq2 elucidate developmental and cell-type-specific roles in CPVT2',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5905597/',
    expectedPrimaryType: 'basic_mechanistic',
    expectedSecondaryType: 'preclinical_translational',
    stressCases: [
      'Keep conditional deletion, tissue restriction and temporal rescue as separate causal tests.',
      'A partial phenotype rescue in one cell type does not establish restoration of every disease feature.'
    ]
  },
  {
    id: 'pmc6145285',
    title: 'Development of a patient-derived xenograft humanised mouse model for tumour microenvironment and immunotherapy research',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6145285/',
    expectedPrimaryType: 'preclinical_translational',
    expectedSecondaryType: 'methods_resource',
    stressCases: [
      'Human immune cells in a mouse model do not make the experiment a human clinical trial.',
      'Model feasibility and engraftment are not evidence of patient benefit or broad clinical generalizability.'
    ]
  },
  {
    id: 'pmc4460181',
    title: 'Perioperative plasma NGAL and 3-year mortality after cardiac surgery: a prospective observational cohort study',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4460181/',
    expectedPrimaryType: 'observational',
    expectedSecondaryType: 'diagnostic_prognostic',
    stressCases: [
      'Adjusted biomarker associations remain observational and must not be rewritten as causal effects.',
      'Loss of an association after creatinine adjustment is evidence about model dependence, not proof of mediation.'
    ]
  },
  {
    id: 'pmc8276068',
    title: 'Optimising Therapy to Prevent Avoidable Hospital Admissions in Multimorbid Older Adults: cluster randomised controlled trial',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8276068/',
    expectedPrimaryType: 'clinical_trial',
    expectedSecondaryType: null,
    stressCases: [
      'Keep intention-to-treat primary analysis distinct from competing-risk and other supplementary analyses.',
      'Outcome adjudication and clustering are design facts; neither alone is a treatment result.'
    ]
  },
  {
    id: 'pmc5788083',
    title: 'External validation and clinical utility of a 6-month mortality prediction model in hemodialysis',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5788083/',
    expectedPrimaryType: 'diagnostic_prognostic',
    expectedSecondaryType: null,
    stressCases: [
      'Separate discrimination, calibration and decision-curve net benefit.',
      'Clinical utility restricted to a threshold range must not be summarized as general usefulness.'
    ]
  },
  {
    id: 'pmc12451313',
    title: 'Direct RNA sequencing reveals m6A modifications and isoform changes in SARS-CoV-2-infected HEK cells',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12451313/',
    expectedPrimaryType: 'omics_high_throughput',
    expectedSecondaryType: null,
    stressCases: [
      'An enriched pathway or altered isoform generates a mechanistic hypothesis but is not a tested mediator.',
      'Computational detection of modifications must stay distinct from orthogonal biological validation.'
    ]
  },
  {
    id: 'pmc3999945',
    title: 'External validation of multivariable prediction models: a systematic review of methodological conduct and reporting',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3999945/',
    expectedPrimaryType: 'systematic_review_meta',
    expectedSecondaryType: 'diagnostic_prognostic',
    stressCases: [
      'Counts of poorly reported validation studies describe review findings, not performance of one prediction model.',
      'Failure to report calibration is a reporting limitation, not evidence that calibration was poor.'
    ]
  },
  {
    id: 'pmc10994554',
    title: 'Enrichment on steps, not genes, improves inference of differentially expressed pathways',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10994554/',
    expectedPrimaryType: 'methods_resource',
    expectedSecondaryType: 'omics_high_throughput',
    stressCases: [
      'Benchmark sensitivity and unique enrichment results are method-performance findings, not biological mechanisms.',
      'The word sufficient in a pathway-set definition is not experimental sufficiency evidence.'
    ]
  }
]);

module.exports = { OA_PAPER_BENCHMARK };
