(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const REFERENCES_INTENT = /(?:references?|bibliograph|citations?|参考文献|引文|文献列表)/iu;
  const BROAD_QUERY = /(?:全文|整篇|概括|总结|主要发现|研究背景|结论|overall|overview|full\s+(?:paper|article|text)|main\s+findings?|summari[sz]e)/iu;
  const BROAD_SECTION_KINDS = ['abstract', 'introduction', 'results', 'discussion', 'conclusion'];

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
  }

  function isBroadArticleChatQuery(query) {
    return BROAD_QUERY.test(normalize(query));
  }

  function reciprocalRankFusion(rankings, constant = 60) {
    const scores = new Map();
    (Array.isArray(rankings) ? rankings : []).forEach(ranking => {
      (Array.isArray(ranking) ? ranking : []).forEach((id, index) => {
        scores.set(id, (scores.get(id) || 0) + 1 / (constant + index + 1));
      });
    });
    return scores;
  }

  function jaccard(left, right) {
    const first = new Set(left || []);
    const second = new Set(right || []);
    if (!first.size || !second.size) return 0;
    let intersection = 0;
    first.forEach(token => { if (second.has(token)) intersection += 1; });
    return intersection / (first.size + second.size - intersection);
  }

  function maximalMarginalRelevance(candidates, options = {}) {
    const source = (Array.isArray(candidates) ? candidates : []).slice();
    const limit = Math.max(0, Math.min(source.length, Number(options.limit) || 8));
    const lambda = Math.max(0, Math.min(1, Number(options.lambda) || 0.72));
    const maxScore = Math.max(1, ...source.map(item => Number(item.score) || 0));
    const selected = [];
    const remaining = source.slice();
    while (selected.length < limit && remaining.length) {
      const ranked = remaining.map(item => {
        const redundancy = selected.length ? Math.max(...selected.map(chosen =>
          jaccard(item.tokens, chosen.tokens) +
          (item.sectionId && item.sectionId === chosen.sectionId ? 0.25 : 0)
        )) : 0;
        return {
          item,
          mmr: lambda * ((Number(item.score) || 0) / maxScore) -
            (1 - lambda) * redundancy
        };
      }).sort((left, right) => right.mmr - left.mmr ||
        (right.item.score || 0) - (left.item.score || 0));
      const next = ranked[0].item;
      selected.push(next);
      remaining.splice(remaining.indexOf(next), 1);
    }
    return selected;
  }

  function cosine(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) {
      return 0;
    }
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
      const a = Number(left[index]) || 0;
      const b = Number(right[index]) || 0;
      dot += a * b;
      leftNorm += a * a;
      rightNorm += b * b;
    }
    return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
  }

  function bm25Score(index, chunk, queryTokens) {
    const k1 = 1.5;
    const b = 0.75;
    const count = Math.max(1, index.chunks.length);
    const average = Math.max(1, Number(index.averageDocumentLength) || 1);
    return queryTokens.reduce((sum, token) => {
      const frequency = Number(chunk.termFrequencies?.[token]) || 0;
      if (!frequency) return sum;
      const documentFrequency = Number(index.documentFrequencies?.[token]) || 0;
      const idf = Math.log(1 + (count - documentFrequency + 0.5) /
        (documentFrequency + 0.5));
      const denominator = frequency + k1 *
        (1 - b + b * (chunk.tokenCount / average));
      return sum + idf * ((frequency * (k1 + 1)) / denominator);
    }, 0);
  }

  function quotedPhrases(query) {
    const phrases = [];
    for (const match of String(query || '').matchAll(/["“”]([^"“”]{2,160})["“”]/gu)) {
      const phrase = normalize(match[1]);
      if (phrase) phrases.push(phrase);
    }
    return phrases;
  }

  function sectionBoost(chunk, normalizedQuery) {
    const title = normalize(chunk.sectionTitle);
    if (title && normalizedQuery.includes(title)) return 3;
    const kind = normalize(chunk.sectionKind);
    const aliases = {
      abstract: /(?:abstract|摘要)/u,
      introduction: /(?:introduction|background|引言|背景)/u,
      methods: /(?:methods?|方法)/u,
      results: /(?:results?|findings?|结果|发现)/u,
      discussion: /(?:discussion|讨论|局限)/u,
      conclusion: /(?:conclusions?|结论)/u,
      reference: /(?:references?|参考文献)/u
    };
    return aliases[kind]?.test(normalizedQuery) ? 2 : 0;
  }

  function fitWithinBudget(items, maxChars) {
    const selected = [];
    let characters = 0;
    for (const item of items) {
      const cost = item.text.length + (selected.length ? 2 : 0);
      if (selected.length && characters + cost > maxChars) continue;
      selected.push(item);
      characters += cost;
      if (characters >= maxChars) break;
    }
    return selected;
  }

  function ensureBroadCoverage(selected, candidates, limit) {
    const result = selected.slice();
    for (const kind of BROAD_SECTION_KINDS) {
      if (result.some(item => item.sectionKind === kind)) continue;
      const representative = candidates.find(item => item.sectionKind === kind);
      if (!representative) continue;
      if (result.length >= limit) {
        const replaceIndex = [...result].reverse().findIndex(item =>
          result.filter(other => other.sectionKind === item.sectionKind).length > 1);
        if (replaceIndex >= 0) result.splice(result.length - 1 - replaceIndex, 1);
        else continue;
      }
      result.push(representative);
    }
    return result;
  }

  async function retrieveArticleChatContext(index, query, options = {}) {
    if (!index || !Array.isArray(index.chunks)) throw new TypeError('A valid article chat index is required');
    if (typeof shared.tokenizeRetrievalQuery !== 'function') {
      throw new Error('article-chat-tokenizer must be loaded before article-chat-retrieval');
    }
    const normalizedQuery = normalize(query);
    const queryTokens = shared.tokenizeRetrievalQuery(query, 128);
    const referencesIntent = REFERENCES_INTENT.test(normalizedQuery);
    const broadQuery = isBroadArticleChatQuery(normalizedQuery);
    const phrases = quotedPhrases(query);
    const eligible = index.chunks.filter(chunk =>
      referencesIntent || chunk.recordType !== 'reference');
    const scored = eligible.map(chunk => {
      const normalizedText = normalize(chunk.text);
      const bm25 = bm25Score(index, chunk, queryTokens);
      const exactPhraseBoost = phrases.reduce((sum, phrase) =>
        sum + (normalizedText.includes(phrase) ? 5 : 0), 0);
      const headingBoost = sectionBoost(chunk, normalizedQuery);
      return {
        ...chunk,
        score: bm25 + exactPhraseBoost + headingBoost,
        explanation: {
          bm25,
          exactPhraseBoost,
          sectionBoost: headingBoost,
          embeddingSimilarity: 0,
          rrf: 0
        }
      };
    });
    const lexical = scored.slice().sort((left, right) =>
      right.score - left.score || left.position - right.position);
    const rankings = [lexical.map(item => item.chunkId)];
    let embeddingUsed = false;
    if (typeof options.embedTexts === 'function' && scored.length) {
      const vectors = await options.embedTexts([query, ...scored.map(item => item.text)]);
      if (Array.isArray(vectors) && vectors.length === scored.length + 1) {
        embeddingUsed = true;
        scored.forEach((item, indexValue) => {
          item.explanation.embeddingSimilarity = cosine(vectors[0], vectors[indexValue + 1]);
        });
        rankings.push(scored.slice().sort((left, right) =>
          right.explanation.embeddingSimilarity - left.explanation.embeddingSimilarity
        ).map(item => item.chunkId));
      }
    }
    const fused = reciprocalRankFusion(rankings);
    scored.forEach(item => {
      item.explanation.rrf = fused.get(item.chunkId) || 0;
      item.score += item.explanation.rrf * 10 +
        Math.max(0, item.explanation.embeddingSimilarity) * 2;
    });
    const candidates = scored.sort((left, right) =>
      right.score - left.score || left.position - right.position);
    const limit = Math.max(1, Math.min(candidates.length || 1, Number(options.limit) || 8));
    let selected = maximalMarginalRelevance(candidates, {
      limit,
      lambda: options.mmrLambda ?? 0.72
    });
    if (broadQuery) selected = ensureBroadCoverage(selected, candidates, limit);

    const neighborRadius = Math.max(0, Math.min(3, Number(options.neighborRadius ?? 1)));
    const selectedIds = new Set(selected.map(item => item.chunkId));
    const neighborDecisions = [];
    const rankedSeeds = selected.slice();
    for (const seed of rankedSeeds) {
      for (let distance = 1; distance <= neighborRadius; distance += 1) {
        for (const direction of [-1, 1]) {
          const candidate = candidates.find(item =>
            item.position === seed.position + distance * direction);
          if (!candidate || candidate.sectionId !== seed.sectionId ||
              candidate.recordType !== seed.recordType) continue;
          const included = !selectedIds.has(candidate.chunkId);
          neighborDecisions.push({
            seedChunkId: seed.chunkId,
            chunkId: candidate.chunkId,
            included,
            distance: distance * direction,
            reason: 'same-section-neighbor'
          });
          if (included) {
            selected.push(candidate);
            selectedIds.add(candidate.chunkId);
          }
        }
      }
    }
    selected.sort((left, right) => {
      const leftRank = rankedSeeds.findIndex(item => item.chunkId === left.chunkId);
      const rightRank = rankedSeeds.findIndex(item => item.chunkId === right.chunkId);
      if (leftRank >= 0 || rightRank >= 0) {
        if (leftRank < 0) return 1;
        if (rightRank < 0) return -1;
        return leftRank - rightRank;
      }
      return left.position - right.position;
    });
    const maxChars = Math.max(200, Number(options.maxChars) || 12000);
    selected = fitWithinBudget(selected, maxChars);
    const selectedChars = selected.reduce((sum, item) => sum + item.text.length, 0);
    return {
      indexId: index.indexId,
      query: String(query || ''),
      queryTokens,
      chunks: selected,
      neighborDecisions,
      selectedChars,
      coverage: {
        broadQuery,
        referencesIntent,
        embeddingUsed,
        candidateCount: candidates.length,
        selectedChunkCount: selected.length,
        selectedChars,
        selectedSectionKinds: [...new Set(selected.map(item => item.sectionKind))],
        selectedParagraphCount: new Set(selected.flatMap(item => item.paragraphIds)).size
      }
    };
  }

  return {
    reciprocalRankFusion,
    maximalMarginalRelevance,
    isBroadArticleChatQuery,
    retrieveArticleChatContext
  };
});
