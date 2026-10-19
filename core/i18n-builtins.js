(function attach(root, factory) {
  const api = factory(() => root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
  api.registerBuiltinInterfaceTranslations();
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(currentShared) {
  'use strict';

  // English editions of built-in criteria. Stable IDs, evidence examples, regexes,
  // slots, roles and storage schemas remain in their original definition modules.
  // A projection is never written back without restoring unchanged displayed fields.
  const CATEGORY_EN = {
    hypothesis: ['Hypothesis', 'An explicit, testable hypothesis, prediction or theoretical model proposed by the authors',
      null, ['The authors propose a hypothesis, prediction or theoretical model to test in the current study'],
      ['Only a possible explanation of an observed result, without a testable proposition']],
    objective: ['Research objective', 'An explicitly stated goal, question or evaluation objective of the current study',
      null, ['An explicit statement of what the current study seeks to answer, test, determine or evaluate'],
      ['A description of methods already performed or findings already obtained']],
    method: ['Methods', 'Experimental, sampling, measurement, statistical or computational procedures performed in the current study',
      null, ['Describes experimental, sampling, measurement, statistical or computational procedures actually performed in the current study'],
      ['Only a research objective, result or reference to an existing method without stating its use in this study']],
    result: ['Results', 'Findings directly observed, measured or statistically established in the current study',
      null, ['Reports findings directly observed, measured or statistically established in the current study'],
      ['A mechanistic explanation, synthesis of several results or statement of prior knowledge']],
    conclusion: ['Conclusion', 'An overall conclusion drawn from the study or from multiple results',
      null, ['An overall conclusion synthesizing several results or the entire study'],
      ['Only a single observation or a general background fact']],
    comparison: ['Comparison', 'An explicit difference or similarity between groups, conditions, methods, studies or explanations',
      null, ['Explicitly compares differences or similarities between two groups, conditions, methods, studies or explanations'],
      ['“While” refers to a procedure or time, or the text merely lists items in parallel']],
    limitation: ['Limitations', 'Weaknesses, bias, uncertainty or limits to generalizability of the current study',
      null, ['Explicitly states a study weakness, bias, uncertainty or limit to generalizability'],
      ['Only a contrast introduced by “however” or “although”, without a stated study limitation']],
    future: ['Future directions', 'Explicit proposals for subsequent research, validation, replication or development',
      null, ['Explicit proposals for subsequent research, validation, replication or development'],
      ['“Next” only indicates the narrative sequence or the next step in the current experiment']],
    causality: ['Causal relationship', 'An explicit statement that a factor causes, mediates, promotes, inhibits or explains another outcome',
      null, ['The complete passage identifies a causal factor and the outcome it causes, mediates, promotes or inhibits'],
      ['An isolated connective; “as shown in”, “as an example”, “as a marker”, “since” followed by a year, or procedural “while”']],
    emphasis: ['Emphasis', 'The authors explicitly identify a finding as important, significant, unexpected or central',
      null, ['The authors explicitly describe a finding as important, central, unexpected or noteworthy'],
      ['“Significant” refers only to statistical significance, without an assessment of importance']],
    evidence: ['Supporting evidence', 'Data, figures, analyses or previous studies explicitly used to support the current claim',
      null, ['Data, figures, analyses or previous studies are explicitly used to support the current claim'],
      ['Only a figure number, citation or background fact, without a supporting relationship']],
    interpretation: ['Interpretation', 'An explanation of the meaning, mechanism, implications or possible causes of a study result',
      null, ['Explains the meaning, mechanism, implications or possible causes of a result'],
      ['Only a direct result, research objective or restatement of a conclusion without explanation']],
    semantic_match: ['Semantic search match', 'Original evidence directly relevant to the user’s natural-language search intent',
      null, ['The original text directly answers or explicitly supports the user’s current natural-language search intent'],
      ['Only lexical similarity without semantic relevance, or a connection requiring external knowledge']],
    scientific_question: ['Scientific question', 'An explicit unknown, question, objective or testable hypothesis addressed by the current study; combines the former gap, objective and hypothesis entries.',
      'Does the original text explicitly state what this study seeks to understand, rather than only what was done or found?',
      ['A locatable unknown relationship, research question, objective or proposition to test', 'Explicitly concerns the current study'],
      ['General importance or background facts', 'Only procedures or results already obtained', 'Research proposed for after this study']],
    review_question: ['Author-stated concern', 'Uncertainty of interpretation, concerns about evidence, alternative explanations or unresolved bias explicitly acknowledged by the authors; excludes criticisms invented by AI.',
      'Can an original sentence expressing the authors’ concern about specific evidence or a conclusion be quoted directly, without adding unstated information?',
      ['An explicit concern, unresolved explanation or uncertainty', 'Refers to a specific conclusion, evidence, design or scope'],
      ['Inferring that a method was not used because it was not mentioned', 'AI-generated reviewer questions or external knowledge', 'An ordinary research question or future work without an expressed concern']],
    known_background: ['Established background', 'Established knowledge used by the paper to frame the research question.',
      'Does the passage state knowledge available before the study and directly relevant to the current question?',
      ['States existing knowledge', 'Relevant to the current research question'], ['A new result of the current study', 'Only broad common knowledge']],
    knowledge_gap: ['Knowledge gap', 'An unknown, inconsistency or unresolved problem explicitly identified by the authors.',
      'Is an unknown, inconsistency or lack of validation explicitly identified as a reason for the current study?',
      ['An explicit unknown or controversy', 'Relevant to the research question'], ['Only a statement of importance', 'The current experiment is not yet complete']],
    study_strategy: ['Study strategy', 'The overall design used to answer the main research question.',
      'Does the passage summarize the study system, key intervention or comparison and primary outcome, rather than list procedures?',
      ['Includes the overall design', 'Directly serves the main question'], ['Buffer or instrument details', 'A single measurement step']],
    key_result: ['Key result', 'A main finding that directly answers the research question or supports the main conclusion.',
      'Does this result test the central hypothesis, concern the primary outcome or underpin the main conclusion?',
      ['A result of the current study', 'Directly linked to the main question in the paper blueprint'], ['A secondary quality-control result', 'Selected only because it is statistically significant']],
    significance_novelty: ['Novelty claimed by the authors', 'An explicit statement of the study’s contribution, novelty or implications for the field.',
      'Does the passage explain what understanding this study adds or what explanatory framework it changes?',
      ['An explicit contribution or novelty claim', 'Based on the current study'], ['Generic claims of importance', 'Suggestions for future work']],
    driver_intervention: ['Initiating factor or intervention', 'The initial exposure, perturbation or experimental intervention in a mechanistic chain.',
      'Is a factor explicitly changed, compared or applied as an exposure that can serve as the starting point of a relationship?',
      ['An explicit factor or intervention', 'Can serve as the start of a relationship'], ['Only a background molecule is mentioned', 'No change or exposure']],
    association_evidence: ['Association evidence', 'Evidence of variables changing together without establishing interventional causality.',
      'Is an association between variables reported without a manipulation sufficient to support causality?',
      ['At least two variables', 'An explicit association or covariation'], ['A randomized or mechanistic intervention directly changes the outcome', 'Only one variable is described']],
    causal_effect: ['Causal effect', 'An intervention or explicit mechanistic action changes the target outcome.',
      'Are an intervention, a directional result and a design supporting causality present?',
      ['A causal factor or intervention', 'A target outcome and its direction'], ['Association only', 'Non-causal usage such as “as shown in”']],
    mechanism_mediator: ['Mechanistic mediator', 'A mediating process or entity linking an upstream factor to a downstream outcome.',
      'Does the evidence place a candidate mediator between the upstream factor and downstream outcome?',
      ['An upstream factor', 'A candidate mediator', 'A downstream outcome'], ['Only a change in a candidate molecule', 'No chain connecting the elements']],
    necessity_evidence: ['Necessity evidence', 'Blocking or removing a candidate mediator eliminates or substantially reduces the upstream factor’s effect on the target outcome.',
      'Are the upstream factor, mediator blockade, the same target outcome and a reduction in the effect all present?',
      ['A candidate mediator is blocked or removed', 'The same target outcome is compared before and after blockade', 'The original effect disappears or is substantially reduced'],
      ['Only an association between mediator and outcome', 'Only a difference between knockout and control groups', 'No original upstream effect as a reference']],
    sufficiency_evidence: ['Sufficiency evidence', 'Activating the candidate mediator alone produces the target effect in the absence of the original upstream stimulus.',
      'Does the text explicitly show that activating the candidate mediator alone produces the target outcome?',
      ['The candidate mediator is activated or supplied alone', 'The original upstream stimulus is absent', 'The target outcome occurs'],
      ['The candidate mediator and upstream stimulus are both present', 'Association only', 'The target outcome is not reported']],
    rescue_evidence: ['Rescue or reversal evidence', 'A separate rescue action restores or reduces the same abnormal outcome caused by an initial perturbation.',
      'Are an initial perturbation, an abnormal outcome, a separate rescue action and recovery of the same outcome present?',
      ['An initial perturbation and abnormal outcome', 'A rescue action', 'The same outcome is restored or substantially reduced'],
      ['Only general improvement with treatment', 'No relevant abnormality before rescue', 'Different outcomes are compared']],
    temporal_dose_evidence: ['Temporal or dose-response evidence', 'Temporal ordering or a dose-response pattern supports the direction of a relationship.',
      'Is temporal ordering, a time course or an outcome changing with dose explicitly reported?',
      ['A temporal or dose dimension', 'The outcome of the same relationship'], ['Only one time point', 'Dose appears only in the methods']],
    cross_system_validation: ['Validation across systems', 'The same claim is validated in different models, species, cohorts or measurement systems.',
      'Is a claim with the same direction tested in independent systems?',
      ['At least two independent systems', 'The same central claim'], ['Technical replicates of the same samples', 'Only a change in measurement units']],
    mechanism_gap: ['Mechanistic gap', 'An unresolved link in the mechanistic chain explicitly acknowledged by the authors.',
      'Is a specific mechanistic link explicitly identified as unknown or untested in this study?',
      ['An explicit unresolved link', 'Part of the mechanistic chain'], ['A general limitation', 'AI speculation based on missing information']],
    alternative_mechanism: ['Alternative mechanism', 'A different biological mechanism proposed by the authors to explain the same result.',
      'Is a mechanism different from the main mechanism proposed to explain the same finding?',
      ['An alternative mechanism', 'The same observed result'], ['Restating the main mechanism', 'An unsupported broad possibility']],
    design_control: ['Key design and controls', 'Study design and key controls that determine the strength of causal or comparative interpretation.',
      'Does the passage describe randomization, blinding, matching, positive or negative controls, or the core comparison framework?',
      ['A key design element or control', 'Affects interpretability'], ['An ordinary procedural step', 'No role in comparison']],
    sample_population: ['Sample and population scope', 'Sample origins, eligibility and limits to representativeness.',
      'Does the passage explain who or what was studied and which inferences the sample limits?',
      ['A sample or population definition', 'Relevant to the scope of application'], ['Only a sample identifier', 'No relevance to scope']],
    measurement_validity: ['Measurement validity', 'Whether a measurement, indicator or reference standard validly represents the target construct.',
      'Is the relationship between the measurement and the target construct, reference standard or error evaluated?',
      ['A measurement or indicator', 'A basis for validity or error'], ['Only identifies an instrument', 'No validity information']],
    effect_uncertainty: ['Effect size and uncertainty', 'An effect’s magnitude and its confidence interval, posterior interval or precision.',
      'Are an interpretable effect estimate and its uncertainty both reported?',
      ['Effect magnitude', 'An uncertainty range'], ['Only a p value', 'Direction without magnitude']],
    statistical_robustness: ['Statistical robustness', 'Model assumptions, multiple testing, sensitivity analyses or robustness checks.',
      'Is an analysis or limitation provided that tests the stability of the statistical conclusion?',
      ['A statistical risk or robustness check', 'Linked to the current conclusion'], ['Only names software', 'An ordinary significance statement']],
    confounding_reverse_causality: ['Confounding and reverse causality', 'Evidence may be affected by uncontrolled confounding or a reversed causal direction.',
      'Does original evidence support a specific confounder or reverse pathway that could explain the result?',
      ['An explicit exposure and outcome', 'A specific confounding or reverse pathway', 'Support from original evidence'],
      ['An automatic warning merely because the study is observational', 'No specific alternative pathway']],
    causal_overreach: ['Causal overreach', 'The authors’ causal wording exceeds the strength of the study design or evidence.',
      'Can the original conclusion and evidence demonstrate that the causal claim is stronger than the evidence?',
      ['Original text of a causal conclusion', 'Original text of weaker evidence'],
      ['Randomized or mechanistic intervention evidence already supports the claim', 'Judgment of wording without an evidence quote']],
    alternative_explanation: ['Alternative explanation', 'Another explanation supported by the original evidence but not adequately excluded by the authors.',
      'Is there a specific alternative explanation supported by the original text, rather than generic speculation?',
      ['The target finding', 'A specific alternative explanation', 'Support from the original text'], ['Generic speculation', 'Unrelated to the study']],
    replication_external_validation: ['Replication and external validation', 'Replication in independent samples, cohorts, laboratories or datasets.',
      'Is the same claim validated in an independent source, distinguished from internal repetition?',
      ['An independent validation source', 'The same claim'], ['Cross-validation within the training set presented as external validation', 'Technical replicates']],
    generalizability: ['Limits to generalizability', 'The populations, systems or contexts to which the findings apply.',
      'Does the passage explicitly state that the current evidence cannot be directly extended to a population or setting?',
      ['A target scope for generalization', 'An evidence boundary'], ['Only a statement that more research is needed', 'No scope of application']],
    statistical_vs_practical_significance: ['Statistical versus practical significance', 'Distinguishes statistical significance from biological or clinical importance.',
      'Is the statistical result compared with effect magnitude, a clinical threshold or biological significance?',
      ['Statistical evidence', 'A criterion for practical importance'], ['Only the word “significant”', 'Only the direction of an effect']],
    transparency_reproducibility: ['Data and methods transparency', 'Availability of data, code, preregistration, protocols and materials needed for replication.',
      'Is the availability, restriction or absence of key replication materials explicitly stated?',
      ['Replication materials or preregistration information', 'Availability status'], ['An ordinary methods citation', 'Author affiliation information']],
    review_scope_thesis: ['Review scope and central thesis', 'The review authors explicitly define the subject, boundaries, central question or main thesis.',
      'Does the passage state both what the review covers and the central question or thesis organizing its evidence?',
      ['An explicit subject or boundary of the review', 'An explicit central question, thesis or organizing axis'],
      ['Ordinary background facts or repetition of the title', 'A broad statement that the article reviews a topic without defining scope']],
    evidence_consensus: ['Convergent evidence', 'At least two distinguishable studies or evidence systems report directionally consistent results for the same comparable claim.',
      'Do two distinct evidence sources provide comparable support in the same direction for the same target and outcome?',
      ['At least two distinct evidence sources', 'The same target claim with a consistent direction'],
      ['Only vague quantities such as “many studies”', 'A single study result or different, non-comparable outcomes']],
    conflicting_evidence: ['Conflicting evidence', 'At least two evidence sources report opposing, inconsistent, unreplicated or context-dependent results for the same question or comparable outcome.',
      'Can different directions from two evidence sources be identified for the same comparable claim, with a stated basis for comparison?',
      ['At least two distinct, locatable pieces of evidence', 'Opposing or context-dependent directions for the same target claim'],
      ['Relies only on connectives such as “however”, “while” or “as”', 'Studies address different questions or use non-comparable outcomes']],
    heterogeneity_source: ['Sources of heterogeneity', 'The review authors explicitly attribute disagreement to differences in populations, models, doses, endpoints, time windows, methods, bias or context.',
      'Does the passage identify both divergent findings and a specific, verifiable dimension of difference that may explain them?',
      ['Explicit disagreement or heterogeneous results', 'A specific dimension of difference and at least two contexts'],
      ['Only reports I² or generally states that heterogeneity exists', 'Lists study characteristics without linking them to disagreement']],
    evidence_quality_certainty: ['Evidence quality and certainty', 'An assessment of a body of evidence in terms of risk of bias, design quality, precision, consistency, directness, publication bias or overall certainty.',
      'Do the authors evaluate the credibility or certainty of a specific body of evidence using an explicit quality dimension?',
      ['An explicit body of evidence', 'An explicit quality dimension and certainty judgment'],
      ['Only a sample size, p value or the word “significant”', 'A general methodological warning without an object of evaluation']],
    integrative_framework: ['Integrative framework', 'The review authors organize knowledge across studies into a mechanistic model, stages, subtypes, pathways, taxonomy or conceptual framework.',
      'Does the passage propose a structured framework organizing multiple studies, rather than simply list topics?',
      ['Covers multiple pieces of evidence or topics', 'Specifies stages, subtypes, pathways or other structural relationships'],
      ['Only lists multiple topics', 'Only restates a mechanism from one study']],
    author_synthesis: ['Authors’ synthesis', 'A balanced conclusion drawn by the current review authors across multiple evidence sources, retaining conditions or limits of the evidence.',
      'Is this a synthesis by the review authors based on a body of evidence, rather than a conclusion from one cited study?',
      ['An explicit synthesis of multiple evidence sources or a body of evidence', 'A balanced conclusion or conditional boundary'],
      ['The result of a single cited study', 'A personal claim without a basis in synthesized evidence']]
  };

  const MODE_EN = {
    quick_story: ['Main storyline', 'Why the study was done, how it was tested, what was found and what it means'],
    mechanism_chain: ['Mechanistic evidence chain', 'Initiating factors, mediators, evidence strength and downstream outcomes'],
    critical_review: ['Critical reading', 'Necessity, sufficiency, rescue experiments, key controls and author-stated concerns'],
    review_synthesis: ['Review synthesis', 'Scope, consensus, disagreements, heterogeneity, evidence quality and the authors’ synthesis']
  };
  const STUDY_EN = {
    basic_mechanistic: 'Basic mechanistic research', preclinical_translational: 'Preclinical / translational research',
    observational: 'Observational study', clinical_trial: 'Clinical trial', diagnostic_prognostic: 'Diagnostic / prognostic study',
    omics_high_throughput: 'Omics / high-throughput research', narrative_review: 'Narrative review (mechanistic / translational)',
    systematic_review_meta: 'Systematic review / meta-analysis', methods_resource: 'Methods / tools / resources study'
  };
  const PANEL_EN = {
    grouping: ['Groups and controls', 'Explain the experimental groups, control groups and comparisons, and make clear which conclusions these groups can and cannot support.'],
    technique_principle: ['Principles of the experimental technique', 'Explain the principles, readouts and reasonable interpretation boundaries of the experimental or bioinformatics technique.'],
    axes_reading: ['Axes and how to read the figure', 'Explain the axes, labels and a practical reading sequence supported by evidence in the input; state explicitly when they are not visible.'],
    sample_information: ['Sample information', 'Explain only the samples, species, tissues, cells, cohorts and replicates explicitly supported by the input. Do not guess missing details.']
  };
  const CHAT_EN = {
    core_claim: ['Core conclusion', 'Summarize the paper’s central conclusion and explain the key original evidence supporting each point.'],
    evidence_chain: ['Evidence chain', 'Trace the complete evidence chain supporting the authors’ central mechanism and identify its weakest link.'],
    limitations: ['Limitations', 'Using evidence from the article, summarize its main limitations, unresolved questions and conditions that may constrain generalization of its conclusions.'],
    section_compare: ['Compare sections', 'Compare the arguments, evidence and conclusions in the selected sections, identifying agreement, differences and potential contradictions.']
  };
  const ACTION_EN = {
    translate: ['Translate', 'Translate the selected passage accurately into the current interface language. Preserve technical terms, gene/protein names, numerical values, statistics and uncertainty; retain the original technical term in parentheses when helpful.'],
    explain: ['Explain', 'Explain the selected passage clearly without distorting it: first state what the authors directly mean, then explain key concepts, logical relationships and the limits of the conclusion. Do not invent mechanisms absent from the original text.']
  };
  const TEMPLATE_EN = {
    basic_research: 'Basic research article', clinical_study: 'Clinical study', systematic_review: 'Systematic review / meta-analysis',
    narrative_review: 'Narrative review', case_report: 'Case report / case series', methods_resource: 'Methods / protocol / resource',
    guideline_consensus: 'Guideline / consensus'
  };
  const FIELD_EN = {
    research_background: 'Research background', scientific_questions: 'Scientific question and logical subquestions',
    experimental_design: 'Experimental design', important_methods: 'Key experimental methods', main_findings: 'Main findings',
    innovations: 'Research contributions', limitations: 'Limitations', open_questions: 'Questions to test', transferable_ideas: 'Ideas I can apply',
    population: 'P · Population', intervention: 'Intervention', comparison: 'C · Comparison', outcomes: 'O · Outcomes',
    study_design: 'Study design', eligibility: 'Eligibility criteria', primary_endpoint: 'Primary endpoint',
    secondary_endpoints: 'Secondary endpoints', effect_size: 'Effect sizes and confidence intervals', safety: 'Safety',
    bias_risk: 'Risk of bias', generalizability: 'Generalizability and clinical relevance', review_question: 'Review question', picos: 'PICOS',
    search_scope: 'Databases and search scope', included_studies: 'Included studies and sample sizes', pooled_effect: 'Pooled effect',
    heterogeneity: 'Heterogeneity', sensitivity_analysis: 'Sensitivity / subgroup analyses', certainty_of_evidence: 'Certainty of evidence',
    scope: 'Review scope', framework: 'Thematic framework', consensus: 'Main consensus', controversies: 'Controversies and contrary evidence',
    evidence_gaps: 'Evidence gaps', author_view: 'Authors’ perspective', future_directions: 'Future directions',
    patient_profile: 'Patient profile', chief_complaint: 'Presenting complaint and clinical course', diagnostic_process: 'Diagnostic process',
    differential_diagnosis: 'Differential diagnosis', outcome: 'Outcome and follow-up', novelty: 'Distinctive features of the case',
    clinical_lesson: 'Clinical lessons', method_goal: 'Method objective', inputs_outputs: 'Inputs and outputs', workflow: 'Key steps',
    critical_parameters: 'Critical parameters', controls: 'Controls and quality assurance', validation: 'Validation measures',
    reproducibility: 'Requirements for reproducibility', target_population: 'Target population', key_questions: 'Key clinical questions',
    recommendations: 'Main recommendations', recommendation_strength: 'Strength of recommendations', evidence_grade: 'Evidence level',
    exceptions: 'Exceptions and contraindications', implementation: 'Implementation considerations', update_triggers: 'Reasons for updates and controversies'
  };

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => Array.isArray(value) ? value.map(clone) : isRecord(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isEnglish = language => String(language || '').toLowerCase().startsWith('en');
  const recordId = record => record?.id || record?.categoryId;

  function categoryEnglish(base) {
    const spec = CATEGORY_EN[base.categoryId];
    if (!spec) return clone(base);
    const [name, definition, question, include, exclude] = spec;
    const values = {
      name, definition, decisionQuestion: question || `Does the original text satisfy “${definition}” without meeting an exclusion criterion?`,
      includeAll: include, includeWhen: include, excludeAny: exclude, excludeWhen: exclude
    };
    const output = clone(base);
    for (const [key, value] of Object.entries(values)) if (own(base, key)) output[key] = clone(value);
    if (isRecord(base.prompt)) {
      for (const [key, value] of Object.entries(values)) if (own(base.prompt, key)) output.prompt[key] = clone(value);
    }
    return output;
  }

  function defaultCatalog() {
    const api = currentShared();
    const categories = api.createUnifiedCategoryCatalog?.() || api.createBuiltInCategories?.() || {};
    const settings = {
      analysisModes: api.createDefaultAnalysisModes?.() || [],
      figurePanelFollowupPrompts: clone(api.DEFAULT_PANEL_FOLLOWUP_PROMPTS || Object.fromEntries(
        (api.DEFAULT_PANEL_FOLLOWUP_PRESETS || []).map(row => [row.topic, row.prompt]))),
      figurePanelFollowupPresets: clone(api.DEFAULT_PANEL_FOLLOWUP_PRESETS || []),
      articleChatQuickPrompts: clone(api.DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS || []),
      literatureNoteTemplates: clone(api.DEFAULT_LITERATURE_NOTE_TEMPLATES || []),
      selectionLlmActions: clone(api.DEFAULT_SELECTION_ACTIONS || [])
    };
    return { categories, settings, readingViews: clone(api.READING_VIEWS || {}), studyTypes: clone(api.STUDY_TYPES || {}) };
  }

  function englishCatalog(base) {
    const output = clone(base);
    output.categories = Object.fromEntries(Object.entries(base.categories).map(([id, row]) => [id, categoryEnglish(row)]));
    const modes = row => MODE_EN[row.id] ? { ...row, name: MODE_EN[row.id][0], description: MODE_EN[row.id][1] } : row;
    output.settings.analysisModes = base.settings.analysisModes.map(modes);
    output.readingViews = Object.fromEntries(Object.entries(base.readingViews).map(([id, row]) => {
      const value = modes({ ...row, id }); delete value.id; return [id, value];
    }));
    output.studyTypes = Object.fromEntries(Object.entries(base.studyTypes).map(([id, row]) => [id, { ...row, name: STUDY_EN[id] || row.name }]));
    const promptRows = (rows, translations) => rows.map(row => translations[row.id]
      ? { ...row, name: translations[row.id][0], prompt: translations[row.id][1] } : row);
    output.settings.figurePanelFollowupPresets = promptRows(base.settings.figurePanelFollowupPresets, PANEL_EN);
    output.settings.figurePanelFollowupPrompts = Object.fromEntries(Object.entries(base.settings.figurePanelFollowupPrompts)
      .map(([topic, value]) => [topic, PANEL_EN[topic]?.[1] || value]));
    output.settings.articleChatQuickPrompts = promptRows(base.settings.articleChatQuickPrompts, CHAT_EN);
    output.settings.selectionLlmActions = promptRows(base.settings.selectionLlmActions, ACTION_EN);
    output.settings.literatureNoteTemplates = base.settings.literatureNoteTemplates.map(template => ({
      ...template, name: TEMPLATE_EN[template.id] || template.name,
      fields: template.fields.map(field => ({ ...field, label:
        template.id === 'clinical_study' && field.id === 'intervention' ? 'I · Intervention / exposure' :
        template.id === 'methods_resource' && field.id === 'limitations' ? 'Scope and limitations' :
        template.id === 'systematic_review' && field.id === 'limitations' ? 'Review limitations' : FIELD_EN[field.id] || field.label }))
    }));
    return output;
  }

  // Arrays of records are matched by stable ID, never by their display order.
  // String arrays are a single editable field: any user edit protects the whole field.
  // An explicit override protects its field even when its bytes equal the default.
  function project(value, base, translated, protectedValue) {
    if (protectedValue !== undefined) {
      if (!isRecord(protectedValue) || !isRecord(value)) return clone(value);
    }
    if (Array.isArray(value)) {
      if (value.every(isRecord) && Array.isArray(base)) {
        return value.map(row => {
          const id = recordId(row), source = base.find(item => recordId(item) === id);
          const target = Array.isArray(translated) && translated.find(item => recordId(item) === id);
          return source && target ? project(row, source, target) : clone(row);
        });
      }
      return equal(value, base) ? clone(translated === undefined ? value : translated) : clone(value);
    }
    if (isRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        own(base, key) && own(translated, key)
          ? project(item, base[key], translated[key], own(protectedValue, key) ? protectedValue[key] : undefined) : clone(item)]));
    }
    return value === base && translated !== undefined ? translated : value;
  }

  function getBuiltinCatalog(language = 'zh-CN') {
    const base = defaultCatalog();
    return isEnglish(language) ? englishCatalog(base) : clone(base);
  }

  function localizeBuiltinSettings(settings, language = settings?.language) {
    if (!isEnglish(language)) return clone(settings);
    const base = defaultCatalog();
    const projected = project(settings, base.settings, englishCatalog(base).settings);
    // Existing storage normalizers apply NFKC to built-in punctuation. Recognize
    // both untouched definition bytes and the exact canonical stored defaults.
    // Never normalize the user's value to decide whether it is a default.
    const defaults = currentShared().createDefaultSettings?.();
    if (!defaults) return projected;
    const stored = { ...base, settings: Object.fromEntries(Object.keys(base.settings)
      .map(key => [key, clone(defaults[key] ?? base.settings[key])])) };
    return project(projected, stored.settings, englishCatalog(stored).settings);
  }

  function localizeBuiltinCategory(category, language, explicitOverride) {
    if (!isEnglish(language) || category?.builtIn === false) return clone(category);
    const base = defaultCatalog().categories[category?.categoryId];
    if (!base) return clone(category);
    return project(category, base, categoryEnglish(base), explicitOverride);
  }

  // Return unchanged display fields to their exact original bytes before saving.
  // Pass the original raw object retained when the editor opened, never a new read.
  // This also preserves custom CRLF, spacing and empty values without normalizing.
  function restoreBuiltinEdits(edited, original, displayed) {
    if (equal(edited, displayed)) return clone(original);
    if (Array.isArray(edited) && Array.isArray(original) && Array.isArray(displayed) && edited.every(isRecord)) {
      return edited.map(row => {
        const id = recordId(row), raw = original.find(item => recordId(item) === id);
        const shown = displayed.find(item => recordId(item) === id);
        return raw && shown ? restoreBuiltinEdits(row, raw, shown) : clone(row);
      });
    }
    if (isRecord(edited) && isRecord(original) && isRecord(displayed)) {
      return Object.fromEntries(Object.entries(edited).map(([key, value]) => [key,
        own(original, key) && own(displayed, key) ? restoreBuiltinEdits(value, original[key], displayed[key]) : clone(value)]));
    }
    return clone(edited);
  }

  function restoreBuiltinSettings(edited, original, language = original?.language) {
    return restoreBuiltinEdits(edited, original, localizeBuiltinSettings(original, language));
  }

  function restoreBuiltinCategory(edited, original, language, explicitOverride) {
    return restoreBuiltinEdits(edited, original, localizeBuiltinCategory(original, language, explicitOverride));
  }

  function compileLocalizedCategoryPromptPreview(category, language) {
    const api = currentShared();
    if (!isEnglish(language)) return api.compileCategoryPromptPreview?.(category) || '';
    const normalized = api.flattenUnifiedCategory?.(category) || category;
    const prompt = normalized.prompt || normalized;
    const list = values => values?.length ? values.map((value, index) => `${index + 1}. ${value}`).join('\n') : '(None)';
    return [
      `Category: ${normalized.name} (${normalized.categoryId})`, `Definition: ${prompt.definition}`,
      `Decision question: ${prompt.decisionQuestion}`, `Include:\n${list(prompt.includeWhen || prompt.includeAll)}`,
      `Exclude:\n${list(prompt.excludeWhen || prompt.excludeAny)}`, `Positive examples:\n${list(prompt.positiveExamples)}`,
      `Negative examples:\n${list(prompt.negativeExamples || prompt.hardNegativeExamples)}`,
      `Required slots: ${(prompt.requiredSlots || []).join(', ') || '(None)'}`,
      `Allowed quote roles: ${(prompt.allowedQuoteRoles || []).join(', ') || '(None)'}`,
      `Span policy: ${prompt.spanPolicy}`, `Minimum confidence: ${prompt.minimumConfidence}`
    ].join('\n\n');
  }

  // For explicitly identified built-in labels/prompts only. Do not apply to notes,
  // extracted source text, saved model output or arbitrary user-authored strings.
  function localizeBuiltinText(value, language) {
    if (!isEnglish(language) || typeof value !== 'string') return value;
    const base = defaultCatalog(), translated = englishCatalog(base), lookup = new Map();
    function collect(raw, localized) {
      if (typeof raw === 'string' && typeof localized === 'string' && raw !== localized) lookup.set(raw, localized);
      else if (Array.isArray(raw)) raw.forEach((item, index) => collect(item, localized?.[index]));
      else if (isRecord(raw)) Object.keys(raw).forEach(key => collect(raw[key], localized?.[key]));
    }
    collect(base, translated);
    return lookup.get(value) || value;
  }

  function registerBuiltinInterfaceTranslations() {
    const api = currentShared();
    if (typeof api.registerInterfaceTranslations !== 'function') return;
    const base = defaultCatalog(), translated = englishCatalog(base), entries = {
      '副本': 'copy', '新字段': 'New field', '自定义文献': 'Custom literature note',
      '关键内容': 'Key content', '分析': 'Analyze', '新阅读场景': 'New reading mode',
      '阅读场景': 'Reading mode', '新 Profile': 'New profile',
      '请分析所选文段，并说明结论边界。': 'Analyze the selected passage and explain the limits of the conclusion.'
    };
    function collect(raw, localized) {
      if (Array.isArray(raw)) raw.forEach((item, index) => collect(item, localized?.[index]));
      else if (isRecord(raw)) Object.entries(raw).forEach(([key, value]) => {
        if (['name', 'description', 'label'].includes(key) && typeof value === 'string' && typeof localized?.[key] === 'string' && value !== localized[key]) {
          entries[value] = localized[key];
        } else if (typeof value === 'object') collect(value, localized?.[key]);
      });
    }
    collect(base, translated); api.registerInterfaceTranslations(entries);
  }

  return {
    getBuiltinCatalog, localizeBuiltinSettings, localizeBuiltinCategory, localizeBuiltinText,
    restoreBuiltinEdits, restoreBuiltinSettings, restoreBuiltinCategory, compileLocalizedCategoryPromptPreview,
    registerBuiltinInterfaceTranslations
  };
});
