(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const SYNTHESIS_CONCEPTS = Object.freeze([
    'argument_chain', 'panel_groups', 'logic_bridges', 'author_assembly',
    'figure-level group', 'figure level group', 'figure-level synthesis',
    'ordered domino chain', 'whole-figure conclusion', 'whole figure conclusion'
  ]);
  const POSITIVE_IMPERATIVE = /\b(?:must|return|generate|build|produce|include|create|provide|output|answer|write)\b/i;
  const NEGATIVE_IMPERATIVE = /\b(?:must\s+not|do\s+not|don['’]?t|never|without|forbid(?:den)?)\b/i;

  function splitInstructions(value) {
    return String(value || '')
      .split(/(?:\r?\n|(?<=[.!?。！？])\s+)/u)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function schemaFields(schema, fields = new Set()) {
    if (!schema || typeof schema !== 'object') return fields;
    Object.keys(schema.properties || {}).forEach(field => fields.add(field));
    Object.values(schema.properties || {}).forEach(value => schemaFields(value, fields));
    schemaFields(schema.items, fields);
    for (const branch of ['allOf', 'anyOf', 'oneOf']) {
      (Array.isArray(schema[branch]) ? schema[branch] : [])
        .forEach(value => schemaFields(value, fields));
    }
    return fields;
  }

  function conceptPattern(concept) {
    const escaped = String(concept || '')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/[_ -]+/g, '[_ -]+');
    return new RegExp(`\\b${escaped}\\b`, 'i');
  }

  function imperativePolarity(instruction) {
    if (NEGATIVE_IMPERATIVE.test(instruction)) return 'negative';
    if (POSITIVE_IMPERATIVE.test(instruction)) return 'positive';
    return '';
  }

  function imperativeAction(instruction) {
    if (/\b(?:copy|duplicate|repeat)\b/i.test(instruction)) return 'copy';
    if (/\b(?:return|generate|build|produce|include|create|provide|output|answer|write)\b/i
      .test(instruction)) return 'output';
    const mustAction = String(instruction || '').match(/\bmust\s+(?:not\s+)?([a-z]+)/i);
    return mustAction ? mustAction[1].toLowerCase() : '';
  }

  function explicitOutputFields(instructions) {
    const fields = new Map();
    instructions.forEach(instruction => {
      if (imperativePolarity(instruction) !== 'positive') return;
      for (const match of instruction.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
        if (!fields.has(match[0])) fields.set(match[0], instruction);
      }
    });
    return fields;
  }

  function auditPromptContract(record = {}) {
    const id = String(record.id || 'prompt');
    const systemInstructions = splitInstructions(record.systemPrompt);
    const userPrompt = String(record.userPrompt || '');
    const instructions = [...systemInstructions];
    const fields = schemaFields(record.responseSchema);
    const concepts = [...new Set([
      ...fields,
      ...SYNTHESIS_CONCEPTS
    ])];
    const issues = [];

    concepts.forEach(concept => {
      const pattern = conceptPattern(concept);
      const positive = instructions.filter(instruction =>
        pattern.test(instruction) && imperativePolarity(instruction) === 'positive'
      );
      const negative = instructions.filter(instruction =>
        pattern.test(instruction) && imperativePolarity(instruction) === 'negative'
      );
      for (const positiveInstruction of positive) {
        const action = imperativeAction(positiveInstruction);
        const negativeInstruction = negative.find(instruction =>
          action && imperativeAction(instruction) === action
        );
        if (!negativeInstruction) continue;
        issues.push({
          code: 'PROMPT_MUST_MUST_NOT_CONFLICT', id, concept, action,
          positive: positiveInstruction, negative: negativeInstruction
        });
        break;
      }
    });

    for (const [field, instruction] of explicitOutputFields(instructions)) {
      if (fields.has(field)) continue;
      issues.push({
        code: 'PROMPT_SCHEMA_FIELD_MISMATCH', id, field, instruction
      });
    }

    let request = null;
    try { request = JSON.parse(userPrompt); } catch (_) {}
    const extractionPass = request?.pass === 'panel_extraction' ||
      /(?:^|[.:-])panel[-_. ]?batch(?:$|[.:-])/i.test(id);
    if (extractionPass) {
      SYNTHESIS_CONCEPTS.forEach(concept => {
        const pattern = conceptPattern(concept);
        const instruction = instructions.find(item =>
          pattern.test(item) && imperativePolarity(item) === 'positive'
        );
        if (instruction) {
          issues.push({
            code: 'EXTRACTION_PASS_SYNTHESIS_LEAK', id, concept, instruction
          });
        }
      });
    }
    return issues;
  }

  function auditPromptContracts(records = []) {
    return (Array.isArray(records) ? records : [])
      .flatMap(record => auditPromptContract(record));
  }

  return {
    SYNTHESIS_CONCEPTS,
    splitPromptInstructions: splitInstructions,
    promptSchemaFields: schemaFields,
    auditPromptContract,
    auditPromptContracts
  };
});
