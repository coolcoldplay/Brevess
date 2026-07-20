(() => {
  const normalize = value => String(value || '').normalize('NFKC')
    .replace(/\s+/gu, ' ').trim();
  const truncate = (value, limit = 180) => normalize(value).slice(0, limit);
  const selectors = [
    '#body', '.Body', '.article-body', '[data-aa-name="article-body"]',
    '.article__sections', 'article', 'main', '[role="main"]',
    '.article-content', '.article__body', '[data-testid="article-body"]',
    '[data-article-body]'
  ];
  const headingSelector = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]',
    '.section-title', '.section__title', '.article-section-title',
    '[data-aa-name*="section-title" i]'
  ].join(',');
  const paragraphSelector = [
    'p', '[role="paragraph"]', '.section-paragraph',
    '.article-section p', '.Body p'
  ].join(',');

  function cssPath(element) {
    if (!(element instanceof Element)) return '';
    const parts = [];
    let current = element;
    while (current && parts.length < 7) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${CSS.escape(current.id)}`;
        parts.unshift(part);
        break;
      }
      const classes = [...current.classList].slice(0, 3);
      if (classes.length) part += classes.map(name => `.${CSS.escape(name)}`).join('');
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(item => item.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function headingRecord(element) {
    return {
      text: truncate(element.textContent, 240),
      tag: element.tagName,
      id: element.id || '',
      className: truncate(element.className, 180),
      ariaLevel: element.getAttribute('aria-level') || '',
      dataAaName: element.getAttribute('data-aa-name') || '',
      visible: isVisible(element),
      path: cssPath(element)
    };
  }

  function candidateRecord(element, index) {
    const headings = [...element.querySelectorAll(headingSelector)];
    const paragraphs = [...new Set([...element.querySelectorAll(paragraphSelector)])];
    const paragraphLengths = paragraphs.map(item => normalize(item.textContent).length);
    const rect = element.getBoundingClientRect();
    return {
      index,
      selectorsMatched: selectors.filter(selector => {
        try { return element.matches(selector); } catch (_) { return false; }
      }),
      tag: element.tagName,
      id: element.id || '',
      className: truncate(element.className, 240),
      dataAaName: element.getAttribute('data-aa-name') || '',
      role: element.getAttribute('role') || '',
      path: cssPath(element),
      visible: isVisible(element),
      rect: {
        top: Math.round(rect.top), left: Math.round(rect.left),
        width: Math.round(rect.width), height: Math.round(rect.height)
      },
      headingCount: headings.length,
      visibleHeadingCount: headings.filter(isVisible).length,
      paragraphCount: paragraphs.length,
      paragraphCharacterCount: paragraphLengths.reduce((sum, value) => sum + value, 0),
      paragraphLengthRange: paragraphLengths.length ? {
        min: Math.min(...paragraphLengths), max: Math.max(...paragraphLengths)
      } : null,
      headings: headings.slice(0, 80).map(headingRecord),
      directChildren: [...element.children].slice(0, 50).map(child => ({
        tag: child.tagName,
        id: child.id || '',
        className: truncate(child.className, 180),
        dataAaName: child.getAttribute('data-aa-name') || '',
        headingCount: child.querySelectorAll(headingSelector).length,
        paragraphCount: child.querySelectorAll(paragraphSelector).length,
        textSample: truncate(child.textContent, 120)
      }))
    };
  }

  const candidateElements = [];
  const seenCandidates = new Set();
  const selectorCounts = {};
  selectors.forEach(selector => {
    let matches = [];
    try { matches = [...document.querySelectorAll(selector)]; } catch (_) {}
    selectorCounts[selector] = matches.length;
    matches.forEach(element => {
      if (seenCandidates.has(element)) return;
      seenCandidates.add(element);
      candidateElements.push(element);
    });
  });

  const outlineSelector = [
    'nav a[href*="#"]', 'aside a[href*="#"]',
    '[class*="outline" i] a[href*="#"]', '[id*="outline" i] a[href*="#"]',
    '[data-aa-name*="outline" i] a[href*="#"]',
    '[aria-label*="outline" i] a[href*="#"]'
  ].join(',');
  const outlineLinks = [...new Set([...document.querySelectorAll(outlineSelector)])];
  const outline = outlineLinks.slice(0, 200).map(link => {
    const href = link.getAttribute('href') || '';
    const hashIndex = href.lastIndexOf('#');
    let targetId = hashIndex >= 0 ? href.slice(hashIndex + 1) : '';
    try { targetId = decodeURIComponent(targetId); } catch (_) {}
    const target = targetId ? document.getElementById(targetId) : null;
    return {
      text: truncate(link.textContent, 240), href: truncate(href, 320), targetId,
      target: target ? {
        tag: target.tagName, id: target.id || '',
        className: truncate(target.className, 220), path: cssPath(target),
        headingCount: target.querySelectorAll(headingSelector).length,
        paragraphCount: target.querySelectorAll(paragraphSelector).length,
        textSample: truncate(target.textContent, 140)
      } : null
    };
  });

  const report = {
    schema: 'sci-publisher-dom-diagnostic-v1',
    generatedAt: new Date().toISOString(),
    page: {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      hostname: location.hostname,
      viewport: { width: innerWidth, height: innerHeight },
      documentHeight: document.documentElement.scrollHeight
    },
    selectorCounts,
    candidates: candidateElements.slice(0, 80).map(candidateRecord),
    outline: {
      linkCount: outlineLinks.length,
      resolvedTargetCount: outline.filter(item => item.target).length,
      entries: outline
    },
    allHeadings: [...document.querySelectorAll(headingSelector)]
      .slice(0, 300).map(headingRecord)
  };

  window.__sciPublisherDomDiagnostic = report;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `sci-publisher-diagnostic-${location.hostname}-${Date.now()}.json`;
  link.style.display = 'none';
  document.documentElement.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 1000);
})();
