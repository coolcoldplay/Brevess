(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(root) {
  const fail = (code, message) => Object.assign(new Error(message), { code });
  function publicHttps(value, base) {
    let url;
    try { url = new URL(String(value || ''), base); } catch (_) { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password ||
        /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(url.hostname)) return '';
    return url.href;
  }
  function jciSupplementalWrapperIdentity(value) {
    const href = publicHttps(value); if (!href) return null;
    const url = new URL(href), match = url.pathname.match(/^\/articles\/view\/([1-9]\d*)\/sd\/([1-9]\d*)\/?$/);
    return /^(?:www\.)?jci\.org$|^insight\.jci\.org$/i.test(url.hostname) && match
      ? {url, articleId:match[1], attachmentId:match[2]} : null;
  }
  function jciSupplementalResponseKeepsOwner(original, finalUrl) {
    if (!original) return true;
    const url = new URL(finalUrl);
    if (!/^(?:www\.)?jci\.org$|^insight\.jci\.org$/i.test(url.hostname)) return true;
    const match = url.pathname.match(/^\/articles\/view\/([1-9]\d*)\/sd\/(?:pdf\/render\/)?([1-9]\d*)\/?$/);
    return Boolean(match && url.origin === original.url.origin &&
      match[1] === original.articleId && match[2] === original.attachmentId);
  }
  function inspectSupplementalJciWrapper(document, base, metadata = {}) {
    const identity = jciSupplementalWrapperIdentity(base); if (!identity) return null;
    const display = document.querySelector('#asset_display'), heading = display?.previousElementSibling;
    if (!display || heading?.tagName?.toLowerCase() !== 'h3' || heading.parentElement !== display.parentElement) return null;
    const links = [...heading.querySelectorAll('a[href]')];
    if (links.length !== 1 || !/^download$/i.test(String(links[0].textContent || '').trim())) return null;
    const downloadUrl = publicHttps(links[0].getAttribute('href'), base); if (!downloadUrl) return null;
    const download = new URL(downloadUrl), text = String(heading.textContent || '').replace(/\s+/g,' ').trim();
    let declaredSourceFormat = '';
    if (/^Supplemental data\b/i.test(text) && download.origin === identity.url.origin &&
        download.pathname === `/articles/view/${identity.articleId}/sd/pdf/render/${identity.attachmentId}` && !download.search) {
      declaredSourceFormat = 'pdf';
    } else if (/^(?:Supplemental table\s+[1-9]\d*|Supporting data values)\b/i.test(text)) {
      const fileName = download.pathname.split('/').at(-1) || '';
      const prefix = identity.url.hostname === 'insight.jci.org' ? 'jci.insight.' : 'JCI';
      const file = fileName.toLowerCase();
      const expectedPrefix = (prefix+identity.articleId+'.').toLowerCase();
      const declaredType = [...display.querySelectorAll('span')].map(node=>String(node.textContent || '').trim().toLowerCase()).filter(value=>['xlsx','csv'].includes(value));
      const suffix = file.split('.').at(-1);
      const fallbackLinks = [...display.querySelectorAll('a[href]')];
      if (download.pathname.match(/^\/manuscripts\/[0-9]+\/[0-9]+\/[^/]+$/) &&
          download.pathname.split('/').at(-2) === identity.articleId && file.startsWith(expectedPrefix) &&
          /^(?:sdt[1-9]\d*|sdval)\.(?:xlsx|csv)$/.test(file.slice(expectedPrefix.length)) &&
          declaredType.length === 1 && declaredType[0] === suffix && fallbackLinks.length === 1 && publicHttps(fallbackLinks[0].getAttribute('href'),base) === downloadUrl) declaredSourceFormat = suffix;
    }
    if (!declaredSourceFormat) return null;
    return {materialId:String(metadata.materialId || ''),wrapperUrl:identity.url.href,wrapperSha256:String(metadata.wrapperSha256 || ''),
      downloadUrl,declaredSourceFormat,sourceFormat:declaredSourceFormat,kind:declaredSourceFormat==='pdf'?'pdf':'data',sourceRole:declaredSourceFormat==='pdf'?'pdf-wrapper':'data-wrapper',
      requiresFormatInspection:declaredSourceFormat==='pdf',formatEvidence:'publisher-download-wrapper',byteVerified:false,contentInspected:false};
  }

  function projectSupplementalJciWrapperMaterial(material, descriptor, target = {}) {
    const identity = jciSupplementalWrapperIdentity(material?.url), main = publicHttps(target.canonicalUrl);
    if (!identity || !main || descriptor?.materialId !== material?.materialId || descriptor.wrapperUrl !== identity.url.href ||
        !/^[a-f0-9]{64}$/.test(String(descriptor.wrapperSha256 || '')) ||
        !/^workspace:[a-f0-9]{64}$/.test(String(target.workspaceId || '')) ||
        !Number.isSafeInteger(target.workspaceGeneration) || target.workspaceGeneration < 1 ||
        !/^(?:sha256:)?[a-f0-9]{64}$/.test(String(target.documentHash || ''))) throw fail('SUPPLEMENTAL_WRAPPER_BINDING','下载页记录与原材料/论文绑定不一致');
    const canonical = new URL(main), expectedDoi = identity.url.hostname === 'insight.jci.org'
      ? '10.1172/jci.insight.'+identity.articleId : '10.1172/JCI'+identity.articleId;
    if (!(canonical.origin === identity.url.origin && canonical.pathname === '/articles/view/'+identity.articleId ||
        canonical.hostname === 'doi.org' && decodeURIComponent(canonical.pathname.slice(1)).toLowerCase() === expectedDoi.toLowerCase()) ||
        !['pdf','xlsx','csv'].includes(descriptor.declaredSourceFormat) ||
        descriptor.sourceFormat !== descriptor.declaredSourceFormat || !publicHttps(descriptor.downloadUrl))
      throw fail('SUPPLEMENTAL_WRAPPER_BINDING','下载页来源尚未确认');
    const data = descriptor.declaredSourceFormat !== 'pdf', download = new URL(descriptor.downloadUrl);
    const prefix = ((identity.url.hostname === 'insight.jci.org' ? 'jci.insight.' : 'JCI')+identity.articleId+'.').toLowerCase();
    const file = (download.pathname.split('/').at(-1) || '').toLowerCase();
    if (data ? !/^\/manuscripts\/[0-9]+\/[0-9]+\/[^/]+$/.test(download.pathname) ||
        download.pathname.split('/').at(-2) !== identity.articleId || !file.startsWith(prefix) ||
        !/^(?:sdt[1-9]\d*|sdval)\.(?:xlsx|csv)$/.test(file.slice(prefix.length)) || file.split('.').at(-1) !== descriptor.declaredSourceFormat
      : download.origin !== identity.url.origin || download.pathname !== `/articles/view/${identity.articleId}/sd/pdf/render/${identity.attachmentId}` || download.search)
      throw fail('SUPPLEMENTAL_WRAPPER_BINDING','下载目标与原材料归属不一致');
    return {...material,kind:data?'data':'pdf',sourceFormat:descriptor.declaredSourceFormat,
      requiresFormatInspection:!data,downloadUrl:descriptor.downloadUrl,
      sourceWrapper:{...descriptor,parentWorkspaceId:target.workspaceId,parentWorkspaceGeneration:target.workspaceGeneration,
        parentCanonicalUrl:target.canonicalUrl,parentDocumentHash:target.documentHash}};
  }

  function supplementalPdfWrapperTarget(document, base, metadata = {}) {
    if (jciSupplementalWrapperIdentity(base)) {
      const descriptor = inspectSupplementalJciWrapper(document,base,metadata);
      if (!descriptor) throw fail('SUPPLEMENTAL_PDF_SOURCE_AMBIGUOUS','出版社附件页未提供同文献唯一下载入口');
      if (descriptor.declaredSourceFormat !== 'pdf') throw Object.assign(
        fail('SUPPLEMENTAL_DATA_SOURCE_REQUIRED','出版社附件页指向数据文件，须检查原文件格式和内容'),{wrapperInspection:descriptor});
      return descriptor.downloadUrl;
    }
    const urls = new Set();
    for (const node of document.querySelectorAll('a[href],object[data],embed[src],iframe[src]')) {
      const source = node.getAttribute(node.tagName.toLowerCase() === 'object' ? 'data' :
        node.tagName.toLowerCase() === 'a' ? 'href' : 'src');
      const href = publicHttps(source, base);
      if (!href || new URL(href).origin !== new URL(base).origin) continue;
      const text = String(node.textContent || '').trim();
      const context = String(node.parentElement?.textContent || '').trim();
      const typed = String(node.getAttribute('type') || '').toLowerCase() === 'application/pdf';
      const ownerLinks = node.parentElement?.querySelectorAll('a[href],object[data],embed[src],iframe[src]');
      const label = ownerLinks?.length === 1 ? context : text;
      const identified = /\b(?:supplement(?:al|ary|s)?|supporting\s+(?:information|data|material))\b/i.test(label) &&
        !/\b(?:article|full[ -]text|main[ -]paper)\b/i.test(text);
      const actionable = node.tagName.toLowerCase() !== 'a' ||
        /\b(?:download|pdf)\b/i.test(text) || node.hasAttribute('download');
      if (identified && (typed || actionable)) urls.add(href);
    }
    if (urls.size !== 1) throw fail('SUPPLEMENTAL_PDF_SOURCE_AMBIGUOUS',
      '附件页没有唯一可确认的补充 PDF 下载链接');
    return [...urls][0];
  }
  async function fetchSupplementalPdfSource(material, options = {}) {
    const initial = publicHttps(material?.url);
    const originalJciOwner = jciSupplementalWrapperIdentity(initial);
    if (!initial) throw fail('SUPPLEMENTAL_PDF_SOURCE_INVALID', '补充材料链接无效');
    const maximumBytes = Math.min(200 * 1024 * 1024, Number(options.maximumBytes) || 64 * 1024 * 1024);
    const fetcher = options.fetch || root.fetch.bind(root);
    const controller = new AbortController();
    const external = options.signal;
    const abort = () => controller.abort(external?.reason);
    if (external?.aborted) abort();
    external?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), 30000);
    const visited = [];
    let current = initial;
    try {
      for (let hop = 0; hop < 2; hop++) {
        const response = await fetcher(current, { signal: controller.signal,
          credentials: 'omit', redirect: 'follow' });
        if (!response.ok) throw fail('SUPPLEMENTAL_PDF_FETCH_FAILED', '出版社附件获取失败');
        const finalUrl = publicHttps(response.url || current);
        if (!finalUrl) throw fail('SUPPLEMENTAL_PDF_SOURCE_INVALID', '附件重定向链接无效');
        if (!jciSupplementalResponseKeepsOwner(originalJciOwner,finalUrl)) {
          await response.body?.cancel?.().catch(() => {});
          throw fail('SUPPLEMENTAL_WRAPPER_BINDING','附件重定向不属于原始论文/附件');
        }
        const contentLength = Number(response.headers.get('content-length'));
        if (contentLength > maximumBytes) throw fail('PDF_LOCAL_FILE_TOO_LARGE', '补充材料超过文件大小限制');
        const reader = response.body?.getReader?.();
        if (!reader) throw fail('SUPPLEMENTAL_PDF_FETCH_FAILED', '附件响应无法读取');
        const chunks = []; let bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > maximumBytes) throw fail('PDF_LOCAL_FILE_TOO_LARGE', '补充材料超过文件大小限制');
            chunks.push(part.value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        const data = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
        visited.push({ requestedUrl: current, finalUrl });
        if (data.length >= 5 && String.fromCharCode(...data.slice(0, 5)) === '%PDF-') {
          const digest = await root.crypto.subtle.digest('SHA-256', data);
          controller.signal.throwIfAborted();
          return { blob: new Blob([data], { type: 'application/pdf' }),
            sha256: [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join(''),
            byteLength: bytes, requestedUrl: initial, finalUrl, visited };
        }
        if (hop || !/text\/html/i.test(response.headers.get('content-type') || '')) {
          throw fail('SUPPLEMENTAL_PDF_INVALID', '出版社响应不是有效 PDF');
        }
        if (bytes > 2 * 1024 * 1024) throw fail('SUPPLEMENTAL_PDF_INVALID', '附件包装页超过读取限制');
        if (originalJciOwner && !jciSupplementalWrapperIdentity(finalUrl))
          throw fail('SUPPLEMENTAL_WRAPPER_BINDING','附件包装页已离开原始出版社来源');
        const html = new TextDecoder().decode(data);
        const parser = options.parseHtml || (value => new root.DOMParser().parseFromString(value, 'text/html'));
        const wrapperDigest = await root.crypto.subtle.digest('SHA-256',data);
        controller.signal.throwIfAborted();
        const wrapperSha256 = [...new Uint8Array(wrapperDigest)].map(value=>value.toString(16).padStart(2,'0')).join('');
        current = supplementalPdfWrapperTarget(parser(html), finalUrl,{materialId:material?.materialId,wrapperSha256});
        if (visited.some(entry => entry.requestedUrl === current || entry.finalUrl === current)) {
          throw fail('SUPPLEMENTAL_PDF_SOURCE_AMBIGUOUS', '附件下载链接循环');
        }
      }
      throw fail('SUPPLEMENTAL_PDF_INVALID', '未取得原始 PDF');
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', abort);
    }
  }
  return { inspectSupplementalJciWrapper, projectSupplementalJciWrapperMaterial, supplementalPdfWrapperTarget, fetchSupplementalPdfSource };
});
