(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.SciLLM = root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(root) {
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const keys = ['workspaceId', 'workspaceGeneration', 'canonicalUrl', 'documentHash', 'targetArticleTabId'];
  const hash = async bytes => [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  function docxSourceUrl(value) {
    let url; try { url = new URL(value); } catch (_) { fail('DOCX_SOURCE_URL_INVALID'); }
    if (url.protocol !== 'https:' || url.username || url.password ||
        /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(url.hostname)) fail('DOCX_SOURCE_URL_INVALID');
    return url.href;
  }
  function assertDocxMaterial(material, materials) {
    if (!material?.materialId || !material.url || !Array.isArray(materials)) fail('DOCX_DECLARATION_MISSING');
    const matches = materials.filter(item => item?.materialId === material.materialId);
    if (matches.length !== 1 || matches[0].url !== material.url) fail('DOCX_DECLARATION_CHANGED');
    docxSourceUrl(material.url);
  }
  async function fetchSupplementalDocxSource(material, options = {}) {
    const url = docxSourceUrl(material?.url), max = 64 * 1024 * 1024;
    const controller = new AbortController(), abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      controller.signal.throwIfAborted();
      const response = await (options.fetch || root.fetch)(url, {
        signal: controller.signal, credentials: 'omit', redirect: 'follow'
      });
      if (!response.ok) fail('DOCX_FETCH_FAILED');
      const finalUrl = docxSourceUrl(response.url || url);
      if (Number(response.headers.get('content-length')) > max) fail('DOCX_SOURCE_TOO_LARGE');
      const reader = response.body?.getReader?.(); if (!reader) fail('DOCX_FETCH_FAILED');
      const chunks = []; let size = 0;
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; if (size > max) fail('DOCX_SOURCE_TOO_LARGE');
          chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      root.SciLLM.inspectDocxZipDirectory(bytes);
      const sha256 = await hash(bytes); controller.signal.throwIfAborted();
      return { bytes, sha256, requestedUrl: url, finalUrl, byteLength: size };
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
  function validateDocxContentTypes(parts, options = {}) {
    const Parser = options.DOMParser || root.DOMParser;
    if (typeof Parser !== 'function') fail('DOCX_DOM_PARSER_UNAVAILABLE');
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(parts.get('[Content_Types].xml'));
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) fail('DOCX_XML_DECLARATION_UNSUPPORTED');
    const doc = new Parser().parseFromString(xml, 'application/xml');
    const ns = 'http://schemas.openxmlformats.org/package/2006/content-types';
    if (doc.getElementsByTagName('parsererror').length || doc.documentElement?.localName !== 'Types' ||
        doc.documentElement.namespaceURI !== ns) fail('DOCX_CONTENT_TYPES_INVALID');
    const entries = [...doc.documentElement.children].filter(node => node.localName === 'Override' &&
      node.namespaceURI === ns && node.getAttribute('PartName') === '/word/document.xml');
    if (entries.length !== 1 || entries[0].getAttribute('ContentType') !==
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') fail('DOCX_CONTENT_TYPES_INVALID');
  }
  function inspectSupplementalDocxAbsence(pkg, options = {}) {
    const Parser = options.DOMParser || root.DOMParser;
    if (typeof Parser !== 'function') fail('DOCX_DOM_PARSER_UNAVAILABLE');
    validateDocxContentTypes(pkg.parts, options);
    const findings = [], scannedParts = [];
    let tableCount = 0, bodyParagraphCount = 0;
    for (const [name, bytes] of pkg.parts) {
      if (/^word\/(?:media|embeddings)\//u.test(name)) findings.push({ code: 'DOCX_EMBEDDED_MEDIA_PRESENT', partName: name });
      if (!/^word\/.+\.(?:xml|rels)$/u.test(name)) continue;
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) fail('DOCX_XML_DECLARATION_UNSUPPORTED');
      const doc = new Parser().parseFromString(xml, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) fail('DOCX_DOCUMENT_XML_INVALID');
      scannedParts.push(name);
      for (const node of doc.getElementsByTagName('*')) {
        if (['drawing', 'pict', 'object', 'blip', 'imagedata', 'AlternateContent', 'shape'].includes(node.localName))
          findings.push({ code: 'DOCX_VISUAL_NODE_PRESENT', partName: name, node: node.localName });
        if (['altChunk', 'subDoc'].includes(node.localName))
          findings.push({ code: 'DOCX_CONTENT_NODE_UNRESOLVED', partName: name, node: node.localName });
        if (node.localName === 'Relationship' && /\/image$/u.test(node.getAttribute('Type') || ''))
          findings.push({ code: 'DOCX_IMAGE_RELATIONSHIP_PRESENT', partName: name });
        if (node.localName === 'Relationship' && /\/(?:aFChunk|altChunk|subDocument|subDoc)$/iu.test(node.getAttribute('Type') || ''))
          findings.push({ code: 'DOCX_CONTENT_RELATIONSHIP_UNRESOLVED', partName: name,
            relationshipId: node.getAttribute('Id') || '', relationshipType: node.getAttribute('Type'),
            target: node.getAttribute('Target') || '' });
        if (name === 'word/document.xml' && node.localName === 'tbl') tableCount++;
        if (name === 'word/document.xml' && node.localName === 'p') bodyParagraphCount++;
      }
    }
    const blocks = root.SciLLM.readDocxBodyBlocks(new TextDecoder('utf-8', { fatal: true }).decode(pkg.parts.get('word/document.xml')), options);
    if (blocks.some(block => root.SciLLM.parseDocxSupplementalCaption(block.text)))
      findings.push({ code: 'DOCX_FIGURE_CAPTION_WITHOUT_MEDIA' });
    return { checkedNoFigures: findings.length === 0, findings, scannedParts, tableCount, bodyParagraphCount,
      classification: findings.length ? 'visual-or-unresolved' : tableCount ? 'tables-and-text-no-embedded-figures' : 'text-no-embedded-figures' };
  }
  const docxParentKeys = ['workspaceId','workspaceGeneration','canonicalUrl','documentHash'];
  function validateSupplementalDocxFigureAsset(asset, material, target) {
    const invalid = () => fail('DOCX_FIGURE_ASSET_INVALID');
    const record = asset?.sourceInspection, manifest = asset?.docxFigureManifest;
    if (!record || asset.materialId !== material?.materialId || asset.sourceUrl !== material?.url ||
        record.materialId !== material.materialId || record.sourceUrl !== material.url || record.sourceFormat !== 'docx' ||
        record.status !== 'inspected' || record.classification !== 'figure-material' || record.complete !== true ||
        record.checkedNoFigures !== false || !/^[a-f0-9]{64}$/.test(record.sourceSha256 || '') ||
        record.sourceSha256 !== record.containerSha256 || !Number.isSafeInteger(record.byteLength) || record.byteLength < 1 ||
        docxParentKeys.some(key => record.target?.[key] !== target?.[key]) ||
        asset.parentWorkspaceId !== target.workspaceId || asset.parentWorkspaceGeneration !== target.workspaceGeneration ||
        asset.parentCanonicalUrl !== target.canonicalUrl || asset.parentDocumentHash !== target.documentHash ||
        manifest?.status !== 'ready' || manifest.error != null || manifest.containerSha256 !== record.sourceSha256 ||
        !Array.isArray(asset.figures) || !asset.figures.length || asset.figures.length > 300 ||
        manifest.figureCount !== asset.figures.length || manifest.mediaCount !== asset.figures.length ||
        manifest.missing?.length || !Array.isArray(record.figureKeys) || record.figureKeys.length !== asset.figures.length) invalid();
    const seen = new Set(), paths = new Set(), parts = new Set(), relationships = new Set();
    for (const figure of asset.figures) {
      const p = figure.sourceProof, image = figure.sourceImage, key = root.SciLLM.supplementalFigureKey(figure.figureLabel);
      if (!key || seen.has(key) || !record.figureKeys.includes(key) || !figure.isSupplemental || !String(figure.caption || '').trim() ||
          p?.kind !== 'docx-embedded-image' || p.sourceMaterialId !== material.materialId || p.sourceUrl !== material.url ||
          p.containerSha256 !== record.sourceSha256 || !/^word\/media\/[a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp)$/.test(p.partName || '') ||
          parts.has(p.partName) || relationships.has(p.relationshipId) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(p.relationshipId || '') ||
          !Number.isSafeInteger(p.imageBlockIndex) || p.imageBlockIndex < 0 ||
          !Array.isArray(p.captionBlockIndices) || !p.captionBlockIndices.length ||
          p.captionBlockIndices.some(i => !Number.isSafeInteger(i) || i < 0) ||
          !/^[a-f0-9]{64}$/.test(p.captionSha256 || '') || !/^[a-f0-9]{64}$/.test(image?.sha256 || '') ||
          p.sourceFingerprint !== 'sha256:' + image.sha256 || figure.sourceFingerprint !== p.sourceFingerprint ||
          !/^pdf\/figures\/supplemental\/docx-[a-f0-9]{64}\.(?:png|jpe?g|webp)$/.test(image.relativePath || '') ||
          paths.has(image.relativePath) || !Number.isSafeInteger(image.byteLength) || image.byteLength < 1 ||
          !['image/png','image/jpeg','image/webp'].includes(image.mimeType) ||
          !Array.isArray(figure.analysisImages) || figure.analysisImages.length !== 1) invalid();
      root.SciLLM.normalizeSupplementalTransientImage(figure.analysisImages[0], figure.sourceFingerprint);
      seen.add(key); paths.add(image.relativePath); parts.add(p.partName); relationships.add(p.relationshipId);
    }
    return asset;
  }
  async function verifySupplementalDocxFigureAsset(asset, material, target, readImage, check = () => {}) {
    validateSupplementalDocxFigureAsset(asset, material, target);
    const verifiedAssets = [];
    for (const figure of asset.figures) {
      check();
      if (await hash(new TextEncoder().encode(figure.caption)) !== figure.sourceProof.captionSha256) fail('DOCX_CAPTION_CHANGED');
      check(); const result = await readImage(figure.sourceImage); check();
      if (result?.found !== true || result.relativePath !== figure.sourceImage.relativePath || result.sha256 !== figure.sourceImage.sha256)
        fail('DOCX_IMAGE_READBACK_FAILED');
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(result.dataUrl || '');
      if (!match || match[1] !== figure.sourceImage.mimeType) fail('DOCX_IMAGE_READBACK_FAILED');
      const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
      const signature = match[1] === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
        match[1] === 'image/png' ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) :
        String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
      if (!signature || bytes.length !== figure.sourceImage.byteLength || await hash(bytes) !== figure.sourceImage.sha256)
        fail('DOCX_IMAGE_READBACK_FAILED');
      check(); verifiedAssets.push({...figure.sourceImage, verified:true});
    }
    return { materialId:material.materialId, sourceUrl:material.url, sourceSha256:asset.sourceInspection.sourceSha256,
      inspection:{record:asset.sourceInspection,sourceSha256:asset.sourceInspection.sourceSha256},
      sourceImagePersistence:{complete:true,...target,verifiedAssets} };
  }
  async function prepareSupplementalDocxFigureAsset(bytes, material, target, options = {}) {
    options.check?.();
    const pkg = await root.SciLLM.unpackSupplementalDocxParts(bytes, options); options.check?.();
    validateDocxContentTypes(pkg.parts, options);
    const absence = inspectSupplementalDocxAbsence(pkg, options);
    if (absence.checkedNoFigures) fail('DOCX_NO_FIGURES_USE_EXISTING_INSPECTION');
    const prepared = await root.SciLLM.prepareSupplementalDocxImports(bytes, {...options,materialId:material.materialId,sourceUrl:material.url});
    options.check?.();
    const unsupported = absence.findings.filter(f => ['DOCX_CONTENT_NODE_UNRESOLVED','DOCX_CONTENT_RELATIONSHIP_UNRESOLVED'].includes(f.code) ||
      f.code === 'DOCX_EMBEDDED_MEDIA_PRESENT' && f.partName.startsWith('word/embeddings/') ||
      f.code === 'DOCX_VISUAL_NODE_PRESENT' && ['pict','object','AlternateContent','shape'].includes(f.node));
    const media = [...pkg.parts.keys()].filter(name => /^word\/media\//.test(name));
    if (!prepared.complete || unsupported.length || media.length !== prepared.importRecords.length)
      throw Object.assign(new Error('DOCX_FIGURES_INCOMPLETE'),{code:'DOCX_FIGURES_INCOMPLETE',missing:[...prepared.missing,...unsupported]});
    const figures = [], binaryAssets = [];
    for (const imported of prepared.importRecords) {
      const original = pkg.parts.get(imported.sourceProof.partName), sha256 = await hash(original); options.check?.();
      if (imported.sourceProof.sourceFingerprint !== 'sha256:' + sha256) fail('DOCX_SOURCE_FINGERPRINT_CHANGED');
      const old = imported.draft.figures[0], transient = root.SciLLM.normalizeSupplementalTransientImage(imported.transientImage, 'sha256:' + sha256);
      const ext = imported.sourceProof.partName.split('.').at(-1).toLowerCase(), mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const relativePath = 'pdf/figures/supplemental/docx-' + sha256 + '.' + ext;
      const draft = root.SciLLM.createSupplementalFigureImportDraft({ ...old, sourceMaterialId:material.materialId,
        caption:old.caption, title:material.title, sourceMode:'image', sourceFingerprint:'sha256:' + sha256 });
      const caption = draft.figures[0].caption;
      const sourceProof = {...imported.sourceProof,captionSha256:await hash(new TextEncoder().encode(caption))};
      figures.push({...draft.figures[0],sourceUrl:material.url,sourceProof,analysisImages:[transient],
        sourceImage:{relativePath,sha256,byteLength:original.length,mimeType}});
      let binary = ''; for (const byte of original) binary += String.fromCharCode(byte);
      binaryAssets.push({relativePath,sha256,mimeType,dataUrl:'data:' + mimeType + ';base64,' + btoa(binary)});
    }
    const sourceInspection = {schemaVersion:1,materialId:material.materialId,sourceUrl:material.url,sourceFormat:'docx',
      sourceSha256:pkg.containerSha256,containerSha256:pkg.containerSha256,byteLength:pkg.byteLength,
      status:'inspected',classification:'figure-material',figureKeys:figures.map(f => root.SciLLM.supplementalFigureKey(f.figureLabel)),
      complete:true,checkedNoFigures:false,target:Object.fromEntries(docxParentKeys.map(key=>[key,target[key]])),parentWorkspaceId:target.workspaceId,
      parentWorkspaceGeneration:target.workspaceGeneration,parentCanonicalUrl:target.canonicalUrl,parentDocumentHash:target.documentHash};
    const asset = {schemaVersion:1,materialId:material.materialId,title:material.title || '',sourceUrl:material.url,sourceFormat:'docx',
      parentWorkspaceId:target.workspaceId,parentWorkspaceGeneration:target.workspaceGeneration,parentCanonicalUrl:target.canonicalUrl,
      parentDocumentHash:target.documentHash,sourceInspection,figures,
      docxFigureManifest:{status:'ready',error:null,containerSha256:pkg.containerSha256,figureCount:figures.length,mediaCount:media.length,missing:[]}};
    validateSupplementalDocxFigureAsset(asset, material, target);
    let container = ''; for (const byte of new Uint8Array(bytes)) container += String.fromCharCode(byte);
    return {asset,binaryAssets,sourceBase64:btoa(container)};
  }
  async function validateSupplementalDocxFigureSource(prepared, material, target, options = {}) {
    const asset = validateSupplementalDocxFigureAsset(prepared.asset,material,target);
    if (typeof prepared.sourceBase64 !== 'string' || prepared.sourceBase64.length > 90 * 1024 * 1024 ||
        !/^[a-zA-Z0-9+/]*={0,2}$/.test(prepared.sourceBase64)) fail('DOCX_SOURCE_BYTES_REQUIRED');
    const bytes = Uint8Array.from(atob(prepared.sourceBase64),c => c.charCodeAt(0));
    const pkg = await root.SciLLM.unpackSupplementalDocxParts(bytes,options);options.check?.();
    if (pkg.containerSha256 !== asset.sourceInspection.sourceSha256 || pkg.byteLength !== asset.sourceInspection.byteLength)
      fail('DOCX_SOURCE_BYTES_CHANGED');
    validateDocxContentTypes(pkg.parts,options);
    const absence = inspectSupplementalDocxAbsence(pkg,options);
    if (absence.findings.some(f => ['DOCX_CONTENT_NODE_UNRESOLVED','DOCX_CONTENT_RELATIONSHIP_UNRESOLVED'].includes(f.code) ||
        f.code === 'DOCX_EMBEDDED_MEDIA_PRESENT' && f.partName.startsWith('word/embeddings/') ||
        f.code === 'DOCX_VISUAL_NODE_PRESENT' && ['pict','object','AlternateContent','shape'].includes(f.node)) ||
        [...pkg.parts.keys()].some(name => /^word\/(?:header|footer|footnotes|endnotes)\d*\.xml$/.test(name))) fail('DOCX_FIGURES_INCOMPLETE');
    const decode = new TextDecoder('utf-8',{fatal:true});
    const association = root.SciLLM.associateDocxFigureBlocks(root.SciLLM.readDocxBodyBlocks(decode.decode(pkg.parts.get('word/document.xml')),options));
    const links = root.SciLLM.resolveDocxImageRelationships(root.SciLLM.readDocxRelationshipRecords(
      decode.decode(pkg.parts.get('word/_rels/document.xml.rels')),options),pkg.parts.keys());
    const media = [...pkg.parts.keys()].filter(name => /^word\/media\//.test(name));
    if (!association.associationComplete || links.unresolved.length || association.figures.length !== asset.figures.length ||
        links.images.length !== asset.figures.length || media.length !== asset.figures.length) fail('DOCX_FIGURES_INCOMPLETE');
    for (const figure of association.figures) {
      const stored = asset.figures.find(f => f.figureLabel === figure.figureLabel), reference = figure.imageReferences[0];
      const part = links.images.find(i => i.relationshipId === reference.relationshipId)?.partName;
      if (!stored || !part || reference.externalRelationshipId || stored.caption !== figure.caption ||
          stored.sourceProof.relationshipId !== reference.relationshipId || stored.sourceProof.partName !== part ||
          stored.sourceProof.imageBlockIndex !== reference.blockIndex ||
          JSON.stringify(stored.sourceProof.captionBlockIndices) !== JSON.stringify(figure.captionBlocks) ||
          pkg.parts.get(part).length !== stored.sourceImage.byteLength || await hash(pkg.parts.get(part)) !== stored.sourceImage.sha256)
        fail('DOCX_SOURCE_INVENTORY_CHANGED');
      options.check?.();
    }
  }
  async function persistSupplementalDocxFigureAsset(prepared, deps) {
    const {material,target,check,readJson,saveJson,readImage,saveImage} = deps;
    const asset = validateSupplementalDocxFigureAsset(prepared?.asset, material, target);
    if (!Array.isArray(prepared.binaryAssets) || prepared.binaryAssets.length !== asset.figures.length) fail('DOCX_FIGURES_INCOMPLETE');
    check(); const previous = await readJson(); check();
    if (previous?.content?.sourceUrl && previous.content.sourceUrl !== material.url ||
        previous?.content?.figures?.length && JSON.stringify(previous.content) !== JSON.stringify(asset)) fail('DOCX_INSPECTION_CONFLICT');
    await validateSupplementalDocxFigureSource(prepared,material,target,{check,DOMParser:deps.DOMParser});check();
    // Verify original bytes before any write; supplied metadata cannot certify corrupt data.
    const supplied = new Map(prepared.binaryAssets.map(b => [b.relativePath,b]));
    if (supplied.size !== asset.figures.length) fail('DOCX_FIGURES_INCOMPLETE');
    await verifySupplementalDocxFigureAsset(asset,material,target,async expected => ({found:true,...supplied.get(expected.relativePath)}),check);
    for (const binary of prepared.binaryAssets) {
      check(); const saved = await saveImage(binary); check();
      if (saved?.saved !== true || saved.directoryPersisted !== true) fail('DOCX_IMAGE_NOT_DURABLE');
    }
    const proof = await verifySupplementalDocxFigureAsset(asset,material,target,readImage,check); check();
    const saved = await saveJson(asset,previous); check();
    const stored = await readJson(); check();
    if (saved?.saved !== true || saved.directoryPersisted !== true || JSON.stringify(stored?.content) !== JSON.stringify(asset)) fail('DOCX_INSPECTION_NOT_DURABLE');
    await verifySupplementalDocxFigureAsset(stored.content,material,target,readImage,check); check();
    return {success:true,directoryPersisted:true,relativePath:root.SciLLM.supplementalFigureAssetPath(material.materialId),
      sourceInspection:asset.sourceInspection,sourceImagePersistence:proof.sourceImagePersistence,importedCount:asset.figures.length};
  }

  return { validateSupplementalDocxFigureSource,validateSupplementalDocxFigureAsset,verifySupplementalDocxFigureAsset,prepareSupplementalDocxFigureAsset,persistSupplementalDocxFigureAsset, assertDocxMaterial, fetchSupplementalDocxSource, validateDocxContentTypes, inspectSupplementalDocxAbsence };
});
