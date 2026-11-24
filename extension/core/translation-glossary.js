/* Local terminology index for reading and translation. A model request may receive the terms matched by its own headings. */
(() => {
  'use strict';
  if (globalThis.BrevessTranslationGlossary) return;
  const key = 'sciGlobalAbbreviationMemoryV1';
  const storageCaches = new WeakMap();
  const word = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{M}\p{N}_]/u;
  const joinsWord = (text, i) =>
    i >= 0 &&
    i < text.length &&
    (word.test(text[i]) ||
      (i > 0 &&
        i + 1 < text.length &&
        /[-.‐‑]/u.test(text[i]) &&
        word.test(text[i - 1]) &&
        word.test(text[i + 1])));
  const clean = (value) => (typeof value === 'string' ? value.trim() : '');
  const empty = { find: () => [], signatures: new Map(), identity: '' };

  function compile(value, reverse = false) {
    const entries = Array.isArray(value) ? value : value?.entries;
    if (!Array.isArray(entries) || !entries.length) return empty;
    const aliases = new Map();
    function add(term, target, exact) {
      if (!term || !target || term === target || term.length > 512) return;
      const spelling = exact ? term : term.toLowerCase();
      const id = (exact ? 'a:' : 'w:') + spelling;
      if (!aliases.has(id)) aliases.set(id, [spelling, target, exact]);
      else if (aliases.get(id)[1] !== target) aliases.get(id)[1] = null;
    }
    for (const entry of entries) {
      if (!entry || entry.hiddenFromReading) continue;
      const zh = clean(entry.meaningZh),
        en = clean(entry.fullName),
        abbr = clean(entry.abbreviation);
      if (!zh) continue;
      if (reverse) add(zh, en || abbr, true);
      else {
        add(abbr, zh, true);
        add(en, zh, false);
      }
    }
    const rows = [...aliases.values()]
      .filter((row) => row[1])
      .sort(([a, , x], [b, , y]) => (a < b ? -1 : a > b ? 1 : Number(x) - Number(y)));
    if (!rows.length) return empty;
    const trie = new Map();
    for (const row of rows) {
      let node = trie;
      for (const c of row[0].toLowerCase()) {
        if (!node.has(c)) node.set(c, new Map());
        node = node.get(c);
      }
      node.set('', [...(node.get('') || []), row]);
    }
    function find(source, excluded = []) {
      const spans = [];
      let skip = 0;
      for (let i = 0; i < source.length; ) {
        while (skip < excluded.length && excluded[skip].sourceEnd <= i) skip++;
        if (excluded[skip]?.sourceStart <= i) {
          i = excluded[skip].sourceEnd;
          continue;
        }
        if (i && joinsWord(source, i - 1) && word.test(source[i])) {
          i++;
          continue;
        }
        let node = trie,
          best = null;
        for (let end = i; end < source.length && end < (excluded[skip]?.sourceStart ?? Infinity); ) {
          const c = String.fromCodePoint(source.codePointAt(end));
          end += c.length;
          node = node.get(c.toLowerCase());
          if (!node) break;
          if (!node.has('') || (end < source.length && word.test(c) && joinsWord(source, end))) continue;
          const text = source.slice(i, end);
          const row = node.get('').find(([term, , exact]) => !exact || term === text);
          if (row) best = { sourceStart: i, sourceEnd: end, text, displayText: text, target: row[1] };
        }
        if (!best) {
          i++;
          continue;
        }
        const previous = spans.at(-1);
        // Standard full-name (ABBR) definitions should keep their original acronym.
        if (
          previous?.target === best.target &&
          /^\s*[（(]\s*$/u.test(source.slice(previous.sourceEnd, i)) &&
          /^\s*[）)]/u.test(source.slice(best.sourceEnd))
        )
          best.target = best.text;
        spans.push(best);
        i = best.sourceEnd;
      }
      return spans;
    }
    return { find, identity: JSON.stringify(rows), signatures: new Map() };
  }
  // Match entire section headings only. A word such as "Abstract" in a scientific
  // finding remains available to the regular terminology-aware translator.
  const headings = new Map();
  for (const [zh, labels] of [
    ['正文', ['main','main text','main body','main article text']], ['摘要', ['abstract', 'summary', 'article summary']], ['图文摘要', ['graphical abstract']],
    ['要点', ['highlights', 'key points']], ['关键词', ['keywords', 'key words']],
    ['引言', ['introduction']], ['背景', ['background']], ['研究目的', ['objective', 'objectives', 'aims']],
    ['方法', ['methods', 'methodology']], ['实验方法', ['experimental procedures', 'experimental methods']],
    ['材料与方法', ['materials and methods', 'methods and materials']],
    ['STAR 方法', ['star methods']], ['方法详述', ['method details']], ['研究设计', ['study design']],
    ['结果', ['results', 'findings']], ['讨论', ['discussion']], ['结果与讨论', ['results and discussion']],
    ['结论', ['conclusion', 'conclusions']], ['研究局限性', ['limitations', 'limitations of the study', 'study limitations']],
    ['统计分析', ['statistical analysis', 'statistical analyses']], ['定量与统计分析', ['quantification and statistical analysis']],
    ['资源可用性', ['resource availability']], ['数据可用性', ['data availability', 'data availability statement']],
    ['数据与材料可用性', ['availability of data and materials', 'data and materials availability']],
    ['代码可用性', ['code availability', 'code availability statement']], ['数据与代码可用性', ['data and code availability', 'availability of data and code']],
    ['补充信息', ['supplementary information', 'supplemental information', 'supporting information']], ['补充材料', ['supplementary material', 'supplementary materials', 'supplemental material', 'supplemental materials']],
    ['扩展数据', ['extended data']], ['图注', ['figure legends', 'figure captions']], ['参考文献', ['references', 'bibliography']],
    ['致谢', ['acknowledgments', 'acknowledgements', 'acknowledgment', 'acknowledgement']],
    ['作者贡献', ['author contributions', 'authors’ contributions', 'author contribution statement']],
    ['作者信息', ['author information']], ['资助', ['funding', 'funding information', 'funding statement']],
    ['利益冲突声明', ['competing interests', 'conflict of interest', 'conflicts of interest', 'declaration of interests', 'declaration of competing interest']],
    ['伦理声明', ['ethics declarations', 'ethics statement']], ['伦理批准', ['ethics approval']],
    ['关键资源表', ['key resources table']], ['实验模型与研究对象详情', ['experimental model and subject details']],
    ['缩略词', ['abbreviations']], ['附录', ['appendix']], ['同行评审', ['peer review']], ['更多信息', ['additional information']]
  ]) for (const label of labels) headings.set(label, zh);
  function academicHeading(source) {
    const text = String(source || '').normalize('NFKC').trim();
    const match = /^(?:(\d+(?:\.\d+)*|[IVXLCDM]+)([.)]?)\s+)?(.+?)[:.。]?$/iu.exec(text);
    if (!match) return '';
    const key = match[3].toLowerCase().replace(/\s*[★⋆]\s*/gu, ' ').replace(/\s*&\s*/gu, ' and ')
      .replace(/['’]/gu,'’').replace(/\s+/gu,' ').trim();
    const zh = headings.get(key);
    return zh ? (match[1] ? match[1] + match[2] + ' ' : '') + zh : '';
  }

  function protectHeadingTerms(source, index) {
    const spans = index.find(source);
    if (!spans.length) return null;
    let prefix = 'BRVTERM';
    while (source.toUpperCase().includes(prefix)) prefix += 'X';
    let text = '', end = 0;
    const terms = spans.map((span, i) => {
      const key = prefix + i + 'Q';
      text += source.slice(end, span.sourceStart) + key;
      end = span.sourceEnd;
      return {key, source:span.text, translation:span.target};
    });
    return {text:text + source.slice(end), terms, restore(output) {
      if (typeof output !== 'string') throw Error('译文缺少大纲标题');
      const seen = new Set();
      const restored = output.replace(new RegExp(prefix + '(\\d+)Q','gi'), (marker, n) => {
        const term = terms[Number(n)];
        if (!term || seen.has(term.key) || marker.toUpperCase() !== term.key) throw Error('大纲译文中的术语标记无效');
        seen.add(term.key);
        return term.translation;
      });
      if (seen.size !== terms.length) throw Error('大纲译文遗漏了本地术语');
      return restored;
    }};
  }

  async function signature(index, source = 'en', target = 'zh', impl = globalThis.crypto) {
    const base = `browser-translator:${source}:${target}:validated-prefix-v2`;
    if (!index.identity) return base;
    if (!index.signatures.has(base)) {
      const hash = impl.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(base + '\nterms-v1\n' + index.identity)
      );
      index.signatures.set(
        base,
        hash.then(
          (bytes) =>
            'sha256:' + Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
        )
      );
    }
    return index.signatures.get(base);
  }
  function read(reverse = false, storage = globalThis.chrome?.storage?.local, refresh = false) {
    const runtime = globalThis.chrome?.runtime;
    const page = runtime?.sendMessage && /^(https?|file):$/.test(globalThis.location?.protocol || '');
    const owner = page ? runtime : storage;
    if (!owner || (!page && !storage?.get)) return empty;
    let cache = storageCaches.get(owner);
    if (!cache) {
      cache = new Map();
      storageCaches.set(owner, cache);
      const invalidate = (changes, area) => {
        if (area === 'local' && Object.hasOwn(changes, key)) cache.clear();
      };
      if (page) globalThis.SciLLM?.onPublicPreferencesChanged?.(invalidate);
      else globalThis.chrome?.storage?.onChanged?.addListener(invalidate);
    }
    if (refresh) cache.delete(reverse);
    if (!cache.has(reverse)) {
      const value = page
        ? runtime.sendMessage({ type: 'ABBREVIATION_MEMORY_GET' }).then((response) => {
            if (!response?.success) throw Error('Terminology library unavailable');
            return response.data.memory;
          })
        : Promise.resolve(storage.get(key)).then((data) => data?.[key]);
      const pending = value
        .then((data) => compile(data, reverse))
        .catch(() => {
          if (cache.get(reverse) === pending) cache.delete(reverse);
          return empty;
        });
      cache.set(reverse, pending);
    }
    return cache.get(reverse);
  }
  async function apply(source, spans, translate) {
    if (!spans.length) return translate(source);
    if (spans.length === 1 && source.trim() === spans[0].text) return spans[0].target;
    let prefix = 'BRVTERM';
    while (source.toUpperCase().includes(prefix)) prefix += 'X';
    const gaps = [],
      markers = [];
    let cursor = 0,
      masked = '';
    for (const [i, span] of spans.entries()) {
      const gap = source.slice(cursor, span.sourceStart),
        marker = prefix + i + 'Q';
      gaps.push(gap);
      markers.push(marker);
      masked += gap + marker;
      cursor = span.sourceEnd;
    }
    gaps.push(source.slice(cursor));
    masked += gaps.at(-1);
    const result = await translate(masked);
    const pattern = new RegExp(prefix + '(\\d+)Q', 'gi'),
      seen = new Set();
    let invalid = false;
    const parts = [];
    let end = 0;
    for (const match of result.matchAll(pattern)) {
      const n = Number(match[1]);
      if (!spans[n] || seen.has(n) || match[0].toUpperCase() !== markers[n]) {
        invalid = true;
        break;
      }
      seen.add(n);
      parts.push(result.slice(end, match.index), spans[n].target);
      end = match.index + match[0].length;
    }
    parts.push(result.slice(end));
    if (!invalid && seen.size === spans.length && !parts.some((part) => part.toUpperCase().includes(prefix)))
      return joinTerms(parts);
    // Some native language packs translate identifiers. Never display markers or invent a term.
    parts.length = 0;
    for (const [i, gap] of gaps.entries()) {
      if (/\p{L}/u.test(gap))
        parts.push(gap.match(/^\s*/u)[0] + (await translate(gap.trim())) + gap.match(/\s*$/u)[0]);
      else parts.push(gap);
      if (i < spans.length) parts.push(spans[i].target);
    }
    return joinTerms(parts);
  }
  // Native engines can insert ASCII spaces around a placeholder in Chinese prose.
  function joinTerms(parts) {
    for (let i = 1; i < parts.length; i++) {
      if (
        /[\p{Script=Han}，。；：、（）][ \t]*$/u.test(parts[i - 1]) &&
        /^[ \t]*[\p{Script=Han}，。；：、（）]/u.test(parts[i])
      ) {
        parts[i - 1] = parts[i - 1].replace(/[ \t]+$/u, '');
        parts[i] = parts[i].replace(/^[ \t]+/u, '');
      }
    }
    return parts.join('');
  }
  const api = { compile, read, signature, apply, academicHeading, protectHeadingTerms };
  if (typeof module === 'object' && module.exports) module.exports = api;
  globalThis.BrevessTranslationGlossary = api;
})();
