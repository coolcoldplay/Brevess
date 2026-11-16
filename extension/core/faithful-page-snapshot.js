(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessFaithfulSnapshot = api;
  Object.assign(root.SciLLM || (root.SciLLM = {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const fallbackI18n = typeof module === 'object' && module.exports ? require('./i18n-export.js') : {};

  const CSP = "default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const LIMITS = Object.freeze({ maxHtmlBytes: 64 * 1024 * 1024, maxResourceBytes: 40 * 1024 * 1024,
    maxCssChars: 2 * 1024 * 1024, maxEmbeddedBytes: 48 * 1024 * 1024, maxResources: 512, maxImportDepth: 6, maxNodes: 60000 });
  const DROP_TAGS = new Set(('script noscript base meta link style form input button select textarea option datalist iframe frame frameset object embed portal video audio track source canvas template dialog foreignobject animate animatemotion animatetransform set discard annotation-xml xmp plaintext noembed noframes').split(' '));
  const UI_IDS = /^(?:sci-(?:reading-panel|article-navigator-panel|figure-image-viewer|llm-feedback|manual-toolbar|highlight-context-popover|manual-status|side-panel-restore|highlight-tooltip)|esSidebar|esSideButton|epmt|immersive-translate-browser-popup|codex-agent-overlay-root)$/i;
  const PRIVATE_NODE = /login|account|paywall|subscription|logout|sign-in|user-menu/i;
  const HTML_ATTRS = new Set(('abbr alt class colspan datetime dir headers height hidden id lang open rel reversed role rowspan scope span start title width align valign border cellpadding cellspacing face color size name encoding display mathvariant mathsize mathcolor mathbackground stretch largeop movablelimits accent accentunder fence separator stretchy symmetric minsize maxsize lspace rspace linethickness columnalign rowalign columnspacing rowspacing columnlines rowlines frame framespacing equalrows equalcolumns notation subscriptshift superscriptshift scriptlevel displaystyle data-theme data-color-mode data-layout data-component data-section data-figure data-db-target-of').split(' '));
  const SVG_ATTRS = new Set(('viewbox preserveaspectratio d x y x1 x2 y1 y2 dx dy cx cy r rx ry points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity clip-path clip-rule mask filter marker-start marker-mid marker-end gradientunits gradienttransform spreadmethod offset stop-color stop-opacity patternunits patterncontentunits patterntransform text-anchor dominant-baseline font-family font-size font-style font-weight lengthadjust textlength xmlns xmlns:xlink').split(' '));
  const CSS_IMAGE_FUNCTIONS = new Set(['image-set', '-webkit-image-set', 'image']);
  const bytes = value => typeof TextEncoder === 'function' ? new TextEncoder().encode(String(value)).length : unescape(encodeURIComponent(String(value))).length;
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const tagOf = node => String(node?.localName || node?.tagName || '').toLowerCase();
  const attr = (node, name) => String(node?.getAttribute?.(name) || '');
  const warn = (report, value) => { if (!report.warnings.includes(value)) report.warnings.push(value); };
  function abort(signal) { if (signal?.aborted) throw fail('EXPORT_SNAPSHOT_CANCELLED', 'Snapshot export was cancelled.'); }
  function remoteUrl(raw, base) {
    if (!String(raw || '').trim()) return '';
    try { const url = new URL(String(raw || '').trim(), base); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch (_) { return ''; }
  }
  function publicUrl(raw) {
    try { const url = new URL(raw); return /^https?:$/.test(url.protocol) ? `${url.origin}${url.pathname}` : ''; } catch (_) { return ''; }
  }
  function safeDataUrl(value, kind) {
    const type = kind === 'font' ? '(?:font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-woff|vnd.ms-fontobject|x-font-ttf|x-font-opentype))' : 'image\/(?:avif|gif|jpe?g|png|webp|bmp|tiff?)';
    return new RegExp(`^data:${type};base64,[a-z0-9+/]+={0,2}$`, 'i').test(String(value || ''));
  }
  function isHighlight(node) { return /(?:^|\s)sci-(?:manual-|llm-)?highlight(?:\s|$)/.test(attr(node, 'class')); }
  function normalizedFontMime(mime) {
    return /^(?:application\/font-woff2|application\/x-font-woff2)$/.test(mime) ? 'font/woff2' : mime;
  }
  function normalizedFontDataUrl(value, requireWoff2Magic = false) {
    const raw = String(value || '');
    const mime = raw.slice(5).split(';')[0].toLowerCase();
    const alias = normalizedFontMime(mime) !== mime;
    if (!alias && !requireWoff2Magic) return raw;
    const match = raw.match(/^data:([^;]+);base64,([a-z0-9+/]+={0,2})$/i);
    if (!match) return '';
    try { if (atob(match[2].slice(0, 8)).slice(0, 4) !== 'wOF2') return ''; }
    catch (_) { return ''; }
    return alias ? `data:font/woff2;base64,${match[2]}` : raw;
  }
  function excluded(node) {
    return DROP_TAGS.has(tagOf(node)) || node.hasAttribute?.('data-sci-plugin-ui') || node.hasAttribute?.('data-sci-translation') ||
      UI_IDS.test(attr(node, 'id')) || PRIVATE_NODE.test(`${attr(node, 'id')} ${attr(node, 'class')}`) ||
      attr(node, 'role') === 'navigation' || ['nav'].includes(tagOf(node));
  }
  function decodeCss(value) {
    return String(value).replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\r\n\f])/gi, (_, hex, letter) => {
      if (!hex) return letter;
      const cp = parseInt(hex, 16); return cp && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '\ufffd';
    }).replace(/\\(?:\r\n|[\r\n\f])/g, '');
  }
  function readString(text, at) {
    const quote = text[at]; let end = at + 1; let closed = false; let valid = true;
    while (end < text.length) {
      if (text[end] === '\\') { end += text[end + 1] === '\r' && text[end + 2] === '\n' ? 3 : 2; continue; }
      if (text[end] === '\r' || text[end] === '\n' || text[end] === '\f') valid = false;
      if (text[end++] === quote) { closed = true; break; }
    }
    return { end, closed, valid, value: decodeCss(text.slice(at + 1, Math.max(at + 1, end - 1))) };
  }
  function readIdent(text, at) {
    const match = text.slice(at).match(/^(?:[-_a-zA-Z0-9]|[^\x00-\x7f]|\\(?:[0-9a-fA-F]{1,6}\s?|[^\r\n\f]))+/);
    return match ? { end: at + match[0].length, value: decodeCss(match[0]).toLowerCase() } : { end: at + 1, value: text[at] };
  }
  function closeFunction(text, at) {
    let depth = 1; let end = at + 1;
    while (end < text.length && depth) {
      if (text[end] === '"' || text[end] === "'") { end = readString(text, end).end; continue; }
      if (text[end] === '\\') { end += 2; continue; }
      if (text[end] === '(') depth++; else if (text[end] === ')') depth--;
      end++;
    }
    return end;
  }
  function closeBlock(text, at) {
    let depth = 1; let end = at + 1;
    while (end < text.length && depth) {
      if (text[end] === '"' || text[end] === "'") { end = readString(text, end).end; continue; }
      if (text[end] === '\\') { end += 2; continue; }
      if (text[end] === '{') depth++; else if (text[end] === '}') depth--;
      end++;
    }
    return end;
  }
  function removeCssComments(text) {
    let result = ''; let at = 0;
    while (at < text.length) {
      if (text[at] === '"' || text[at] === "'") { const end = readString(text, at).end; result += text.slice(at, end); at = end; continue; }
      if (text.slice(at, at + 2) === '/*') { const end = text.indexOf('*/', at + 2); at = end < 0 ? text.length : end + 2; continue; }
      result += text[at++];
    }
    return result;
  }
  function ruleEnd(text, at) {
    let end = at;
    while (end < text.length) {
      if (text[end] === '"' || text[end] === "'") { end = readString(text, end).end; continue; }
      if (text[end] === '(') { end = closeFunction(text, end); continue; }
      if (text[end++] === ';') break;
    }
    return end;
  }
  function sourceCss(node) {
    try { if (node.sheet?.cssRules) return Array.from(node.sheet.cssRules, rule => rule.cssText).join('\n'); } catch (_) { /* Cross-origin styles are fetched through the supplied safe resource callback. */ }
    return tagOf(node) === 'style' ? String(node.textContent || '') : null;
  }
  function snapshotReport() {
    return { embeddedImages: 0, embeddedStylesheets: 0, embeddedFonts: 0, missingResources: [], warnings: [], preservedAnnotations: 0, readableNotes: 0, preservedTranslations: 0, unmatchedTranslations: 0, fidelity: 'source-dom-with-offline-resources' };
  }

  function confirmedExportTranslations(snapshot, documentUrl) {
    if (!snapshot) return [];
    const bindingUrl = snapshot.documentBinding?.pageUrl || snapshot.documentBinding?.navigationIdentity || snapshot.documentBinding?.url;
    const identity = value => { try { const url = new URL(value); url.hash = ''; return url.href; } catch (_) { return ''; } };
    if (snapshot.version !== 1 || !Array.isArray(snapshot.translations) ||
        !identity(bindingUrl) || identity(bindingUrl) !== identity(documentUrl)) {
      throw fail('EXPORT_TRANSLATION_IDENTITY_INVALID', 'Translation snapshot does not belong to this article.');
    }
    const keys = new Set();
    return snapshot.translations.map(entry => {
      if (!entry || typeof entry.sourceKey !== 'string' || !entry.sourceKey || keys.has(entry.sourceKey) ||
          typeof entry.sourceText !== 'string' || !entry.sourceText || entry.sourceText.length > 200000 ||
          typeof entry.translatedText !== 'string' || !entry.translatedText.trim() || entry.translatedText.length > 200000 ||
          entry.confirmed === false || entry.sourceStart !== 0 || !Number.isInteger(entry.sourceEnd) ||
          entry.sourceEnd <= 0 || entry.sourceEnd > entry.sourceText.length ||
          typeof entry.engineSignature !== 'string' || !entry.engineSignature ||
          entry.sourceLanguage !== 'en' || entry.targetLanguage !== 'zh') {
        throw fail('EXPORT_TRANSLATION_ENTRY_INVALID', 'Translation snapshot contains an invalid or duplicate record.');
      }
      keys.add(entry.sourceKey);
      return { ...entry, partial: entry.sourceEnd < entry.sourceText.length };
    });
  }

  function translationSourceText(node, options) {
    if (typeof options.readTranslationSourceText === 'function') return options.readTranslationSourceText(node);
    if (globalThis.BrevessTranslationSource?.readSourceText) return globalThis.BrevessTranslationSource.readSourceText(node, { allowHiddenRoot: node?.matches?.('.full-view-snippet') === true });
    const parts = [];
    const walk = live => {
      if (live.nodeType === 3) { parts.push(live.nodeValue || ''); return; }
      if (live.nodeType !== 1 || excluded(live) || ['style', 'math'].includes(tagOf(live)) || live.matches?.('.MathJax,.katex,[role="math"],.immersive-translate-target-wrapper,[data-immersive-translate-translation-element-mark="1"]')) return;
      if (tagOf(live) === 'br') { parts.push(' '); return; }
      for (const child of live.childNodes || []) walk(child);
    };
    walk(node); return parts.join('').replace(/\s+/gu, ' ').trim();
  }

  // Capture only a caller-selected trusted article subtree, never a whole account page.
  function captureFaithfulPageSnapshot(options = {}) {
    const api = globalThis.SciLLM || {};
    const locale = options.outputLanguage || options.interfaceLanguage || options.language || api.getInterfaceLanguage?.() || 'zh-CN';
    const text = value => (api.translateExportBuiltin || fallbackI18n.translateExportBuiltin)?.(value, locale) ?? value;
    const message = (parts, ...values) => (api.formatExportBuiltin || fallbackI18n.formatExportBuiltin)?.(parts, values, locale)
      ?? parts.reduce((result, part, index) => result + part + (values[index] ?? ''), '');
    const source = options.document;
    const article = options.articleRoot;
    if (!source?.implementation?.createHTMLDocument || !article || ['html', 'body'].includes(tagOf(article)) ||
        article.ownerDocument !== source || !source.body?.contains(article) || excluded(article)) {
      throw fail('EXPORT_SNAPSHOT_INVALID_ROOT', 'A trusted article root inside the source document is required.');
    }
    abort(options.signal);
    const output = source.implementation.createHTMLDocument(String(options.title || source.title || 'Article'));
    while (output.head.firstChild) output.head.removeChild(output.head.firstChild);
    while (output.body.firstChild) output.body.removeChild(output.body.firstChild);
    const capture = { outputDocument: output, documentUrl: remoteUrl(options.documentUrl || source.URL || source.baseURI),
      baseUrl: source.baseURI || source.URL, stylesheets: [], inlineStyles: [], images: [], layoutSlots: new Set(), report: snapshotReport(), options,
      maxHtmlBytes: Math.min(LIMITS.maxHtmlBytes, Number(options.maxHtmlBytes) > 0 ? Number(options.maxHtmlBytes) : LIMITS.maxHtmlBytes) };
    const annotationList = Array.isArray(options.annotations) ? options.annotations : [];
    const annotations = new Map(annotationList.map(item => [String(item.id || item.annotationId || ''), item]));
    const annotatedIds = new Set();
    const translations = confirmedExportTranslations(options.exportSnapshot, capture.documentUrl);
    if (options.exportSnapshot && options.expectedDocumentBinding?.documentHash &&
        options.exportSnapshot.documentBinding?.documentHash !== options.expectedDocumentBinding.documentHash) {
      throw fail('EXPORT_TRANSLATION_IDENTITY_INVALID', 'Translation snapshot document hash changed.');
    }
    const translationByKey = new Map(translations.map(entry => [entry.sourceKey, entry]));
    const translatedClones = new Map(); const noteAnchors = new Map();
    const copiedIds = new Set(); const svgReferences = new Set();
    const generatedIds = new Set();
    // Cell's full scientific captions depend on a button that the static export
    // deliberately removes. Recognize that exact disclosure relationship before
    // cloning; ordinary hidden article content and native details stay untouched.
    const readableCaptionDisclosures = new Map();
    const hiddenCaptionSiblings = new Set();
    for (const shell of Array.from(article.querySelectorAll?.('figure.graphic > figcaption.figure__caption__body > .accordion > .accordion__content') || [])) {
      const accordion = shell.parentElement, captionBody = accordion?.parentElement, figure = captionBody?.parentElement;
      const figureId = attr(figure, 'id');
      if (!figureId || attr(shell, 'id') !== `${figureId}-content`) continue;
      const captions = Array.from(shell.children || []).filter(node => node.matches?.('.figure__caption__text__content'));
      const caption = captions.length === 1 ? captions[0] : null;
      // Free text cannot be hidden independently without changing element-based
      // publisher selectors. Keep such an unfamiliar disclosure closed.
      if (Array.from(shell.childNodes || []).some(node => node.nodeType === 3 && String(node.nodeValue || '').trim())) continue;
      const controls = Array.from(accordion.querySelectorAll?.('button.accordion__control[aria-expanded]') || [])
        .filter(node => node.closest?.('.accordion') === accordion);
      const control = controls.length === 1 ? controls[0] : null;
      if (!caption?.textContent?.trim() || excluded(caption) || !control || attr(control, 'aria-expanded') !== 'false') continue;
      if (control.hasAttribute('aria-controls') && attr(control, 'aria-controls').trim() !== attr(shell, 'id')) continue;
      let shellStyle;
      try { shellStyle = source.defaultView?.getComputedStyle(shell); } catch (_) {}
      if (!shell.hasAttribute('hidden') && shellStyle?.getPropertyValue?.('display') !== 'none' &&
          !['hidden', 'collapse'].includes(shellStyle?.getPropertyValue?.('visibility'))) continue;
      let permitted = true;
      for (let node = shell; node && node !== article; node = node.parentElement) {
        if (excluded(node)) { permitted = false; break; }
      }
      if (permitted) {
        readableCaptionDisclosures.set(shell, caption);
        for (const child of Array.from(shell.children || [])) if (child !== caption) hiddenCaptionSiblings.add(child);
      }
    }
    const freshId = base => {
      let id = base; let index = 1;
      while (generatedIds.has(id) || source.getElementById?.(id)) id = `${base}-${index++}`;
      generatedIds.add(id); return id;
    };
    let nodeCount = 0;
    const cleanAttributes = (live, clone) => {
      const tag = tagOf(live); let inline = attr(live, 'style'); let lostState = false; const frozenStyle = [];
      const displayedOriginal = options.displayImageByElement?.get?.(live);
      if (displayedOriginal) {
        // Live originals use a temporary CSS blob without changing canonical
        // image identity. The offline clone gets persisted bytes as its src.
        const detached = source.createElement('span');
        detached.style.cssText = inline;
        const originalStyles = displayedOriginal.originalStyles || [{ property: 'content',
          value: displayedOriginal.originalContentValue, priority: displayedOriginal.originalContentPriority }];
        for (const original of originalStyles) {
          if (original.value) detached.style.setProperty(original.property, original.value, original.priority || '');
          else detached.style.removeProperty(original.property);
        }
        inline = detached.style.cssText;
      }
      for (const attribute of Array.from(live.attributes || [])) {
        const name = attribute.name.toLowerCase(); const value = attribute.value;
        if (/^on/.test(name) || /^(?:src|srcset|sizes|loading|decoding|style|is|nonce|integrity|ping|srcdoc|action|formaction|target)$/.test(name)) continue;
        // Exported highlights are inert source content, without the live editor's
        // button role or accessible editing instructions. Native note links below
        // provide the static action and its accessible name.
        if (isHighlight(live) && /^(?:role|aria-label|aria-labelledby|aria-describedby)$/.test(name)) continue;
        // Nature reference numbering is publisher CSS attr(data-counter), not
        // private state. Keep only bounded numeric labels in its article list.
        const referenceCounter = name === 'data-counter' && tag === 'li' && article.contains(live) &&
          /^[1-9][0-9]{0,3}\.$/.test(value) && value.endsWith('.') &&
          /(?:^|\s)c-article-references__item(?:\s|$)/.test(attr(live, 'class')) &&
          tagOf(live.parentElement) === 'ol' && /(?:^|\s)c-article-references(?:\s|$)/.test(attr(live.parentElement, 'class'));
        if (referenceCounter || HTML_ATTRS.has(name) || /^aria-(?:label|labelledby|describedby|hidden|level|current)$/.test(name) || SVG_ATTRS.has(name)) {
          // SVG presentation URL functions must use internal references only.
          if (SVG_ATTRS.has(name) && /url\s*\(/i.test(decodeCss(value)) && !/^url\(\s*['"]?#[a-z0-9_.:-]+['"]?\s*\)$/i.test(decodeCss(value))) continue;
          clone.setAttribute(attribute.name, value);
          if (name === 'id') copiedIds.add(value);
          if (SVG_ATTRS.has(name)) { const reference = decodeCss(value).match(/^url\(\s*['"]?#([a-z0-9_.:-]+)['"]?\s*\)$/i); if (reference) svgReferences.add(reference[1]); }
        } else if ((name === 'href' || name === 'xlink:href') && ['a', 'area', 'use', 'mpath', 'textpath'].includes(tag)) {
          if (/^#[^\s]*$/.test(value)) { clone.setAttribute(attribute.name, value); if (tag !== 'a' && tag !== 'area') svgReferences.add(value.slice(1)); }
          else if (['a', 'area'].includes(tag)) { const url = remoteUrl(value, capture.baseUrl); if (url) { clone.setAttribute(attribute.name, url); clone.setAttribute('rel', 'noopener noreferrer'); } }
          else if (value) warn(capture.report, 'An external SVG definition could not be embedded; its referenced graphic may be incomplete.');
        } else if (name === 'cite' && ['q', 'blockquote'].includes(tag)) {
          const url = remoteUrl(value, capture.baseUrl); if (url) clone.setAttribute(name, url);
        } else if (/^(?:data-|aria-)/.test(name)) lostState = true;
      }
      // Do not copy arbitrary data attributes (which may contain credentials).
      // Freeze only actual source hiding when a removed state selector could
      // otherwise expose a publisher popover. aria-hidden alone is not CSS hiding.
      let computed;
      if (lostState || isHighlight(live)) {
        try { computed = source.defaultView?.getComputedStyle(live); } catch (_) {}
      }
      if (lostState) {
        if (computed?.getPropertyValue?.('display') === 'none') frozenStyle.push('display:none!important');
        const visibility = computed?.getPropertyValue?.('visibility');
        if (['hidden', 'collapse'].includes(visibility)) frozenStyle.push(`visibility:${visibility}!important`);
      }
      if (readableCaptionDisclosures.has(live)) {
        clone.removeAttribute('hidden'); clone.removeAttribute('aria-hidden');
        frozenStyle.push('display:block!important', 'visibility:visible!important', 'height:auto!important',
          'max-height:none!important', 'overflow:visible!important', 'content-visibility:visible!important');
        capture.report.expandedFigureCaptions = (capture.report.expandedFigureCaptions || 0) + 1;
      }
      // Preserve original element positions and sibling selectors. These nodes
      // inherited the closed shell's hiding and are outside its scientific text.
      if (hiddenCaptionSiblings.has(live)) frozenStyle.push('display:none!important');
      if (isHighlight(live)) {
        const candidate = annotations.get(attr(live, 'data-annotation-id'));
        const normalized = value => String(value || '').replace(/\s+/gu, ' ').trim();
        const annotation = candidate && (!candidate.quote || normalized(candidate.quote) === normalized(live.textContent)) ? candidate : null;
        const parts = [attr(live, 'title'), annotation?.categorySnapshot?.name, annotation?.note ? message`备注：${annotation.note}` : ''].filter(Boolean);
        if (parts.length) clone.setAttribute('title', Array.from(new Set(parts)).join('\n'));
        if (annotation) {
          const id = String(annotation.id || annotation.annotationId);
          annotatedIds.add(id);
          if (!noteAnchors.has(id)) {
            const anchor = attr(clone, 'id') || freshId(`brevess-annotation-${noteAnchors.size + 1}`);
            clone.setAttribute('id', anchor); noteAnchors.set(id, { anchor, node: clone });
          }
        }
        try {
          const names = ['background-color', 'color', 'text-decoration', 'border-bottom', 'border-radius'];
          const values = names.map(name => [name, computed?.getPropertyValue?.(name)]).filter(([, value]) => value);
          inline += values.map(([name, value]) => `;${name}:${value}`).join('');
        } catch (_) {}
      }
      if (inline || frozenStyle.length) capture.inlineStyles.push({ node: clone, text: inline, frozenStyle: frozenStyle.join(';'), baseUrl: capture.baseUrl });
      if (tag === 'img' || tag === 'image' || tag === 'feimage') {
        const resource = options.embeddedImageByElement?.get?.(live);
        const raw = live.currentSrc || attr(live, 'src') || attr(live, 'href') || attr(live, 'xlink:href');
        const preserveLayout = tag === 'img' && Number(live.naturalWidth) > 0 && Number(live.naturalHeight) > 0;
        let originalPaint = null;
        if (preserveLayout) {
          const style = source.defaultView?.getComputedStyle?.(live);
          const fit = style?.objectFit || 'fill';
          const rect = live.getBoundingClientRect?.() || {};
          originalPaint = {
            size: displayedOriginal?.appliedStyles?.['background-size'] ||
              (fit === 'contain' || fit === 'cover' ? fit : fit === 'none' ||
                fit === 'scale-down' && live.naturalWidth <= rect.width && live.naturalHeight <= rect.height
                ? `${live.naturalWidth}px ${live.naturalHeight}px` : fit === 'scale-down' ? 'contain' : '100% 100%'),
            position: displayedOriginal?.appliedStyles?.['background-position'] || style?.objectPosition || '50% 50%'
          };
        }
        capture.images.push({ node: clone, sourceElement: live,
          url: preserveLayout ? raw : resource?.dataUrl || raw,
          originalUrl: preserveLayout ? resource?.dataUrl : '', preserveLayout, originalPaint,
          naturalWidth: Number(live.naturalWidth) || 0, naturalHeight: Number(live.naturalHeight) || 0,
          baseUrl: capture.baseUrl, kind: 'image', anchorId: resource?.anchorId });
      }
    };
    const cloneTree = live => {
      if (++nodeCount > LIMITS.maxNodes) throw fail('EXPORT_SNAPSHOT_TOO_MANY_NODES', 'Article DOM exceeds the snapshot limit.');
      if (live.nodeType === 3) return output.createTextNode(live.nodeValue || '');
      if (live.nodeType !== 1) return null;
      if (excluded(live)) { if (['canvas', 'iframe', 'object', 'embed'].includes(tagOf(live))) warn(capture.report, 'Some active or canvas content could not be exported as inert source DOM.'); return null; }
      const node = live.namespaceURI && live.namespaceURI !== 'http://www.w3.org/1999/xhtml'
        ? output.createElementNS(live.namespaceURI, live.localName || tagOf(live)) : output.createElement(tagOf(live));
      cleanAttributes(live, node);
      if (live.shadowRoot) warn(capture.report, 'Shadow DOM content is not included in this snapshot.');
      for (const child of Array.from(live.childNodes || [])) { const copy = cloneTree(child); if (copy) node.appendChild(copy); }
      const sourceKey = options.translationSourceByElement?.get?.(live);
      const translation = translationByKey.get(sourceKey);
      if (translation && translationSourceText(live, options) === translation.sourceText) {
        if (translatedClones.has(sourceKey)) throw fail('EXPORT_TRANSLATION_ANCHOR_AMBIGUOUS', 'A translation source has multiple DOM anchors.');
        translatedClones.set(sourceKey, node);
      }
      return node;
    };
    cleanAttributes(source.documentElement, output.documentElement);
    cleanAttributes(source.body, output.body);
    const ancestors = [];
    for (let node = article.parentElement; node && node !== source.body; node = node.parentElement) ancestors.unshift(node);
    // Keep element positions along the reading path. Empty inert sibling slots
    // preserve grid placement and nth-child selectors without copying account,
    // navigation text, links, images or executable content outside the article.
    const path = [...ancestors, article];
    let liveParent = source.body, parent = output.body;
    for (const live of path) {
      if (excluded(live)) throw fail('EXPORT_SNAPSHOT_PRIVATE_ROOT', 'Article root is inside an excluded page region.');
      let nextParent;
      for (const sibling of Array.from(liveParent.childNodes || [])) {
        if (sibling === live) {
          const clone = live === article ? cloneTree(live) : output.createElement(tagOf(live));
          if (live !== article) cleanAttributes(live, clone);
          parent.appendChild(clone); nextParent = clone;
        } else if (sibling.nodeType === 1) {
          if (++nodeCount > LIMITS.maxNodes) throw fail('EXPORT_SNAPSHOT_TOO_MANY_NODES', 'Article DOM exceeds the snapshot limit.');
          const tag = tagOf(sibling);
          const safeTag = /^(?:div|span|aside|header|footer|nav|main|section|article|ul|ol|li|figure|p|h[1-6])$/.test(tag);
          const slot = output.createElement(safeTag ? tag : 'span');
          const privateRegion = PRIVATE_NODE.test(`${attr(sibling, 'id')} ${attr(sibling, 'class')}`) ||
            sibling.hasAttribute?.('data-sci-plugin-ui') || UI_IDS.test(attr(sibling, 'id'));
          if (!privateRegion) for (const name of ['id', 'class', 'hidden']) {
            if (sibling.hasAttribute?.(name)) slot.setAttribute(name, attr(sibling, name));
          }
          slot.setAttribute('aria-hidden', 'true');
          slot.setAttribute('data-brevess-layout-slot', '');
          const display = source.defaultView?.getComputedStyle?.(sibling)?.display;
          slot.setAttribute('style', `visibility:hidden!important;pointer-events:none!important${display === 'none' || ['script', 'style', 'link', 'meta', 'template'].includes(tag) ? ';display:none!important' : ''}`);
          capture.layoutSlots.add(slot); parent.appendChild(slot);
        }
      }
      if (!nextParent) throw fail('EXPORT_SNAPSHOT_INVALID_ROOT', 'The article reading path changed during capture.');
      parent = nextParent; liveParent = live;
    }
    // MathJax and publisher SVGs can share inert glyph definitions outside the
    // article subtree. Copy only specifically referenced SVG elements, not body
    // siblings, and keep them in a non-rendering defs container.
    let definitions = null; let referencesChecked = 0;
    for (const id of svgReferences) {
      if (copiedIds.has(id)) continue;
      if (++referencesChecked > 128) { warn(capture.report, 'The SVG definition reference limit was reached.'); break; }
      const target = source.getElementById?.(id);
      let privateTarget = false;
      for (let ancestor = target; ancestor && ancestor !== source.body; ancestor = ancestor.parentElement) {
        if (excluded(ancestor)) privateTarget = true;
      }
      if (!target || target.namespaceURI !== 'http://www.w3.org/2000/svg' || privateTarget) { warn(capture.report, 'An SVG definition was missing or outside the permitted source scope.'); continue; }
      const copy = cloneTree(target);
      if (!copy) continue;
      if (!definitions) {
        const holder = output.createElementNS('http://www.w3.org/2000/svg', 'svg');
        holder.setAttribute('width', '0'); holder.setAttribute('height', '0'); holder.setAttribute('aria-hidden', 'true');
        holder.setAttribute('style', 'position:absolute!important;width:0!important;height:0!important;overflow:hidden!important');
        definitions = output.createElementNS('http://www.w3.org/2000/svg', 'defs'); holder.appendChild(definitions); output.body.appendChild(holder);
      }
      definitions.appendChild(copy);
    }
    for (const node of Array.from(source.querySelectorAll('style,link[rel~="stylesheet"]'))) {
      let privateStyle = false;
      for (let ancestor = node; ancestor && ancestor !== source.documentElement; ancestor = ancestor.parentElement) {
        if (ancestor.hasAttribute?.('data-sci-plugin-ui') || ancestor.hasAttribute?.('data-sci-translation') || UI_IDS.test(attr(ancestor, 'id')) || PRIVATE_NODE.test(`${attr(ancestor, 'id')} ${attr(ancestor, 'class')}`)) privateStyle = true;
      }
      if (privateStyle || /^sci-|^brevess-/i.test(attr(node, 'id')) || /(?:chrome|moz)-extension:/i.test(attr(node, 'href'))) continue;
      if (node.disabled || node.sheet?.disabled) continue;
      const url = remoteUrl(attr(node, 'href'), capture.baseUrl);
      const text = sourceCss(node);
      if (text !== null || url) capture.stylesheets.push({ text, url, baseUrl: url || capture.baseUrl, media: attr(node, 'media') });
    }
    for (const sheet of Array.from(source.adoptedStyleSheets || [])) {
      try { capture.stylesheets.push({ text: Array.from(sheet.cssRules, rule => rule.cssText).join('\n'), baseUrl: capture.baseUrl, media: '' }); }
      catch (_) { warn(capture.report, 'An adopted stylesheet could not be read.'); }
    }
    capture.report.preservedAnnotations = annotatedIds.size;
    // Generate inert reading content from data, never from removed plugin UI.
    const appendix = output.createElement('section');
    appendix.setAttribute('id', freshId('brevess-reading-notes'));
    appendix.setAttribute('data-brevess-export-snapshot-version', '1');
    if (String(locale).toLowerCase().startsWith('en')) appendix.setAttribute('lang', 'en');
    appendix.setAttribute('style', 'display:block!important;visibility:visible!important;color:#222!important;background:#fff!important;padding:1em!important;overflow-wrap:anywhere!important;max-width:100%!important;box-sizing:border-box!important');
    const textElement = (tag, text) => { const node = output.createElement(tag); node.textContent = String(text || ''); return node; };
    const canLinkHighlight = node => {
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        if (tagOf(ancestor) === 'a' || (ancestor.namespaceURI && ancestor.namespaceURI !== 'http://www.w3.org/1999/xhtml')) return false;
      }
      const containsLink = current => Array.from(current.childNodes || []).some(child => tagOf(child) === 'a' || containsLink(child));
      return !containsLink(node);
    };
    let hasNoteLinks = false;
    appendix.appendChild(textElement('h2', text('高亮备注与译文')));
    if (options.exportSnapshot) {
      capture.report.exportSnapshotVersion = 1;
      capture.report.translationStatus = options.exportSnapshot.status === 'pending' ? 'pending' :
        options.exportSnapshot.status === 'partial' || translations.some(entry => entry.partial) ? 'partial' : translations.length ? 'complete' : 'pending';
      appendix.appendChild(textElement('p', text(capture.report.translationStatus === 'complete' ? '已确认译文已保留。' : '翻译尚未全部完成；仅保留已确认内容，未译部分仍为原文。')));
    }
    for (const [index, entry] of translations.entries()) {
      const target = translatedClones.get(entry.sourceKey);
      const translated = output.createElement('div');
      translated.setAttribute('lang', entry.targetLanguage);
      translated.setAttribute('style', 'display:block!important;visibility:visible!important;color:#333!important;background:#f6f8fa!important;padding:.5em!important;white-space:pre-wrap!important');
      translated.appendChild(textElement('small', text(entry.partial ? '译文（部分完成）' : '译文')));
      translated.appendChild(textElement('p', entry.translatedText));
      if (target?.parentNode) {
        target.parentNode.insertBefore(translated, target.nextSibling);
        capture.report.preservedTranslations++;
      } else {
        appendix.appendChild(textElement('h3', message`译文 ${index + 1}（原文位置未匹配）`));
        appendix.appendChild(textElement('blockquote', entry.sourceText)); appendix.appendChild(translated);
        capture.report.unmatchedTranslations++;
        warn(capture.report, 'Some confirmed translations have no matching source paragraph in the captured article; their source text and translation are preserved in the appendix.');
      }
    }
    for (const [index, annotation] of annotationList.entries()) {
      if (!String(annotation.note || '').trim()) continue;
      const id = String(annotation.id || annotation.annotationId || '');
      const match = noteAnchors.get(id);
      const noteId = freshId(`brevess-note-${index + 1}`);
      const section = output.createElement('section'); section.setAttribute('id', noteId);
      section.appendChild(textElement('h3', message`备注 ${index + 1}${match ? '' : text('（原文位置未匹配）')}`));
      section.appendChild(textElement('blockquote', annotation.quote || match?.node.textContent || text('原句未提供')));
      const body = textElement('p', annotation.note); body.setAttribute('style', 'white-space:pre-wrap!important'); section.appendChild(body);
      const back = textElement('a', text(match ? '返回高亮原句' : '打开论文原网页'));
      if (match || capture.documentUrl) { back.setAttribute('href', match ? `#${match.anchor}` : capture.documentUrl); section.appendChild(back); }
      if (match) {
        const link = output.createElement('a'); link.setAttribute('href', `#${noteId}`);
        link.setAttribute('class', 'brevess-static-note-link');
        link.setAttribute('aria-label', message`查看备注 ${index + 1}`);
        if (canLinkHighlight(match.node)) {
          // Move the cloned children, preserving formatting and exact continuous
          // source text even when a selection ends in the middle of a word.
          link.setAttribute('style', 'font:inherit!important;color:inherit!important;text-decoration:inherit!important');
          while (match.node.firstChild) {
            const child = match.node.firstChild; match.node.removeChild(child); link.appendChild(child);
          }
          match.node.appendChild(link);
        } else {
          // Never nest or replace a publisher anchor. An independent appendix
          // entry keeps the original paragraph and href unchanged.
          link.textContent = message`查看备注 ${index + 1}`;
          const entry = output.createElement('p'); entry.appendChild(link); appendix.appendChild(entry);
        }
        hasNoteLinks = true;
      }
      appendix.appendChild(section); capture.report.readableNotes++;
    }
    if (capture.report.readableNotes || options.exportSnapshot) output.body.appendChild(appendix);
    if (hasNoteLinks) capture.stylesheets.push({ text: 'a.brevess-static-note-link:focus{outline:2px solid currentColor!important;outline-offset:2px!important}', baseUrl: capture.baseUrl, media: '' });
    if (annotationList.some(item => String(item.note || '').trim() && !annotatedIds.has(String(item.id || item.annotationId || '')))) warn(capture.report, 'Some manual notes have no matching highlight in the captured article.');
    capture.report.layoutScope = 'article-with-inert-sibling-slots';
    if (capture.layoutSlots.size) warn(capture.report, 'Non-article regions are empty layout slots; layouts depending on their intrinsic content or interactive state may differ.');
    return capture;
  }

  function missing(report, kind, url, reason) {
    const item = { kind, url: publicUrl(url), reason };
    if (!report.missingResources.some(old => old.kind === item.kind && old.url === item.url && old.reason === item.reason)) report.missingResources.push(item);
  }
  async function withAbort(callback, signal, timeoutMs) {
    abort(signal);
    const controller = new AbortController(); let listener; let timer;
    const interrupted = new Promise((_, reject) => {
      listener = () => { reject(fail('EXPORT_SNAPSHOT_CANCELLED', 'Snapshot export was cancelled.')); controller.abort(); };
      signal?.addEventListener?.('abort', listener, { once: true });
      timer = setTimeout(() => { reject(fail('resource_timeout', 'Snapshot resource fetch timed out.')); controller.abort(); }, timeoutMs);
    });
    try { return await Promise.race([Promise.resolve().then(() => callback(controller.signal)), interrupted]); }
    finally { signal?.removeEventListener?.('abort', listener); clearTimeout(timer); }
  }
  function createResolver(capture, options) {
    const cache = new Map(); let count = 0; let embeddedBytes = 0;
    const configured = Math.floor(Number(options.resourceConcurrency));
    const concurrency = Number.isFinite(configured) && configured > 0 ? Math.min(4, configured) : 3;
    const queue = []; let active = 0; let completed = 0; let started = 0; let admission = Promise.resolve();
    const startedAt = Date.now();
    const progress = () => { try { options.onProgress?.({ phase: 'resources', discovered: count, started, completed, active,
      missing: capture.report.missingResources.length, elapsedMs: Math.max(0, Date.now() - startedAt) }); } catch (_) {} };
    const drain = () => { while (active < concurrency && queue.length) queue.shift()(); };
    // A slot stays occupied through ordered admission, so a slow first resource
    // cannot leave hundreds of decoded responses waiting in memory.
    const schedule = (work, commit) => {
      const previous = admission;
      const task = new Promise((resolve, reject) => queue.push(async () => {
        try { abort(options.signal); }
        catch (error) { completed++; progress(); reject(error); return; }
        active++; started++; progress();
        try { abort(options.signal); const value = await work(); await previous; abort(options.signal); resolve(commit(value)); }
        catch (error) { reject(error); }
        finally { active--; completed++; progress(); drain(); }
      }));
      admission = task.then(() => {}, () => {});
      drain(); return task;
    };
    const admitLocal = commit => {
      const task = admission.then(() => { abort(options.signal); return commit(); });
      admission = task.then(() => {}, () => {}); return task;
    };
    const dataResources = new Set();
    const maxEmbeddedBytes = Math.min(LIMITS.maxEmbeddedBytes, Number(options.maxEmbeddedBytes) > 0 ? Number(options.maxEmbeddedBytes) : LIMITS.maxEmbeddedBytes);
    const retainData = (dataUrl, kind, sourceUrl) => {
      if (!dataResources.has(dataUrl)) {
        if (embeddedBytes + dataUrl.length > maxEmbeddedBytes) { missing(capture.report, kind, sourceUrl, 'embedded_resource_budget'); return null; }
        embeddedBytes += dataUrl.length; dataResources.add(dataUrl);
        capture.report[kind === 'font' ? 'embeddedFonts' : 'embeddedImages']++;
      }
      return { dataUrl };
    };
    progress();
    return async (raw, kind, baseUrl) => {
      abort(options.signal);
      if (kind === 'font') raw = normalizedFontDataUrl(raw);
      if (safeDataUrl(raw, kind) && raw.length * 0.75 <= LIMITS.maxResourceBytes) return admitLocal(() => retainData(raw, kind, ''));
      if (/^\s*#/.test(String(raw || ''))) { missing(capture.report, kind, '', 'unsafe_or_unsupported_url'); return null; }
      const url = remoteUrl(raw, baseUrl);
      if (!url) { missing(capture.report, kind, raw, 'unsafe_or_unsupported_url'); return null; }
      const key = `${kind}:${url}`;
      if (cache.has(key)) return cache.get(key);
      count++; progress();
      if (count > LIMITS.maxResources) {
        const task = admitLocal(() => { missing(capture.report, kind, url, 'resource_limit'); completed++; progress(); return null; });
        cache.set(key, task); return task;
      }
      const task = schedule(async () => {
        try {
          if (typeof options.fetchResource !== 'function') throw fail('fetch_unavailable', 'No safe resource fetch callback is available.');
          const timeoutMs = Math.min(45000, Number(options.resourceTimeoutMs) > 0 ? Number(options.resourceTimeoutMs) : 45000);
          const response = await withAbort(signal => options.fetchResource({ url, kind, documentUrl: capture.documentUrl, signal }), options.signal, timeoutMs);
          abort(options.signal);
          const sourceMime = String(response?.contentType || '').split(';')[0].trim().toLowerCase();
          const mime = kind === 'font' ? normalizedFontMime(sourceMime) : sourceMime;
          if (kind === 'stylesheet') {
            if (mime !== 'text/css' || typeof response?.text !== 'string' || response.text.length > LIMITS.maxCssChars) throw fail('invalid_stylesheet', 'Stylesheet response must be bounded text/css.');
            return { text: response.text, baseUrl: remoteUrl(response.sourceUrl, url) || url };
          }
          // Only the two explicit WOFF2 aliases gain compatibility; require
          // their binary signature before canonicalizing either MIME channel.
          const dataUrl = kind === 'font' ? normalizedFontDataUrl(response?.dataUrl, mime !== sourceMime) : response?.dataUrl;
          const dataMime = String(dataUrl || '').slice(5).split(';')[0].toLowerCase().replace('image/jpg', 'image/jpeg');
          if (!safeDataUrl(dataUrl, kind) || mime.replace('image/jpg', 'image/jpeg') !== dataMime || dataUrl.length * 0.75 > LIMITS.maxResourceBytes) throw fail('invalid_resource', 'Resource response must be a bounded safe data URL with a matching MIME type.');
          return { dataUrl };
        } catch (error) {
          abort(options.signal);
          return { reason: String(error?.code || 'fetch_failed').slice(0, 100) };
        }
      }, value => {
        if (value.reason) { missing(capture.report, kind, url, value.reason); return null; }
        if (kind === 'stylesheet') { capture.report.embeddedStylesheets++; return value; }
        return retainData(value.dataUrl, kind, url);
      });
      cache.set(key, task); return task;
    };
  }

  function pruneUnusedCssRules(text, state) {
    const doc = state.selectorDocument;
    // Lightweight serialization fixtures and unsupported selector engines keep
    // the old conservative behavior. Absence must be proven by the real DOM.
    if (typeof doc?.documentElement?.matches !== 'function' || !doc.querySelectorAll) return text;
    const potentiallyMatches = selector => {
      let candidate = '', at = 0, brackets = 0, parentheses = 0;
      while (at < selector.length) {
        const ch = selector[at];
        if (ch === '"' || ch === "'") { const end = readString(selector, at).end; candidate += selector.slice(at, end); at = end; continue; }
        if (ch === '\\') { candidate += selector.slice(at, at + 2); at += 2; continue; }
        if (ch === '[') brackets++;
        if (ch === ']') brackets--;
        if (brackets === 0 && ch === '(') parentheses++;
        if (brackets === 0 && ch === ')') parentheses--;
        if (ch === ':' && brackets === 0) {
          const double = selector[at + 1] === ':', name = readIdent(selector, at + (double ? 2 : 1));
          const removable = double ? ['before', 'after', 'first-letter', 'first-line', 'marker', 'selection']
            : ['hover', 'active', 'focus-visible', 'focus-within', 'focus', 'visited', 'link', 'target', 'checked', 'enabled', 'disabled', 'open'];
          if (removable.includes(name.value) && !/^\s*\(/.test(selector.slice(name.end))) {
            // Removing a branch inside forgiving :is/:where lists can leave a
            // valid but narrower selector. Keep functional cases unchanged.
            if (parentheses > 0) return true;
            at = name.end; continue;
          }
          if (double) return true;
        }
        candidate += ch; at++;
      }
      if (!candidate.trim()) return true;
      try {
        return Array.from(doc.querySelectorAll(candidate)).some(node => {
          for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
            if (state.layoutSlots?.has(ancestor)) return false;
          }
          return true;
        });
      } catch (_) { return true; }
    };
    let result = '', at = 0;
    while (at < text.length) {
      const start = at;
      while (at < text.length) {
        if (text[at] === '"' || text[at] === "'") { at = readString(text, at).end; continue; }
        if (text[at] === '\\') { at += 2; continue; }
        if (text[at] === '(') { at = closeFunction(text, at); continue; }
        if (text[at] === '{' || text[at] === ';') break;
        at++;
      }
      if (at >= text.length) { result += text.slice(start); break; }
      if (text[at] === ';') { result += text.slice(start, ++at); continue; }
      const header = text.slice(start, at), end = closeBlock(text, at);
      // Malformed/nested/unknown CSS remains conservative; the resource scanner
      // still removes all remote fallbacks and executable constructs below.
      if (text[end - 1] !== '}') { result += text.slice(start); break; }
      const body = text.slice(at + 1, end - 1), rule = header.trim();
      // :scope and relative selectors inside @scope have a different root.
      // Keep the whole scoped rule rather than query it against the document.
      if (/^@(media|supports|layer|container|starting-style)\b/i.test(rule)) {
        result += `${header}{${pruneUnusedCssRules(body, state)}}`;
      } else if (rule.startsWith('@') || potentiallyMatches(rule)) result += text.slice(start, end);
      at = end;
    }
    return result;
  }

  // A token scanner, rather than URL regex replacement, also handles CSS escapes,
  // quoted strings, nested functions and @import without retaining remote fallbacks.
  async function rewriteCss(text, baseUrl, state, depth = 0, ancestry = new Set()) {
    if (typeof text !== 'string' || text.length > LIMITS.maxCssChars) {
      missing(state.report, 'stylesheet', baseUrl, 'stylesheet_limit'); return '';
    }
    text = removeCssComments(text);
    if (state.pruneRules) text = pruneUnusedCssRules(text, state);
    const result = []; let literal = ''; let at = 0;
    const append = value => {
      if (typeof value === 'string') literal += value;
      else { if (literal) result.push(literal); literal = ''; result.push(value); }
    };
    while (at < text.length) {
      abort(state.signal);
      const ch = text[at];
      if (ch === '"' || ch === "'") { const string = readString(text, at); append(text.slice(at, string.end)); at = string.end; continue; }
      if (ch === '@') {
        const ident = readIdent(text, at + 1);
        if (ident.value === 'font-face' && /^\s*\{/.test(text.slice(ident.end))) {
          const open = text.indexOf('{', ident.end); const end = closeBlock(text, open);
          append(`@font-face{${await rewriteCss(text.slice(open + 1, end - 1), baseUrl, { ...state, resourceKind: 'font', pruneRules: false }, depth, ancestry)}}`);
          at = end; continue;
        }
        if (['import', 'charset', 'namespace'].includes(ident.value)) {
          const end = ruleEnd(text, ident.end);
          if (ident.value === 'import') {
            const rule = text.slice(ident.end, end).replace(/;\s*$/, '').trim();
            let target = ''; let consumed = 0;
            if (/^["']/.test(rule)) { const string = readString(rule, 0); target = string.value; consumed = string.end; }
            else {
              const name = readIdent(rule, 0); const open = rule.slice(name.end).match(/^\s*\(/);
              if (name.value === 'url' && open) {
                const start = name.end + open[0].length - 1; const close = closeFunction(rule, start);
                const inner = rule.slice(start + 1, close - 1).trim(); target = /^["']/.test(inner) ? readString(inner, 0).value : decodeCss(inner); consumed = close;
              }
            }
            const url = remoteUrl(target, baseUrl);
            if (!url || depth >= LIMITS.maxImportDepth || ancestry.has(url)) missing(state.report, 'stylesheet', url || target, 'invalid_or_cyclic_import');
            else {
              const resource = await state.resolve(url, 'stylesheet', baseUrl);
              if (resource) {
                const next = new Set(ancestry); next.add(url);
                let css = await rewriteCss(resource.text, resource.baseUrl || url, state, depth + 1, next);
                let modifiers = rule.slice(consumed).trim();
                const wrappers = [];
                const layer = modifiers.match(/^layer(?:\(\s*([\w.-]+)\s*\))?(?:\s+|$)/i);
                if (layer) { wrappers.push(`@layer${layer[1] ? ` ${layer[1]}` : ''}`); modifiers = modifiers.slice(layer[0].length).trim(); }
                if (/^supports\s*\(/i.test(modifiers)) {
                  const open = modifiers.indexOf('('); const close = closeFunction(modifiers, open);
                  wrappers.push(`@supports (${modifiers.slice(open + 1, close - 1)})`); modifiers = modifiers.slice(close).trim();
                }
                if (modifiers && !/[{}@;<>]/.test(modifiers)) wrappers.push(`@media ${modifiers}`);
                else if (modifiers) { css = ''; missing(state.report, 'stylesheet', url, 'unsupported_import_condition'); }
                for (const wrapper of wrappers.reverse()) css = `${wrapper}{${css}}`;
                append(css);
              }
            }
          }
          at = end; continue;
        }
      }
      if (/[-_a-zA-Z\\]/.test(ch)) {
        const ident = readIdent(text, at); const openMatch = text.slice(ident.end).match(/^\s*\(/);
        if (openMatch) {
          const open = ident.end + openMatch[0].length - 1;
          if (ident.value === 'url') {
            const end = closeFunction(text, open); const inside = text.slice(open + 1, end - 1).trim();
            const value = /^["']/.test(inside) ? readString(inside, 0).value : decodeCss(inside);
            const kind = state.resourceKind || (/(?:\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)|^data:(?:font\/|application\/(?:font|x-font|vnd.ms-font)))/i.test(value) ? 'font' : 'image');
            const pending = /^#[a-z0-9_.:-]+$/i.test(value) ? Promise.resolve({ dataUrl: value }) : state.resolve(value, kind, baseUrl);
            // Observe rejections immediately, including if a later @import is
            // cancelled before this scanner reaches its final ordered join.
            append(pending.then(resource => ({ value: resource ? `url("${resource.dataUrl.replace(/["\r\n<>]/g, '')}")` : 'none' }), error => ({ error })));
            at = end; continue;
          }
          if (CSS_IMAGE_FUNCTIONS.has(ident.value) || ident.value === 'expression') {
            warn(state.report, 'Unsupported CSS image functions or executable legacy expressions were removed.');
            append('none'); at = closeFunction(text, open); continue;
          }
        }
        if (['behavior', '-moz-binding'].includes(ident.value) && /^\s*:/.test(text.slice(ident.end))) {
          const end = text.indexOf(';', ident.end); const brace = text.indexOf('}', ident.end);
          at = brace >= 0 && (end < 0 || brace < end) ? brace : end < 0 ? text.length : end + 1; continue;
        }
        append(text.slice(at, ident.end)); at = ident.end; continue;
      }
      append(ch); at++;
    }
    // HTML raw-text parsing must not let a hostile stylesheet terminate <style>.
    if (literal) result.push(literal);
    const resolved = await Promise.all(result);
    const failed = resolved.find(value => value && typeof value === 'object' && value.error);
    if (failed) throw failed.error;
    return resolved.map(value => typeof value === 'string' ? value : value.value).join('').replace(/</g, '\\3c ');
  }

  async function collectFaithfulSnapshotResources(capture, options = {}) {
    if (!capture?.outputDocument) throw fail('EXPORT_SNAPSHOT_INVALID_CAPTURE', 'A captured article is required.');
    options = { ...capture.options, ...options };
    abort(options.signal);
    const resolve = createResolver(capture, options);
    const state = { resolve, report: capture.report, signal: options.signal,
      selectorDocument: capture.outputDocument, layoutSlots: capture.layoutSlots, pruneRules: true };
    const bundle = { capture, stylesheets: [], inlineStyles: [], images: [], signal: options.signal };
    for (const sheet of capture.stylesheets) {
      let text = sheet.text; let baseUrl = sheet.baseUrl;
      if (text === null) { const fetched = await resolve(sheet.url, 'stylesheet', capture.baseUrl); if (!fetched) continue; text = fetched.text; baseUrl = fetched.baseUrl; }
      const css = await rewriteCss(text, baseUrl, state, 0, new Set(sheet.url ? [sheet.url] : []));
      if (css.trim()) bundle.stylesheets.push({ text: css, media: sheet.media });
    }
    capture.report.preservedStylesheets = bundle.stylesheets.length;
    for (const entry of capture.inlineStyles) bundle.inlineStyles.push({ node: entry.node, frozenStyle: entry.frozenStyle, text: await rewriteCss(entry.text, entry.baseUrl, { ...state, pruneRules: false }) });
    bundle.images = await Promise.all(capture.images.map(async entry => {
      const resource = await resolve(entry.url, 'image', entry.baseUrl);
      const originalResource = entry.preserveLayout && entry.originalUrl && entry.originalUrl !== entry.url
        ? await resolve(entry.originalUrl, 'image', entry.baseUrl) : null;
      let density = 1;
      if (resource?.dataUrl && entry.preserveLayout) {
        // currentSrc can come from a 2x / width-descriptor source. Re-embedding
        // its bytes as plain src would double intrinsic dimensions again.
        const ImageClass = capture.options.document.defaultView?.Image;
        if (ImageClass) {
          try {
            const decoded = new ImageClass(); decoded.src = resource.dataUrl;
            await withAbort(() => decoded.decode(), options.signal, 15000);
            density = decoded.naturalWidth / entry.naturalWidth;
            if (!Number.isFinite(density) || density <= 0) throw fail('invalid_image_dimensions', 'Image dimensions unavailable.');
          } catch (error) {
            abort(options.signal); missing(capture.report, 'image', entry.url, error.code || 'image_decode_failed');
            return { ...entry, resource: null, originalResource };
          }
        }
      }
      return { ...entry, resource, originalResource, density };
    }));
    abort(options.signal);
    return bundle;
  }

  function closedInlineDeclarations(text) {
    const declarations = []; const stack = []; let start = 0; let at = 0; let valid = true;
    while (at < text.length) {
      const ch = text[at];
      if (ch === '"' || ch === "'") {
        const string = readString(text, at);
        if (!string.closed || !string.valid) { valid = false; break; }
        at = string.end; continue;
      }
      if (ch === '\\') { if (at + 1 >= text.length) { valid = false; break; } at += 2; continue; }
      if ('([{'.includes(ch)) { stack.push({ '(': ')', '[': ']', '{': '}' }[ch]); if (stack.length > 64) { valid = false; break; } }
      else if (')]}'.includes(ch)) { if (stack.pop() !== ch) { valid = false; break; } }
      else if (ch === ';' && !stack.length) { declarations.push(text.slice(start, at)); start = at + 1; }
      at++;
    }
    if (valid && !stack.length) declarations.push(text.slice(start));
    return declarations.map(value => value.trim()).filter(Boolean).join(';');
  }

  function serializeFaithfulPageSnapshot(capture, bundle) {
    if (!capture?.outputDocument || bundle?.capture !== capture) throw fail('EXPORT_SNAPSHOT_INVALID_BUNDLE', 'Resource bundle does not belong to this capture.');
    abort(bundle.signal);
    const output = capture.outputDocument;
    while (output.head.firstChild) output.head.removeChild(output.head.firstChild);
    const charset = output.createElement('meta'); charset.setAttribute('charset', 'utf-8'); output.head.appendChild(charset);
    const csp = output.createElement('meta'); csp.setAttribute('http-equiv', 'Content-Security-Policy'); csp.setAttribute('content', CSP); output.head.appendChild(csp);
    const title = output.createElement('title'); title.textContent = String(capture.options.title || capture.options.document.title || 'Article'); output.head.appendChild(title);
    for (const sheet of bundle.stylesheets) { const node = output.createElement('style'); if (sheet.media) node.setAttribute('media', sheet.media); node.textContent = sheet.text; output.head.appendChild(node); }
    for (const entry of bundle.inlineStyles) {
      // Keep frozen state outside the publisher text during sanitization. Drop
      // an unclosed trailing declaration before appending final !important
      // hiding, so a source comment/string cannot swallow the frozen state.
      const text = entry.frozenStyle ? [closedInlineDeclarations(entry.text), entry.frozenStyle].filter(Boolean).join(';') : entry.text;
      if (text.trim()) entry.node.setAttribute('style', text);
    }
    for (const entry of bundle.images) {
      if (entry.resource?.dataUrl) {
        entry.node.setAttribute(tagOf(entry.node) === 'img' ? 'src' : 'href', entry.resource.dataUrl);
        if (entry.preserveLayout && Math.abs(entry.density - 1) > 0.000001) {
          // The only retained srcset candidate is local and has the original
          // intrinsic density; publisher picture/source fallbacks stay removed.
          entry.node.setAttribute('srcset', `${entry.resource.dataUrl} ${entry.density}x`);
        }
        if (entry.originalResource?.dataUrl) {
          const high = entry.originalResource.dataUrl;
          entry.node.setAttribute('data-brevess-original-image', high);
          // Keep source bytes as the intrinsic-size carrier. Painting HQ as a
          // local background mirrors the live display without imposing fixed
          // pixel width/height on responsive publisher styles.
          entry.node.setAttribute('style', [attr(entry.node, 'style'),
            `background-image:url("${high}")!important`,
            `background-size:${entry.originalPaint.size}!important`,
            `background-position:${entry.originalPaint.position}!important`,
            'background-repeat:no-repeat!important', 'background-origin:content-box!important',
            'background-clip:content-box!important', 'object-position:-1000000px -1000000px!important'
          ].filter(Boolean).join(';'));
        }
        if (entry.anchorId && !attr(entry.node, 'id')) entry.node.setAttribute('id', entry.anchorId);
      } else {
        const original = attr(entry.node, 'alt'); entry.node.setAttribute('alt', `${original ? `${original} — ` : ''}[offline image unavailable]`);
        entry.node.setAttribute('title', [attr(entry.node, 'title'), 'Image could not be embedded for offline use.'].filter(Boolean).join('\n'));
      }
    }
    const html = `<!doctype html>\n${output.documentElement.outerHTML}`;
    const byteSize = bytes(html);
    if (byteSize > capture.maxHtmlBytes) throw fail('EXPORT_SNAPSHOT_TOO_LARGE', 'Offline snapshot exceeds its size limit; no content was silently truncated.');
    return { html, byteSize, report: JSON.parse(JSON.stringify(capture.report)) };
  }
  async function exportFaithfulPageSnapshot(options = {}) {
    const capture = captureFaithfulPageSnapshot(options);
    const bundle = await collectFaithfulSnapshotResources(capture, options);
    return serializeFaithfulPageSnapshot(capture, bundle);
  }
  return { captureFaithfulPageSnapshot, collectFaithfulSnapshotResources, serializeFaithfulPageSnapshot, exportFaithfulPageSnapshot,
    FAITHFUL_SNAPSHOT_LIMITS: LIMITS, FAITHFUL_SNAPSHOT_CSP: CSP };
});
