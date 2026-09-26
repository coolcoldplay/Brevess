(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const JEV_HIGHLIGHT_ALGORITHM_VERSION = 'jev-highlight-v6';
  const JEV_HIGHLIGHT_LIMITS = Object.freeze({
    stateAndLongestQuestionBytes: 32 * 1024,
    totalInputBytes: 64 * 1024,
    screenQuestionsPerBatch: 64,
    choiceOptions: 255,
    slotTokens: 254,
    slotTokenSpan: 32,
    contextRadius: 3
  });
  const COMMON_ABBREVIATIONS = new Set([
    'fig', 'figs', 'eq', 'eqs', 'ref', 'refs', 'dr', 'mr', 'mrs', 'ms',
    'prof', 'vs', 'no', 'nos', 'vol', 'vols', 'approx', 'dept', 'inc',
    'st', 'al', 'e.g', 'i.e'
  ]);
  const BUILT_IN_REQUIRED_ROLES = Object.freeze({
    necessity_evidence: ['upstream_effect', 'reduced_outcome'],
    sufficiency_evidence: ['mediator_activation', 'induced_outcome'],
    rescue_evidence: ['initial_abnormality', 'rescued_outcome'],
    evidence_consensus: ['evidence_a', 'evidence_b'],
    conflicting_evidence: ['evidence_a', 'evidence_b']
  });

  function jevError(code, message, retryable = false) {
    let error;
    if (typeof shared.ProviderRequestError === 'function') {
      error = new shared.ProviderRequestError(code, message, { retryable });
    } else {
      error = new Error(message);
      error.code = code;
      error.retryable = retryable;
    }
    if (!error.code) error.code = code;
    if (retryable) error.retryable = true;
    return error;
  }

  function invalidResponse(message = 'TypeSafe returned incomplete or invalid typed decisions') {
    return jevError('INVALID_RESPONSE', message, true);
  }

  function cancelledError() {
    return jevError('CANCELLED', 'TypeSafe document highlighting was cancelled');
  }

  function checkAbort(signal) {
    if (signal?.aborted) throw cancelledError();
  }

  function byteLength(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    if (typeof Buffer === 'function') return Buffer.byteLength(text, 'utf8');
    return unescape(encodeURIComponent(text)).length;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isProbability(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  }

  function validateDecisionResponse(response, questions) {
    if (!isPlainObject(response) || !isPlainObject(response.answers)) throw invalidResponse();
    const questionIds = Object.keys(questions);
    const answerIds = Object.keys(response.answers);
    if (answerIds.length !== questionIds.length ||
        answerIds.some(id => !Object.prototype.hasOwnProperty.call(questions, id))) {
      throw invalidResponse();
    }
    for (const [id, question] of Object.entries(questions)) {
      const answer = response.answers[id];
      if (!isPlainObject(answer) || answer.type !== question.type) throw invalidResponse();
      if (question.type === 'noul') {
        if (!isProbability(answer.noul)) throw invalidResponse();
        continue;
      }
      if (question.type !== 'choice' || !isPlainObject(question.criteria)) {
        throw invalidResponse();
      }
      const options = Object.keys(question.criteria);
      if (!options.includes(answer.choice) || !isProbability(answer.confidence) ||
          !isPlainObject(answer.probabilities)) throw invalidResponse();
      const probabilityIds = Object.keys(answer.probabilities);
      if (probabilityIds.length !== options.length ||
          probabilityIds.some(option => !options.includes(option)) ||
          options.some(option => !isProbability(answer.probabilities[option]))) {
        throw invalidResponse();
      }
      const total = options.reduce((sum, option) => sum + answer.probabilities[option], 0);
      if (Math.abs(total - 1) > 0.01 + 1e-9) throw invalidResponse();
    }
    return response.answers;
  }

  function assertRoundSize(state, questions) {
    const stateBytes = byteLength(state);
    const questionBytes = Object.values(questions).map(byteLength);
    const longestQuestion = Math.max(0, ...questionBytes);
    // Reserve room for the model field and JSON envelope used by /v1/systemone.
    const envelopeReserve = 256;
    const totalPayloadBytes = byteLength({ state, questions }) + envelopeReserve;
    if (stateBytes + longestQuestion >
          JEV_HIGHLIGHT_LIMITS.stateAndLongestQuestionBytes - envelopeReserve ||
        totalPayloadBytes > JEV_HIGHLIGHT_LIMITS.totalInputBytes) {
      throw jevError('JEV_LIMIT_EXCEEDED',
        `TypeSafe decision state exceeded its explicit input limit (${stateBytes} bytes)`);
    }
    for (const question of Object.values(questions)) {
      if (question.type === 'choice' &&
          Object.keys(question.criteria || {}).length > JEV_HIGHLIGHT_LIMITS.choiceOptions) {
        throw jevError('JEV_LIMIT_EXCEEDED', 'TypeSafe choice exceeded 255 options');
      }
    }
  }

  async function evaluateRound(evaluate, state, questions, signal) {
    checkAbort(signal);
    assertRoundSize(state, questions);
    let response;
    try {
      response = await evaluate({ state, questions, signal });
    } catch (error) {
      if (signal?.aborted) throw cancelledError();
      throw error;
    }
    checkAbort(signal);
    return validateDecisionResponse(response, questions);
  }

  function isProtectedPeriod(text, index) {
    const previous = text[index - 1] || '';
    const next = text[index + 1] || '';
    if (/\d/u.test(previous) && /\d/u.test(next)) return true;
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const linePrefix = text.slice(lineStart, index);
    if (/^\s*(?:\d{1,3}|[A-Za-z])$/u.test(linePrefix) && /\s/u.test(next)) return true;
    const before = text.slice(0, index);
    const token = (before.match(/([A-Za-z](?:[A-Za-z.]*[A-Za-z])?)$/u)?.[1] || '').toLowerCase();
    if (COMMON_ABBREVIATIONS.has(token)) return true;
    if (/^[a-z]$/iu.test(token) && /[A-Za-z]/u.test(next)) return true;
    return false;
  }

  function layoutBoundaryAfter(text, index) {
    const after = text.slice(index + 1);
    const blankBlock = after.match(/^(?:[\t ]*\r?\n)+/u);
    if (blankBlock) return index + 1 + blankBlock[0].length;
    const listItem = /^[\t ]*(?:[-*•▪◦]|(?:\d{1,3}|[A-Za-z])[.)])[\t ]+/u;
    if (listItem.test(after)) return index + 1;
    return -1;
  }

  function occurrenceAt(text, quote, targetStart) {
    let from = 0;
    let occurrence = 0;
    while (from <= targetStart) {
      const found = text.indexOf(quote, from);
      if (found < 0 || found > targetStart) break;
      if (found === targetStart) return occurrence;
      occurrence += 1;
      from = found + quote.length;
    }
    return 0;
  }

  function splitScientificSentences(paragraph, paragraphIndex, globalStart) {
    const text = String(paragraph.text || '');
    const rawBounds = [];
    let segmentStart = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const layoutEnd = character === '\n' ? layoutBoundaryAfter(text, index) : -1;
      const boundary = layoutEnd >= 0 || '。！？!?'.includes(character) ||
        (character === '.' && !isProtectedPeriod(text, index));
      if (!boundary) continue;
      let end = layoutEnd >= 0 ? index : index + 1;
      if (layoutEnd < 0) {
        while (end < text.length && '。！？!?'.includes(text[end])) end += 1;
        while (end < text.length && /["'’”）)\]]/u.test(text[end])) end += 1;
      }
      rawBounds.push([segmentStart, end]);
      segmentStart = layoutEnd >= 0 ? layoutEnd : end;
      index = Math.max(index, (layoutEnd >= 0 ? layoutEnd : end) - 1);
    }
    if (segmentStart < text.length) rawBounds.push([segmentStart, text.length]);
    const sentences = [];
    for (const [rawStart, rawEnd] of rawBounds) {
      let start = rawStart;
      let end = rawEnd;
      while (start < end && /\s/u.test(text[start])) start += 1;
      while (end > start && /\s/u.test(text[end - 1])) end -= 1;
      if (end <= start) continue;
      const quote = text.slice(start, end);
      sentences.push({
        id: `s${globalStart + sentences.length}`,
        paragraphId: paragraph.paragraphId,
        paragraphIndex,
        sentenceIndex: sentences.length,
        start,
        end,
        text: quote,
        occurrence: occurrenceAt(text, quote, start)
      });
    }
    return sentences;
  }

  function parseRequest(request) {
    let promptInput = {};
    try {
      promptInput = JSON.parse(String(request?.userPrompt || '{}'));
    } catch (_error) {
      throw jevError('INVALID_REQUEST', 'TypeSafe highlighting requires a valid compiled userPrompt');
    }
    const sourceParagraphs = Array.isArray(request?.paragraphs) && request.paragraphs.length
      ? request.paragraphs
      : promptInput.paragraphs?.map(item => ({
        paragraphId: item.paragraph_id,
        sectionTitle: item.section_title,
        sectionKind: item.section_kind,
        text: item.text
      }));
    const paragraphs = (Array.isArray(sourceParagraphs) ? sourceParagraphs : []).map(item => ({
      paragraphId: String(item?.paragraphId || ''),
      sectionTitle: String(item?.sectionTitle || ''),
      sectionKind: String(item?.sectionKind || ''),
      text: String(item?.text || '')
    }));
    const categories = Array.isArray(request?.requestedCategories)
      ? request.requestedCategories : [];
    if (request?.schemaName !== 'scientific_annotations_v3' || !paragraphs.length ||
        paragraphs.some(item => !item.paragraphId) || !categories.length ||
        typeof request?.requestedCategories === 'undefined') {
      throw jevError('INVALID_REQUEST',
        'TypeSafe highlighting requires scientific_annotations_v3 paragraphs and categories');
    }
    return {
      chunkId: String(promptInput.chunk_id || request.chunkId || 'jev-chunk'),
      paragraphs,
      categories,
      signal: request.signal
    };
  }

  function publicSentence(sentence, allSentences) {
    const position = allSentences.indexOf(sentence);
    const previous = allSentences[position - 1];
    const next = allSentences[position + 1];
    return {
      paragraph_id: sentence.paragraphId,
      start: sentence.start,
      end: sentence.end,
      occurrence: sentence.occurrence,
      text: sentence.text,
      previous: previous && previous.paragraphId === sentence.paragraphId ? previous.text : '',
      next: next && next.paragraphId === sentence.paragraphId ? next.text : ''
    };
  }

  function categoryMeta(category, code) {
    const list = value => (Array.isArray(value) ? value.map(String) : []);
    const allowedRoles = list(category.allowedQuoteRoles ||
      category.prompt?.allowedQuoteRoles || ['statement']);
    return {
      code,
      category_id: String(category.categoryId || ''),
      name: String(category.name || ''),
      definition: String(category.definition || category.prompt?.definition || ''),
      decision_question: String(category.decisionQuestion ||
        category.prompt?.decisionQuestion || category.definition || ''),
      include: list(category.includeAll || category.includeWhen || category.prompt?.includeWhen),
      exclude: list(category.excludeAny || category.excludeWhen || category.prompt?.excludeWhen),
      positive_examples: list(category.positiveExamples || category.prompt?.positiveExamples),
      hard_negative_examples: list(category.hardNegativeExamples ||
        category.negativeExamples || category.prompt?.negativeExamples),
      claim_mode: String(category.claimMode || category.prompt?.claimMode || 'explicit'),
      required_slots: list(category.requiredSlots || category.prompt?.requiredSlots),
      allowed_roles: allowedRoles,
      role_meanings: Object.fromEntries(allowedRoles.map(role => [
        role, describeRole(role, category.categoryId)
      ])),
      relation_required: Boolean(category.relationRequired ?? category.prompt?.relationRequired),
      configured_meaning: true
    };
  }

  function screenQuestion(sentence, category) {
    return {
      type: 'noul',
      instructions: [
        `Judge sentence "${sentence.id}" against category "${category.code}".`,
        `Read the exact scientific text at state.sentences.${sentence.id}.text and its previous/next context.`,
        `Apply only the configured meaning, inclusions, exclusions, counterexamples and claim_mode at state.categories.${category.code}.`,
        'Return a high true probability only when the configured category is supported. Treat negation as evidence to preserve; reject it only when this category explicitly excludes that negated meaning. Ambiguity or missing required evidence favors false. Multiple categories are independent.'
      ].join(' '),
      criteria: {
        true: 'The exact source text satisfies the configured category meaning and all necessary evidence conditions.',
        false: 'The source meets a configured exclusion, is ambiguous, is ordinary non-matching text, or lacks required evidence.'
      }
    };
  }

  function buildScreenRound(pairs, allSentences) {
    const state = { phase: 'candidate_screen', sentences: {}, categories: {} };
    const questions = {};
    const decisions = {};
    pairs.forEach((pair, index) => {
      state.sentences[pair.sentence.id] ||= publicSentence(pair.sentence, allSentences);
      state.categories[pair.category.code] ||= pair.category.meta;
      const id = `screen_${index}`;
      questions[id] = screenQuestion(pair.sentence, pair.category.meta);
      decisions[id] = pair;
    });
    return { state, questions, decisions };
  }

  function roundFits(state, questions) {
    try {
      assertRoundSize(state, questions);
      return true;
    } catch (error) {
      if (error?.code !== 'JEV_LIMIT_EXCEEDED') throw error;
      return false;
    }
  }

  function partitionScreenPairs(pairs, allSentences) {
    const batches = [];
    let batch = [];
    for (const pair of pairs) {
      const attempted = [...batch, pair];
      const round = buildScreenRound(attempted, allSentences);
      if (attempted.length <= JEV_HIGHLIGHT_LIMITS.screenQuestionsPerBatch &&
          roundFits(round.state, round.questions)) {
        batch = attempted;
        continue;
      }
      if (!batch.length) {
        throw jevError('JEV_LIMIT_EXCEEDED',
          `One sentence/category decision exceeds TypeSafe limits: ${pair.sentence.id}/${pair.category.meta.category_id}`);
      }
      batches.push(batch);
      batch = [pair];
      const single = buildScreenRound(batch, allSentences);
      if (!roundFits(single.state, single.questions)) {
        throw jevError('JEV_LIMIT_EXCEEDED',
          `One sentence/category decision exceeds TypeSafe limits: ${pair.sentence.id}/${pair.category.meta.category_id}`);
      }
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  function configuredAsBuiltIn(category, defaults) {
    const defaultCategory = defaults?.[category.categoryId];
    if (!defaultCategory) return false;
    if (typeof shared.usesBuiltInCategorySemantics === 'function') {
      return shared.usesBuiltInCategorySemantics(category, defaultCategory) !== false;
    }
    return category.builtIn !== false;
  }

  function requiredRoles(category, defaults) {
    const roles = [];
    if (configuredAsBuiltIn(category, defaults)) {
      roles.push(...(BUILT_IN_REQUIRED_ROLES[category.categoryId] || []));
    }
    if ((category.claimMode || category.prompt?.claimMode) === 'inferred') {
      roles.push('claim', 'evidence');
    }
    return [...new Set(roles)];
  }

  function contextFor(candidate, allSentences) {
    const position = allSentences.indexOf(candidate);
    const radius = JEV_HIGHLIGHT_LIMITS.contextRadius;
    return allSentences.slice(Math.max(0, position - radius), position + radius + 1);
  }

  function probabilityFor(answers, questionId) {
    const answer = answers[questionId];
    return answer.probabilities[answer.choice];
  }

  function tokenizeExact(text) {
    const tokens = [];
    const nonHanWord = '(?:(?!\\p{Script=Han})[\\p{L}\\p{N}\\p{M}])+';
    const pattern = new RegExp(
      `[\\p{Script=Han}]|${nonHanWord}(?:[+\\-−–./<>=≤≥×^%′'’]${nonHanWord})*|[^\\s]`,
      'gu'
    );
    for (const match of String(text || '').matchAll(pattern)) {
      tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
    }
    return tokens;
  }

  function describeRole(role, categoryId = '') {
    const id = String(role || 'statement');
    const human = id.replace(/_/gu, ' ');
    if (categoryId === 'necessity_evidence' && id === 'upstream_effect') {
      return 'The exact text identifies the original upstream-factor to target-outcome effect being tested. This relationship may be grammatically embedded inside the same blocking result, such as a target outcome described as induced by an upstream factor; it need not be a separate sentence.';
    }
    if (id === 'claim') {
      return 'The exact author claim whose scientific strength or validity is being assessed; this role can coexist with evidence in one sentence.';
    }
    if (id === 'evidence') {
      return 'The exact observed, measured, or design evidence used to assess the related claim; this role can coexist with a claim in one sentence.';
    }
    if (/(?:outcome|effect|finding|result|abnormality)$/u.test(id)) {
      return `The exact text that directly reports the ${human} result or outcome component required by the configured relationship; other roles may occur in the same sentence.`;
    }
    if (/(?:action|activation|intervention|mediator|cause)$/u.test(id) ||
        /^(?:blocked|rescue|upstream)/u.test(id)) {
      return `The exact text that directly reports the ${human} action or causal component required by the configured relationship; other roles may occur in the same sentence.`;
    }
    return `The exact text that directly supplies the ${human} evidence component required by the configured category relationship; other configured roles may occur in the same sentence.`;
  }

  function stableId(prefix, value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function candidateThreshold(candidate) {
    const category = candidate.category.category;
    const value = Number(category.minimumConfidence ?? category.prompt?.minimumConfidence);
    return Number.isFinite(value) ? value : 0.8;
  }

  function candidateRoles(candidate) {
    return (candidate.category.category.allowedQuoteRoles ||
      candidate.category.category.prompt?.allowedQuoteRoles || ['statement'])
      .map(String).filter(Boolean);
  }

  function buildRoleRound(candidates, allSentences) {
    const state = { phase: 'candidate_role', candidates: {}, roles: {} };
    const questions = {};
    const decisions = {};
    candidates.forEach((candidate, index) => {
      const key = `candidate_${index}`;
      const roles = candidateRoles(candidate);
      state.candidates[key] = {
        sentence: publicSentence(candidate.sentence, allSentences),
        category: candidate.category.meta
      };
      roles.forEach((role, roleIndex) => {
        const roleKey = `${key}_role_${roleIndex}`;
        state.roles[roleKey] = {
          id: role,
          meaning: describeRole(role, candidate.category.category.categoryId)
        };
        questions[roleKey] = {
          type: 'noul',
          instructions: [
            `ROLE_EVIDENCE candidate "${key}" role "${roleKey}".`,
            `Judge independently whether state.candidates.${key}.sentence.text directly supplies the evidence meaning at state.roles.${roleKey}.meaning for the configured category at state.candidates.${key}.category.`,
            'Several roles may be true for the same scientific sentence. Require explicit source evidence; a role name alone or an adjacent concept is insufficient.'
          ].join(' '),
          criteria: {
            true: 'The exact candidate sentence directly supplies this role in the configured relationship.',
            false: 'This role is absent, only implied without evidence, or belongs to a different relationship.'
          }
        };
        decisions[roleKey] = { candidate, role, roleIndex };
      });
    });
    return { state, questions, decisions };
  }

  function partitionRoleCandidates(candidates, allSentences) {
    const batches = [];
    let batch = [];
    for (const candidate of candidates) {
      const roles = candidateRoles(candidate);
      if (!roles.length || roles.length + 1 > JEV_HIGHLIGHT_LIMITS.choiceOptions) continue;
      const attempted = [...batch, candidate];
      const round = buildRoleRound(attempted, allSentences);
      if (Object.keys(round.questions).length <=
            JEV_HIGHLIGHT_LIMITS.screenQuestionsPerBatch &&
          roundFits(round.state, round.questions)) {
        batch = attempted;
        continue;
      }
      if (!batch.length) {
        throw jevError('JEV_LIMIT_EXCEEDED',
          `One candidate role decision exceeds TypeSafe limits: ${candidate.sentence.id}`);
      }
      batches.push(batch);
      batch = [candidate];
      const single = buildRoleRound(batch, allSentences);
      if (!roundFits(single.state, single.questions)) {
        throw jevError('JEV_LIMIT_EXCEEDED',
          `One candidate role decision exceeds TypeSafe limits: ${candidate.sentence.id}`);
      }
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  async function selectCandidateRoles(candidates, allSentences, evaluate, signal) {
    const selected = [];
    for (const batch of partitionRoleCandidates(candidates, allSentences)) {
      const round = buildRoleRound(batch, allSentences);
      const answers = await evaluateRound(evaluate, round.state, round.questions, signal);
      const byCandidate = new Map(batch.map(candidate => [candidate, []]));
      for (const [questionId, decision] of Object.entries(round.decisions)) {
        const probability = answers[questionId].noul;
        byCandidate.get(decision.candidate).push({
          role: decision.role,
          roleIndex: decision.roleIndex,
          probability
        });
      }
      for (const candidate of batch) {
        const passing = byCandidate.get(candidate)
          .filter(item => item.probability >= candidateThreshold(candidate))
          .sort((left, right) => right.probability - left.probability ||
            left.roleIndex - right.roleIndex);
        if (!passing.length) continue;
        const primary = passing[0];
        selected.push({
          ...candidate,
          primaryRole: primary.role,
          roleProbability: primary.probability,
          roleScores: Object.fromEntries(
            byCandidate.get(candidate).map(item => [item.role, item.probability])
          )
        });
      }
    }
    return selected;
  }

  async function findMissingRoleSupport({ missingRoles, candidate, context, stateBase,
    evaluate, signal, threshold }) {
    if (!missingRoles.length) return [];
    const supportContext = context.filter(sentence => sentence.id !== candidate.sentence.id);
    if (!supportContext.length) return null;
    const state = {
      ...stateBase,
      phase: 'support_role',
      context: Object.fromEntries(supportContext.map(sentence => [
        sentence.id, publicSentence(sentence, context)
      ])),
      roles: Object.fromEntries(missingRoles.map((role, index) => [
        `role_${index}`, {
          id: role,
          meaning: describeRole(role, candidate.category.category.categoryId)
        }
      ]))
    };
    const questions = {};
    const decisions = {};
    missingRoles.forEach((role, roleIndex) => {
      supportContext.forEach((sentence, sentenceIndex) => {
        const id = `support_${roleIndex}_${sentenceIndex}`;
        questions[id] = {
          type: 'noul',
          instructions: [
            `SUPPORT_ROLE sentence "${sentence.id}" role "role_${roleIndex}".`,
            `Judge independently whether state.context.${sentence.id}.text directly supplies state.roles.role_${roleIndex}.meaning as evidence for the same relationship as state.candidate.text under state.category.`,
            'Require exact scientific evidence, not topical proximity. Multiple roles or sentences may be true.'
          ].join(' '),
          criteria: {
            true: 'This exact context sentence directly supplies the missing role for the candidate relationship.',
            false: 'It does not supply that role for the same relationship.'
          }
        };
        decisions[id] = { role, sentence };
      });
    });
    const answers = await evaluateRound(evaluate, state, questions, signal);
    const selected = [];
    for (const role of missingRoles) {
      const best = Object.entries(decisions)
        .filter(([, decision]) => decision.role === role)
        .map(([id, decision]) => ({ ...decision, probability: answers[id].noul }))
        .sort((left, right) => right.probability - left.probability)[0];
      if (!best || best.probability < threshold) return null;
      selected.push(best);
    }
    return selected;
  }

  async function groundCandidate({ candidate, category, categoryCode, allSentences,
    paragraphs, chunkId, evaluate, signal, defaults }) {
    const threshold = candidateThreshold(candidate);
    const allowedRoles = (category.allowedQuoteRoles || category.prompt?.allowedQuoteRoles || ['statement'])
      .map(String).filter(Boolean);
    if (!allowedRoles.length || allowedRoles.length + 1 > JEV_HIGHLIGHT_LIMITS.choiceOptions) return null;
    const context = contextFor(candidate.sentence, allSentences);
    const stateBase = {
      phase: 'candidate_grounding',
      candidate: publicSentence(candidate.sentence, allSentences),
      category: categoryMeta(category, categoryCode),
      context: Object.fromEntries(context.map(item => [item.id, publicSentence(item, allSentences)]))
    };
    const primaryRole = candidate.primaryRole;
    if (!allowedRoles.includes(primaryRole)) throw invalidResponse();
    let confidence = Math.min(candidate.score, candidate.roleProbability);
    const neededRoles = requiredRoles(category, defaults);
    if (neededRoles.some(role => !allowedRoles.includes(role))) return null;
    const supportSelections = [];
    const missingRoles = [];
    for (const role of neededRoles) {
      if (role === primaryRole) continue;
      const probability = Number(candidate.roleScores?.[role]);
      if (isProbability(probability) && probability >= threshold) {
        confidence = Math.min(confidence, probability);
        supportSelections.push({ sentence: candidate.sentence, role, probability });
      } else {
        missingRoles.push(role);
      }
    }
    const contextualSupport = await findMissingRoleSupport({
      missingRoles, candidate, context, stateBase, evaluate, signal, threshold
    });
    if (contextualSupport === null) return null;
    for (const support of contextualSupport) {
      confidence = Math.min(confidence, support.probability);
      supportSelections.push(support);
    }
    const highlightQuotes = [{
      paragraph_id: candidate.sentence.paragraphId,
      quote: candidate.sentence.text,
      occurrence: candidate.sentence.occurrence,
      role: primaryRole
    }];
    const supportQuotes = supportSelections.map(({ sentence, role }) => ({
      paragraph_id: sentence.paragraphId,
      quote: sentence.text,
      occurrence: sentence.occurrence,
      role
    }));
    const requiredSlots = (category.requiredSlots || category.prompt?.requiredSlots || [])
      .map(String).filter(Boolean);
    const slots = [];
    if (requiredSlots.length) {
      const quoteSentences = [...new Map(
        [candidate.sentence, ...supportSelections.map(item => item.sentence)]
          .map(sentence => [sentence.id, sentence])
      ).values()];
      const tokenOptions = {};
      const quotes = {};
      for (const sentence of quoteSentences) {
        quotes[sentence.id] = publicSentence(sentence, allSentences);
        tokenizeExact(sentence.text).forEach((token, index) => {
          tokenOptions[`${sentence.id}_t${index}`] = { sentence: sentence.id, ...token };
        });
      }
      if (!Object.keys(tokenOptions).length ||
          Object.keys(tokenOptions).length > JEV_HIGHLIGHT_LIMITS.slotTokens) {
        throw jevError('JEV_LIMIT_EXCEEDED',
          `Grounding ${category.categoryId} requires more than 254 exact token choices`);
      }
      const tokenCriteria = Object.fromEntries(Object.entries(tokenOptions).map(([id, token]) => [
        id, `Exact token ${JSON.stringify(token.text)} at state.quotes.${token.sentence}.text UTF-16 [${token.start},${token.end}).`
      ]));
      tokenCriteria.none = 'No exact short source span can fill this required slot.';
      const startQuestions = {};
      requiredSlots.forEach((slot, index) => {
        startQuestions[`slot_start_${index}`] = {
          type: 'choice',
          instructions: `SLOT_START slot "${slot}" Select the first exact token of the smallest verbatim span that still expresses this required slot under state.category. Include any direction, negation, comparison, or qualifier needed for the slot's scientific meaning; do not use the whole sentence as a placeholder. The value must be grounded in state.quotes. Choose none if absent.`,
          criteria: tokenCriteria
        };
      });
      const startState = { ...stateBase, phase: 'slot_start_grounding', quotes,
        token_options: tokenOptions };
      const startAnswers = await evaluateRound(evaluate, startState, startQuestions, signal);
      const selectedStarts = {};
      for (const [index, name] of requiredSlots.entries()) {
        const answer = startAnswers[`slot_start_${index}`];
        if (answer.choice === 'none') return null;
        const token = tokenOptions[answer.choice];
        if (!token) throw invalidResponse();
        selectedStarts[`slot_${index}`] = {
          name,
          option_id: answer.choice,
          sentence: token.sentence,
          text: token.text,
          start: token.start,
          end: token.end
        };
      }
      const endQuestions = {};
      for (const [index, name] of requiredSlots.entries()) {
        const selected = selectedStarts[`slot_${index}`];
        const sentenceOptions = Object.entries(tokenOptions)
          .filter(([, token]) => token.sentence === selected.sentence)
          .sort((left, right) => left[1].start - right[1].start);
        const selectedIndex = sentenceOptions.findIndex(([id]) => id === selected.option_id);
        if (selectedIndex < 0) throw invalidResponse();
        const eligible = sentenceOptions.slice(
          selectedIndex,
          selectedIndex + JEV_HIGHLIGHT_LIMITS.slotTokenSpan
        );
        if (!eligible.length) return null;
        const endCriteria = Object.fromEntries(eligible.map(([id]) => [id, tokenCriteria[id]]));
        endCriteria.none = tokenCriteria.none;
        endQuestions[`slot_end_${index}`] = {
          type: 'choice',
          instructions: [
            `SLOT_END slot "${name}" The selected start is state.selected_starts.slot_${index}, at the exact source token and UTF-16 offset recorded there.`,
            'Select the closest, shortest ending token (inclusive) at or after that selected start which makes the span a complete semantic instance of the required slot under state.category.',
            'Preserve direction, negation, comparison, and necessary qualifiers, while excluding unrelated sentence material. Choose none if no complete short span starts there.'
          ].join(' '),
          criteria: endCriteria
        };
      }
      const endState = {
        ...stateBase,
        phase: 'slot_end_grounding',
        quotes,
        token_options: tokenOptions,
        selected_starts: selectedStarts
      };
      const endAnswers = await evaluateRound(evaluate, endState, endQuestions, signal);
      for (const [index, name] of requiredSlots.entries()) {
        const startId = `slot_start_${index}`;
        const endId = `slot_end_${index}`;
        const startAnswer = startAnswers[startId];
        const endAnswer = endAnswers[endId];
        if (startAnswer.choice === 'none' || endAnswer.choice === 'none') return null;
        const start = tokenOptions[startAnswer.choice];
        const end = tokenOptions[endAnswer.choice];
        if (!start || !end || start.sentence !== end.sentence || start.start > end.start) return null;
        const sentenceTokens = Object.values(tokenOptions)
          .filter(token => token.sentence === start.sentence &&
            token.start >= start.start && token.end <= end.end);
        if (!sentenceTokens.length || sentenceTokens.length > JEV_HIGHLIGHT_LIMITS.slotTokenSpan) return null;
        const quote = quotes[start.sentence].text;
        const value = quote.slice(start.start, end.end);
        if (!value || value === quote.trim() || value.length > 256) return null;
        slots.push({ name, value });
      }
      const selectedSlots = Object.fromEntries(slots.map((slot, index) => [
        `slot_${index}`, slot
      ]));
      const validationQuestions = Object.fromEntries(slots.map((slot, index) => [
        `slot_${index}`,
        {
          type: 'noul',
          instructions: [
            `Validate slot "${slot.name}" at state.selected_slots.slot_${index}.value.`,
            'Judge whether this selected exact source span directly expresses the configured required slot under state.category, using state.quotes as evidence.',
            'A merely adjacent entity, full-sentence placeholder, paraphrase, or semantically wrong boundary is false.'
          ].join(' '),
          criteria: {
            true: 'The exact selected span directly and specifically fills this required slot.',
            false: 'The span is absent, too broad, incomplete, adjacent-only, or has the wrong semantic role.'
          }
        }
      ]));
      const validationState = {
        ...stateBase,
        phase: 'slot_validation',
        quotes,
        selected_slots: selectedSlots
      };
      const validationAnswers = await evaluateRound(
        evaluate, validationState, validationQuestions, signal
      );
      for (let index = 0; index < slots.length; index += 1) {
        const probability = validationAnswers[`slot_${index}`].noul;
        if (probability < threshold) return null;
        confidence = Math.min(confidence, probability);
      }
    }
    if (confidence < threshold) return null;
    const identity = {
      chunkId, categoryId: category.categoryId, paragraphId: candidate.sentence.paragraphId,
      quote: candidate.sentence.text, occurrence: candidate.sentence.occurrence,
      primaryRole, supportQuotes, slots
    };
    const annotation = {
      annotation_id: stableId('jev-ann', identity),
      relation_id: Boolean(category.relationRequired ?? category.prompt?.relationRequired)
        ? stableId('jev-rel', identity) : '',
      category_id: category.categoryId,
      claim_mode: (category.claimMode || category.prompt?.claimMode) === 'inferred'
        ? 'inferred' : 'explicit',
      provenance: 'current',
      highlight_quotes: highlightQuotes,
      support_quotes: supportQuotes,
      slots,
      confidence,
      reason_zh: 'Jev类别判断，原文证据已定位'
    };
    if (typeof shared.validateChunkResult !== 'function') {
      throw jevError('INVALID_REQUEST', 'Result validator is unavailable for TypeSafe highlighting');
    }
    const admitted = shared.validateChunkResult({
      paragraphs,
      requestedCategories: [category],
      requestedCategoryIds: [category.categoryId],
      response: {
        chunk_id: chunkId,
        paragraphs_reviewed: paragraphs.map(item => item.paragraphId),
        annotations: [annotation]
      },
      expectedChunkId: chunkId
    });
    if (admitted.rejected.length || admitted.annotations.length !== highlightQuotes.length) return null;
    return annotation;
  }

  async function analyzeJevHighlights(request, evaluate) {
    if (typeof evaluate !== 'function') {
      throw jevError('INVALID_REQUEST', 'TypeSafe highlighting requires a typed evaluator');
    }
    const { chunkId, paragraphs, categories, signal } = parseRequest(request);
    checkAbort(signal);
    const allSentences = [];
    paragraphs.forEach((paragraph, paragraphIndex) => {
      allSentences.push(...splitScientificSentences(
        paragraph, paragraphIndex, allSentences.length
      ));
    });
    const categoryEntries = categories.map((item, index) => ({
      category: item,
      code: `c${index}`,
      meta: categoryMeta(item, `c${index}`)
    }));
    const pairs = allSentences.flatMap(sentence => categoryEntries.map(category => ({
      sentence, category
    })));
    const candidates = [];
    const batches = partitionScreenPairs(pairs, allSentences);
    for (const batch of batches) {
      const round = buildScreenRound(batch, allSentences);
      const answers = await evaluateRound(evaluate, round.state, round.questions, signal);
      for (const [questionId, pair] of Object.entries(round.decisions)) {
        const score = answers[questionId].noul;
        const threshold = Number.isFinite(Number(
          pair.category.category.minimumConfidence ?? pair.category.category.prompt?.minimumConfidence
        )) ? Number(pair.category.category.minimumConfidence ??
          pair.category.category.prompt?.minimumConfidence) : 0.8;
        if (score >= threshold) candidates.push({ ...pair, score });
      }
    }
    let defaults = {};
    try {
      defaults = shared.createUnifiedCategoryCatalog?.() ||
        shared.createAdaptiveCategoryCatalog?.() || shared.createBuiltInCategories?.() || {};
    } catch (_error) {
      defaults = shared.createAdaptiveCategoryCatalog?.() || shared.createBuiltInCategories?.() || {};
    }
    const roleSelectedCandidates = await selectCandidateRoles(
      candidates, allSentences, evaluate, signal
    );
    const annotations = [];
    for (const candidate of roleSelectedCandidates) {
      checkAbort(signal);
      const annotation = await groundCandidate({
        candidate,
        category: candidate.category.category,
        categoryCode: candidate.category.code,
        allSentences,
        paragraphs,
        chunkId,
        evaluate,
        signal,
        defaults
      });
      if (annotation) annotations.push(annotation);
    }
    const result = {
      chunk_id: chunkId,
      paragraphs_reviewed: paragraphs.map(item => item.paragraphId),
      annotations
    };
    const checked = shared.validateChunkResult({
      paragraphs,
      requestedCategories: categories,
      requestedCategoryIds: categories.map(item => item.categoryId),
      response: result,
      expectedChunkId: chunkId
    });
    if (checked.rejected.length || checked.missingParagraphIds.length) {
      throw jevError('INVALID_RESPONSE',
        'TypeSafe annotations failed the existing v3 result validator', true);
    }
    return result;
  }

  return {
    JEV_HIGHLIGHT_ALGORITHM_VERSION,
    JEV_HIGHLIGHT_LIMITS,
    analyzeJevHighlights
  };
});
