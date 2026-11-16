(function attach(root, factory) {
  const shared = typeof module === 'object' && module.exports
    ? require('./pdf-figure-request.js') : (root.SciLLM = root.SciLLM || {});
  const api = factory(root, shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(root, shared) {
  const VERSION = 1;
  const HASH_PATTERN = /^[a-f0-9]{64}$/u;
  const ID_PATTERN = /^pdfa-[a-f0-9]{48}$/u;
  const SOURCE_TYPES = new Set(['full-figure', 'page-region', 'panel']);

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, stableValue(value[key])]));
  }

  function stableJson(value) {
    return JSON.stringify(stableValue(value));
  }

  function bytesCopy(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    fail('PDF_FIGURE_ASSET_BYTES_INVALID');
  }

  async function sha256FigureBytes(value) {
    const bytes = bytesCopy(value);
    if (root.crypto?.subtle) {
      const digest = await root.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(item => item.toString(16).padStart(2, '0')).join('');
    }
    if (typeof require === 'function') {
      return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    }
    fail('PDF_FIGURE_ASSET_DIGEST_UNAVAILABLE');
  }

  function canonicalHash(value) {
    const hash = String(value || '').trim().toLowerCase().replace(/^sha256:/u, '');
    return HASH_PATTERN.test(hash) ? hash : '';
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function safeToken(value) {
    const token = String(value || '').trim();
    return /^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(token) ? token : '';
  }

  function bindingOf(value) {
    const binding = {
      documentHash: canonicalHash(value?.documentHash),
      documentGeneration: positiveInteger(value?.documentGeneration),
      semanticRevision: positiveInteger(value?.semanticRevision ?? value?.revision)
    };
    return binding.documentHash && binding.documentGeneration && binding.semanticRevision
      ? binding : null;
  }

  function sameBinding(left, right) {
    return Boolean(left && right && left.documentHash === right.documentHash &&
      left.documentGeneration === right.documentGeneration &&
      left.semanticRevision === right.semanticRevision);
  }

  function normalizedRect(value) {
    if (!value || typeof value !== 'object') return null;
    const rect = { x: Number(value.x), y: Number(value.y),
      width: Number(value.width), height: Number(value.height) };
    return Object.values(rect).every(Number.isFinite) && rect.x >= 0 && rect.y >= 0 &&
      rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 1 &&
      rect.y + rect.height <= 1 ? rect : null;
  }

  function validatedPages(input) {
    const pageCount = positiveInteger(input?.pageCount);
    const source = input?.pageNumbers;
    if (pageCount === null || !Array.isArray(source) || !source.length ||
        new Set(source).size !== source.length ||
        source.some(page => positiveInteger(page) === null || page > pageCount)) {
      fail('PDF_FIGURE_PAGE_INVALID');
    }
    return [...source].sort((left, right) => left - right);
  }

  function validDimensions(input) {
    return positiveInteger(input?.width) !== null && positiveInteger(input?.height) !== null &&
      /^image\/[a-z0-9.+-]+$/iu.test(String(input?.mimeType || ''));
  }

  function createPdfFigureAssetRegistry(input = {}) {
    if (typeof input.getCurrentBinding !== 'function') {
      fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
    }
    const entries = new Map();
    const slots = new Map();

    // Owner replacements must advance documentGeneration monotonically.
    function currentBinding() {
      let value;
      try {
        value = bindingOf(input.getCurrentBinding());
      } catch (_) {
        fail('PDF_FIGURE_ASSET_STALE');
      }
      if (!value) fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
      return value;
    }

    function requireInputBinding(value) {
      const declared = bindingOf(value);
      const current = currentBinding();
      if (!declared || !sameBinding(declared, current)) fail('PDF_FIGURE_ASSET_STALE');
      return declared;
    }

    function slotKeyFor(binding, figureId, sourceType, sourceSlot, pageNumber) {
      return stableJson({ ...binding, figureId, sourceType, sourceSlot,
        pageNumber: pageNumber || null });
    }

    function requireCurrentParent(inputValue, binding, figureId, pageNumbers) {
      if (!ID_PATTERN.test(String(inputValue.parentAssetId || '')) ||
          !canonicalHash(inputValue.parentImageContentHash)) {
        fail('PDF_FIGURE_CROP_PARENT_INVALID');
      }
      const parent = entries.get(inputValue.parentAssetId);
      if (!parent || parent.descriptor.imageContentHash !== inputValue.parentImageContentHash ||
          !sameBinding(bindingOf(parent.descriptor), binding) ||
          parent.descriptor.figureId !== figureId ||
          stableJson(parent.descriptor.pageNumbers) !== stableJson(pageNumbers) ||
          slots.get(parent.slotKey)?.descriptor.assetId !== parent.descriptor.assetId ||
          parent.descriptor.sourceType === 'panel') {
        fail('PDF_FIGURE_CROP_PARENT_INVALID');
      }
      return parent;
    }

    function requireCurrentAsset(entry) {
      const descriptor = entry.descriptor;
      const binding = bindingOf(descriptor);
      if (!sameBinding(binding, currentBinding()) ||
          slots.get(entry.slotKey)?.descriptor.assetId !== descriptor.assetId) {
        fail('PDF_FIGURE_ASSET_STALE');
      }
      if (descriptor.sourceType === 'panel') {
        requireCurrentParent(descriptor, binding, descriptor.figureId, descriptor.pageNumbers);
      }
    }

    async function register(value = {}) {
      const binding = requireInputBinding(value);
      const figureId = safeToken(value.figureId);
      const sourceSlot = safeToken(value.sourceSlot);
      const sourceType = String(value.sourceType || '').trim().toLowerCase();
      const pageNumbers = validatedPages(value);
      if (!figureId || !sourceSlot || !SOURCE_TYPES.has(sourceType) || !validDimensions(value)) {
        fail('PDF_FIGURE_ASSET_INPUT_INVALID');
      }
      let pageNumber = null;
      let rect = null;
      let parent = null;
      let encoderRevision = null;
      if (sourceType === 'page-region') {
        pageNumber = positiveInteger(value.pageNumber);
        rect = normalizedRect(value.rect);
        if (pageNumber === null || !pageNumbers.includes(pageNumber) || !rect) {
          fail('PDF_FIGURE_REGION_INVALID');
        }
      } else if (sourceType === 'panel') {
        rect = normalizedRect(value.rect);
        encoderRevision = positiveInteger(value.encoderRevision);
        if (!rect || encoderRevision === null) fail('PDF_FIGURE_REGION_INVALID');
        parent = requireCurrentParent(value, binding, figureId, pageNumbers);
      }
      const finalBytes = bytesCopy(value.bytes);
      if (!finalBytes.byteLength) fail('PDF_FIGURE_ASSET_BYTES_INVALID');
      const imageContentHash = await sha256FigureBytes(finalBytes);
      if (!sameBinding(binding, currentBinding())) fail('PDF_FIGURE_ASSET_STALE');
      if (value.expectedImageContentHash !== undefined &&
          canonicalHash(value.expectedImageContentHash) !== imageContentHash) {
        fail('PDF_FIGURE_ASSET_HASH_MISMATCH');
      }
      const slotKey = slotKeyFor(binding, figureId, sourceType, sourceSlot, pageNumber);
      const previous = slots.get(slotKey);
      const assetRevision = previous
        ? previous.descriptor.imageContentHash === imageContentHash
          ? previous.descriptor.assetRevision : previous.descriptor.assetRevision + 1
        : 1;
      const cropProof = sourceType === 'panel' ? stableJson({
        parentAssetId: parent.descriptor.assetId,
        parentImageContentHash: parent.descriptor.imageContentHash,
        parentAssetRevision: parent.descriptor.assetRevision,
        rect,
        encoderRevision
      }) : '';
      const cropRevision = sourceType !== 'panel' ? 0
        : previous ? previous.cropProof === cropProof
          ? previous.descriptor.cropRevision : previous.descriptor.cropRevision + 1
          : 1;
      const descriptorBase = {
        documentHash: binding.documentHash,
        documentGeneration: binding.documentGeneration,
        semanticRevision: binding.semanticRevision,
        figureId,
        pageNumbers,
        sourceType,
        sourceSlot,
        mimeType: String(value.mimeType).toLowerCase(),
        width: value.width,
        height: value.height,
        imageContentHash,
        assetRevision,
        cropRevision,
        ...(sourceType === 'page-region' ? { pageNumber, rect } : {}),
        ...(sourceType === 'panel' ? {
          parentAssetId: parent.descriptor.assetId,
          parentImageContentHash: parent.descriptor.imageContentHash,
          rect,
          encoderRevision
        } : {})
      };
      const assetId = `pdfa-${(await sha256FigureBytes(
        new TextEncoder().encode(stableJson(descriptorBase)))).slice(0, 48)}`;
      if (!sameBinding(binding, currentBinding())) fail('PDF_FIGURE_ASSET_STALE');
      // Hashing yields: the validated parent must still own its slot at commit.
      if (parent && slots.get(parent.slotKey)?.descriptor.assetId !== parent.descriptor.assetId) {
        fail('PDF_FIGURE_CROP_PARENT_INVALID');
      }
      const descriptor = deepFreeze({ assetId, ...descriptorBase });
      const entry = { descriptor, bytes: finalBytes, slotKey, cropProof };
      entries.set(assetId, entry);
      slots.set(slotKey, entry);
      return descriptor;
    }

    async function resolveForRequest(request = {}) {
      if (!Array.isArray(request.assetIds) || request.assetIds.length !== 1) {
        fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
      }
      const assetId = request.assetIds[0];
      if (!ID_PATTERN.test(String(assetId || '')) || !entries.has(assetId)) {
        fail('PDF_FIGURE_ASSET_NOT_FOUND');
      }
      const entry = entries.get(assetId);
      requireCurrentAsset(entry);
      if (!request.expected || stableJson(request.expected) !== stableJson(entry.descriptor)) {
        fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
      }
      if (await sha256FigureBytes(entry.bytes) !== entry.descriptor.imageContentHash) {
        fail('PDF_FIGURE_ASSET_HASH_MISMATCH');
      }
      // The owner, asset slot, or crop parent may have changed during hashing.
      requireCurrentAsset(entry);
      const copy = entry.bytes.buffer.slice(
        entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength
      );
      Object.freeze(copy);
      return deepFreeze({ descriptor: entry.descriptor, bytes: copy });
    }

    async function resolveSetForRequest(request = {}) {
      let visualEvidenceSet;
      try {
        visualEvidenceSet = JSON.parse(JSON.stringify(request.visualEvidenceSet));
      } catch (_) {
        fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
      }
      if (!visualEvidenceSet ||
          visualEvidenceSet.version !== 'pdf-figure-visual-evidence-set-v1' ||
          typeof shared.createPdfFigureVisualEvidenceSet !== 'function') {
        fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
      }
      const recreated = await shared.createPdfFigureVisualEvidenceSet(visualEvidenceSet);
      if (!canonicalHash(visualEvidenceSet.setDigest) ||
          visualEvidenceSet.setDigest !== recreated.setDigest ||
          stableJson(visualEvidenceSet) !== stableJson(recreated)) {
        fail('PDF_FIGURE_VISUAL_SET_DIGEST_MISMATCH');
      }

      const resolved = recreated.assets.map(descriptor => {
        if (!ID_PATTERN.test(String(descriptor.assetId || '')) ||
            !entries.has(descriptor.assetId)) {
          fail('PDF_FIGURE_ASSET_NOT_FOUND');
        }
        const entry = entries.get(descriptor.assetId);
        if (stableJson(descriptor) !== stableJson(entry.descriptor)) {
          fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
        }
        return entry;
      });

      // Treat the set as one atomic read: every member must be current both
      // before any byte hashing and after every asynchronous hash has settled.
      resolved.forEach(requireCurrentAsset);
      const hashes = await Promise.all(resolved.map(entry => sha256FigureBytes(entry.bytes)));
      resolved.forEach(requireCurrentAsset);
      hashes.forEach((hash, index) => {
        if (hash !== resolved[index].descriptor.imageContentHash) {
          fail('PDF_FIGURE_ASSET_HASH_MISMATCH');
        }
      });

      const images = resolved.map(entry => {
        const copy = entry.bytes.buffer.slice(
          entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength
        );
        Object.freeze(copy);
        return { descriptor: entry.descriptor, bytes: copy };
      });
      return deepFreeze({ visualEvidenceSet: recreated, images });
    }

    return Object.freeze({ register, resolveForRequest, resolveSetForRequest });
  }

  return { PDF_FIGURE_ASSET_REGISTRY_VERSION: VERSION,
    createPdfFigureAssetRegistry, sha256FigureBytes };
});
