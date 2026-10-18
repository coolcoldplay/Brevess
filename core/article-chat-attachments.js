(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const ARTICLE_CHAT_ATTACHMENT_LIMITS = Object.freeze({
    maxAttachments: 4, maxImages: 4, maxImageBytes: 2 * 1024 * 1024,
    maxImageTotalBytes: 8 * 1024 * 1024, maxTextCharacters: 60000,
    maxTextTotalCharacters: 120000, maxDocumentImages: 16
  });
  const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json',
    'application/pdf']);

  function invalid(field, message, code = 'INVALID_SETTINGS') {
    const error = new Error(message);
    error.code = code;
    error.fields = [field];
    error.retryable = false;
    return error;
  }

  function bounded(value, maximum, field, required = true) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' || value.length > maximum ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) {
      throw invalid(field, `Invalid ${field}`);
    }
    const result = value.normalize('NFC').trim();
    if (required && !result) throw invalid(field, `${field} cannot be empty`);
    return result;
  }

  function fingerprint(value) {
    let first = 2166136261;
    let second = 2166136261 ^ 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
      first = Math.imul(first ^ value.charCodeAt(index), 16777619);
      second = Math.imul(second ^ value.charCodeAt(index), 2246822519);
    }
    return `attachment-v1-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function normalizeImage(value, field) {
    const dataUrl = value?.dataUrl;
    if (typeof dataUrl !== 'string' || dataUrl.length > 3 * 1024 * 1024) {
      throw invalid(field, 'Image attachment must contain a bounded PNG, JPEG or WebP data URL');
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
    if (!match || match[2].length % 4 !== 0) {
      throw invalid(field, 'Image attachment must contain valid base64 PNG, JPEG or WebP data');
    }
    const byteLength = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    // Match the provider's conservative base64 estimate so no admitted image
    // disappears later at its two-MiB transport boundary.
    if (!byteLength || Math.floor(match[2].length * 3 / 4) > ARTICLE_CHAT_ATTACHMENT_LIMITS.maxImageBytes) {
      throw invalid(field, 'Each image must be at most 2 MiB');
    }
    if (value.mediaType && value.mediaType !== match[1]) throw invalid(field, 'Image media type does not match its data');
    return { dataUrl, mediaType: match[1], byteLength, contentHash: fingerprint(dataUrl) };
  }

  function normalizeArticleChatAttachments(value) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > ARTICLE_CHAT_ATTACHMENT_LIMITS.maxAttachments) {
      throw invalid('attachments', 'At most four chat attachments are supported');
    }
    let totalText = 0;
    let totalImageBytes = 0;
    const ids = new Set();
    return value.map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('attachments', 'Invalid attachment');
      const attachmentId = bounded(raw.attachmentId, 160, 'attachmentId');
      if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(attachmentId) || ids.has(attachmentId)) {
        throw invalid('attachmentId', 'Attachment IDs must be safe and unique');
      }
      ids.add(attachmentId);
      const name = bounded(raw.name, 240, 'attachment.name');
      if (raw.kind === 'image') {
        const image = normalizeImage(raw, 'attachments.image');
        totalImageBytes += image.byteLength;
        if (totalImageBytes > ARTICLE_CHAT_ATTACHMENT_LIMITS.maxImageTotalBytes) {
          throw invalid('attachments', 'Attached images exceed the 8 MiB total limit');
        }
        return Object.freeze({ attachmentId, name, kind: 'image', ...image });
      }
      if (raw.kind !== 'text' || !TEXT_TYPES.has(raw.mediaType)) {
        throw invalid('attachments', 'Supported attachments are images, text, Markdown, CSV, JSON and readable PDF text');
      }
      const text = bounded(raw.text, ARTICLE_CHAT_ATTACHMENT_LIMITS.maxTextCharacters, 'attachments.text');
      totalText += text.length;
      if (totalText > ARTICLE_CHAT_ATTACHMENT_LIMITS.maxTextTotalCharacters) {
        throw invalid('attachments', 'Attachment text exceeds the 120000-character total limit');
      }
      if (raw.mediaType === 'application/json') {
        try { JSON.parse(text); } catch { throw invalid('attachments.text', 'The JSON attachment is invalid'); }
      }
      const byteLength = new TextEncoder().encode(text).length;
      const pdf = raw.mediaType === 'application/pdf';
      if (pdf && (raw.sourceType !== 'pdf' || !Number.isSafeInteger(raw.pageCount) || raw.pageCount < 1 || raw.pageCount > 1000)) {
        throw invalid('attachments', 'Readable PDF attachments require extracted text and a valid page count');
      }
      return Object.freeze({ attachmentId, name, kind: 'text', mediaType: raw.mediaType,
        byteLength, text, contentHash: fingerprint(text),
        ...(pdf ? { sourceType: 'pdf', pageCount: raw.pageCount } : {}) });
    });
  }

  function articleChatAttachmentMetadata(attachments) {
    return (attachments || []).map(({ dataUrl, text, ...metadata }) => ({ ...metadata }));
  }

  function normalizeArticleChatDocumentImages(value, binding = {}) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > ARTICLE_CHAT_ATTACHMENT_LIMITS.maxDocumentImages) {
      throw invalid('document.images', 'Too many article image candidates');
    }
    let totalBytes = 0;
    const ids = new Set();
    return value.map(raw => {
      const imageId = bounded(raw?.imageId, 160, 'document.images.imageId');
      if (ids.has(imageId)) throw invalid('document.images', 'Article image IDs must be unique');
      ids.add(imageId);
      const image = normalizeImage(raw, 'document.images');
      if (raw.documentHash && binding.documentHash && raw.documentHash !== binding.documentHash) {
        throw invalid('document.images', 'Article image belongs to another document');
      }
      const captionSourceKey = bounded(raw.captionSourceKey, 160, 'captionSourceKey', false);
      if (captionSourceKey && Array.isArray(binding.captionSourceKeys) &&
          !binding.captionSourceKeys.includes(captionSourceKey)) {
        throw invalid('document.images', 'Article image caption does not belong to this document context');
      }
      totalBytes += image.byteLength;
      if (totalBytes > ARTICLE_CHAT_ATTACHMENT_LIMITS.maxImageTotalBytes) {
        throw invalid('document.images', 'Article images exceed the 8 MiB total limit');
      }
      return Object.freeze({ imageId,
        figureId: bounded(raw.figureId, 160, 'figureId', false),
        label: bounded(raw.label, 300, 'figure.label', false),
        captionSourceKey,
        ...(binding.documentHash ? { documentHash: binding.documentHash } : {}),
        ...image });
    });
  }

  function figureNumbers(value) {
    return [...String(value || '').normalize('NFKC').matchAll(/(?:\bfig(?:ure)?[\s:._-]*|图\s*)(s?\d+)(?!\d)/giu)]
      .map(match => match[1].toLowerCase());
  }

  function selectArticleChatImages(input, plan, options = {}) {
    const attachments = (input.attachments || []).filter(item => item.kind === 'image');
    if (attachments.length && options.supportsVision !== true) {
      throw invalid('attachments', 'The selected model cannot read image attachments', 'VISION_UNSUPPORTED');
    }
    const requestedFigures = new Set(figureNumbers(input.question));
    const captionKeys = new Set((plan.chunks || []).filter(chunk => chunk.recordType === 'figure-caption')
      .flatMap(chunk => chunk.sourceKeys || []));
    const candidates = (input.document.images || []).map((image, index) => {
      const caption = (input.document.typedRecords || []).find(record =>
        record.recordType === 'figure-caption' && record.sourceKey === image.captionSourceKey);
      const numbers = figureNumbers(`${image.label} ${image.figureId} ${caption?.text?.slice(0, 300) || ''}`);
      const explicit = numbers.some(number => requestedFigures.has(number));
      const related = captionKeys.has(image.captionSourceKey);
      return { image, index, numbers, explicit, related, score: (explicit ? 100 : 0) + (related ? 10 : 0) };
    }).filter(item => requestedFigures.size ? item.explicit : item.related || plan.mode === 'full')
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const chosen = options.supportsVision === true
      ? candidates.slice(0, Math.max(0, 4 - attachments.length)).map(item => item.image) : [];
    const images = [...attachments, ...chosen].map(item => ({ dataUrl: item.dataUrl, mediaType: item.mediaType }));
    const sentFigures = new Set(candidates.filter(item => chosen.includes(item.image)).flatMap(item => item.numbers));
    const unavailableFigures = [...requestedFigures].filter(number => !sentFigures.has(number));
    const metadata = [...attachments.map(item => ({ origin: 'attachment', attachmentId: item.attachmentId,
      name: item.name, contentHash: item.contentHash })), ...chosen.map(item => ({ origin: 'article',
      imageId: item.imageId, figureId: item.figureId, label: item.label,
      documentHash: item.documentHash || input.document.documentHash,
      captionSourceKey: item.captionSourceKey, contentHash: item.contentHash }))]
      .map((item, index) => ({ imageNumber: index + 1, ...item }));
    return {
      images, metadata,
      status: images.length ? unavailableFigures.length ? 'partially_sent' : 'sent' : options.supportsVision !== true && candidates.length
        ? 'vision_unsupported' : requestedFigures.size ? 'requested_image_unavailable' : 'not_requested',
      omittedImageCount: candidates.length - chosen.length,
      requestedFigures: [...requestedFigures], unavailableFigures
    };
  }

  return { ARTICLE_CHAT_ATTACHMENT_LIMITS, normalizeArticleChatAttachments,
    articleChatAttachmentMetadata, normalizeArticleChatDocumentImages, selectArticleChatImages };
});
