(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function policyError(code, cause) {
    const error = new Error(code);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function pdfOverwriteDecision(input = {}) {
    if (input.sourceKind !== 'local') return { allowed: false, reason: 'remote_source' };
    if (input.hasFileHandle !== true) return { allowed: false, reason: 'file_handle_required' };
    const openedHash = String(input.openedHash || '');
    const currentHash = String(input.currentHash || '');
    if (!openedHash || !currentHash || openedHash !== currentHash) {
      return { allowed: false, reason: 'source_changed' };
    }
    if (input.confirmed !== true) return { allowed: false, reason: 'confirmation_required' };
    return { allowed: true, reason: '' };
  }

  function safeFileName(value, fallback = 'paper-annotated.pdf') {
    const name = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return (name || fallback).slice(0, 240);
  }

  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw policyError('invalid_pdf_bytes');
  }

  function checkpoint(input = {}) {
    if (typeof input.assertCurrent === 'function' && input.assertCurrent() !== true) {
      throw policyError('save_context_changed');
    }
  }

  function contextIsCurrent(input = {}) {
    if (typeof input.assertCurrent !== 'function') return true;
    try { return input.assertCurrent() === true; } catch (_) { return false; }
  }

  function committedError(error) {
    if (error && typeof error === 'object') error.committed = true;
    return error;
  }

  async function writeHandle(handle, bytes, input = {}) {
    if (!handle || typeof handle.createWritable !== 'function') {
      throw policyError('file_handle_required');
    }
    let writable;
    try {
      writable = await handle.createWritable();
      checkpoint(input);
      await writable.write(bytes);
      checkpoint(input);
      await writable.close();
    } catch (error) {
      try { await writable?.abort?.(); } catch (_) {}
      if (error?.code === 'save_context_changed') throw error;
      throw policyError('write_failed', error);
    }
  }

  async function requireVerification(verify, bytes) {
    if (typeof verify !== 'function') throw policyError('verification_unavailable');
    let result;
    try {
      result = await verify(bytes);
    } catch (error) {
      throw policyError('verification_failed', error);
    }
    if (result?.ok !== true) throw policyError('verification_failed');
    return result;
  }

  async function verified(input, callbackName, bytes) {
    checkpoint(input);
    const result = await requireVerification(input[callbackName], bytes);
    checkpoint(input);
    return result;
  }

  async function readHandleBytes(handle, input = null) {
    let file;
    try {
      file = await handle?.getFile?.();
      if (input) checkpoint(input);
      if (!file?.arrayBuffer) throw policyError('file_handle_required');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (input) checkpoint(input);
      return { file, bytes };
    } catch (error) {
      if (error?.code === 'save_context_changed' || error?.code === 'file_handle_required') {
        throw error;
      }
      throw policyError('source_changed', error);
    }
  }

  function acquireAnnotatedPdfSaveHandle(input = {}) {
    if (typeof input.showSaveFilePicker !== 'function') {
      return Promise.reject(policyError('picker_unavailable'));
    }
    let pending;
    try {
      pending = input.showSaveFilePicker({
        suggestedName: safeFileName(input.suggestedName),
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
      });
    } catch (error) {
      pending = Promise.reject(error);
    }
    return Promise.resolve(pending).catch(error => {
      if (error?.name === 'AbortError') throw policyError('save_cancelled', error);
      throw policyError('picker_failed', error);
    });
  }

  async function assertDistinctPdfCopyTarget(fileHandle, sourceHandle) {
    if (!sourceHandle) return true;
    if (!fileHandle || typeof fileHandle.isSameEntry !== 'function') {
      throw policyError('copy_target_identity_failed');
    }
    let same;
    try {
      same = await fileHandle.isSameEntry(sourceHandle);
    } catch (error) {
      throw policyError('copy_target_identity_failed', error);
    }
    if (same === true) throw policyError('copy_target_is_source');
    if (same !== false) throw policyError('copy_target_identity_failed');
    return true;
  }

  async function saveAnnotatedPdfCopy(input = {}) {
    const bytes = asBytes(input.bytes);
    const suggestedName = safeFileName(input.suggestedName);
    if (input.fileHandle) {
      await verified(input, 'preflight', bytes);
      await writeHandle(input.fileHandle, bytes, input);
      try {
        const actual = await readHandleBytes(input.fileHandle);
        const sha256 = input.sha256 || sha256PdfBytes;
        const [expectedHash, actualHash] = await Promise.all([
          sha256(bytes), sha256(actual.bytes)
        ]);
        const verification = await requireVerification(input.verify, actual.bytes);
        if (expectedHash !== actualHash) throw policyError('verification_failed');
        return {
          mode: 'copy',
          status: contextIsCurrent(input)
            ? 'file_verified' : 'verified_snapshot_saved_context_changed',
          fileName: safeFileName(actual.file?.name, suggestedName), actualHash, verification
        };
      } catch (error) {
        throw committedError(error);
      }
    }

    const BlobCtor = input.BlobCtor || globalThis.Blob;
    const createObjectURL = input.createObjectURL || globalThis.URL?.createObjectURL?.bind(globalThis.URL);
    const revokeObjectURL = input.revokeObjectURL || globalThis.URL?.revokeObjectURL?.bind(globalThis.URL);
    if (typeof BlobCtor !== 'function' || typeof createObjectURL !== 'function' ||
        typeof revokeObjectURL !== 'function' || typeof input.triggerDownload !== 'function') {
      throw policyError('download_unavailable');
    }
    const url = createObjectURL(new BlobCtor([bytes], { type: 'application/pdf' }));
    try {
      await verified(input, 'preflight', bytes);
      input.triggerDownload(url, suggestedName);
      return {
        mode: 'download',
        status: contextIsCurrent(input)
          ? 'export_verified_download_started'
          : 'export_verified_download_started_context_changed',
        fileName: suggestedName
      };
    } finally {
      revokeObjectURL(url);
    }
  }

  async function sha256PdfBytes(value, subtle = globalThis.crypto?.subtle) {
    const bytes = asBytes(value);
    if (!subtle?.digest) throw policyError('hash_unavailable');
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function overwriteAnnotatedPdf(input = {}) {
    const bytes = asBytes(input.bytes);
    const handle = input.fileHandle;
    await verified(input, 'preflight', bytes);
    const firstRead = await readHandleBytes(handle, input);
    const sha256 = input.sha256 || sha256PdfBytes;
    const currentHash = await sha256(firstRead.bytes);
    checkpoint(input);
    const guarded = pdfOverwriteDecision({
      sourceKind: input.sourceKind,
      hasFileHandle: Boolean(handle),
      openedHash: input.openedHash,
      currentHash,
      confirmed: true
    });
    if (!guarded.allowed) throw policyError(guarded.reason);
    const confirmed = typeof input.confirm === 'function' && input.confirm(
      `\u786e\u8ba4\u8986\u76d6\u539f\u6587\u4ef6“${safeFileName(firstRead.file.name, '当前 PDF')}”？此操作不可撤销。`
    );
    const decision = pdfOverwriteDecision({
      sourceKind: input.sourceKind,
      hasFileHandle: Boolean(handle),
      openedHash: input.openedHash,
      currentHash,
      confirmed
    });
    if (!decision.allowed) throw policyError(decision.reason);
    checkpoint(input);
    const secondRead = await readHandleBytes(handle, input);
    const secondHash = await sha256(secondRead.bytes);
    checkpoint(input);
    if (secondHash !== currentHash || secondHash !== String(input.openedHash || '')) {
      throw policyError('source_changed');
    }
    await writeHandle(handle, bytes, input);
    try {
      const actual = await readHandleBytes(handle);
      const actualHash = await sha256(actual.bytes);
      const verification = await requireVerification(input.verify, actual.bytes);
      const intendedHash = await sha256(bytes);
      if (actualHash !== intendedHash) throw policyError('verification_failed');
      return {
        mode: 'overwrite',
        status: contextIsCurrent(input)
          ? 'file_verified' : 'verified_snapshot_saved_context_changed',
        actualHash, fileName: safeFileName(actual.file.name, '当前 PDF'), verification
      };
    } catch (error) {
      throw committedError(error);
    }
  }

  return {
    pdfOverwriteDecision,
    acquireAnnotatedPdfSaveHandle,
    assertDistinctPdfCopyTarget,
    saveAnnotatedPdfCopy,
    overwriteAnnotatedPdf,
    sha256PdfBytes
  };
});
