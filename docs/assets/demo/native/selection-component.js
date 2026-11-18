/* Generated from production content.js by build-website-demo.mjs. */
window.BVCreateSelectionUI = function(env) {
 const {SciLLM,chrome,currentManualDocument,currentManualBlocks,currentManualCategories,currentManualAnalysisModes,
  saveSelectionSurfaceAnnotations,sendManualMessage,appendManualFixedPhrase,addCurrentArticleAbbreviation,
  showManualStatus,restoreManualAnnotations,updateCurrentManualRecord,ensureAutomaticHighlightAnnotation,
  showHighlightContextPopover}=env;
 let currentManualSelection=null,currentManualSelectionUi=null;
 let currentManualAnalysisModeId=currentManualAnalysisModes[0].id;
 const currentManualSelectionActions=env.actions,currentManualSelectionProfileId='prepared-example';
 const currentManualSelectionWebSearchEnabled=false,currentManualSelectionWebSearchSupported=false;
 const currentManualRebindId='',currentManualUnresolved=[],manualAnnotationDrafts=new Map();
 const manualSelectionDismissalRevision=0,articleWorkspaceLifecycleGeneration=1;
 const contentDocumentIdentity='public-alphafold-demo',currentArticleStructure={revision:1};
 const llmPresentationState={language:'zh-CN'},manualUiLifecycle={retain(){}};
 const contentNavigationIdentity=()=>location.href.split('#')[0];
 const effectiveArticlePageUrl=()=>env.source;
 const manualReadableText=element=>element.textContent;
 const isCurrentManualMutationCandidate=descriptor=>descriptor.validation?.valid===true;
 const scheduleCurrentArticleArchiveSave=()=>{},releaseSelectionAfterManualAction=()=>closeManualSelectionToolbar();
 /* production:showManualSelectionToolbar:start */
function showManualSelectionToolbar(descriptor, { event: selectionEvent } = {}) {
    const translateUi = value => SciLLM.translateInterfaceText?.(String(value || ''),
        SciLLM.getInterfaceLanguage?.() || (typeof llmPresentationState === 'undefined' ? 'zh-CN' : llmPresentationState.language || 'zh-CN')) || String(value || '');
    closeManualSelectionToolbar();
    const toolbarDescriptor = { ...descriptor,
        manualAnalysisModeId: descriptor.manualAnalysisModeId || currentManualAnalysisModeId || '' };
    currentManualSelection = toolbarDescriptor;
    manualUiLifecycle.retain({ selection: toolbarDescriptor });
    const toolbar = document.createElement('div');
    toolbar.id = 'sci-manual-toolbar';
    toolbar.className = 'sci-selection-surface';
    toolbar.dataset.sciPluginUi = 'true';
    toolbar.setAttribute('role', 'dialog');
    toolbar.setAttribute('aria-label', translateUi('选区阅读工具'));
    const navigationIdentity = contentNavigationIdentity();
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
    let epoch = 0, translationController = null, operationId = '', saving = false, speechController = null;
    let cancelAfterPaint = () => {}, disposeDrag = () => {}, annotationPreparation = null;
    const speechLease = Object.freeze({ selectionId: automaticAnnotationId('selection'),
        documentId: toolbarDescriptor.documentId, navigationIdentity, workspaceLifecycle });
    const existingAnnotation = toolbarDescriptor.existingAnnotation;
    const draftKey = existingAnnotation && manualAnnotationDraftKey(toolbarDescriptor.documentId, existingAnnotation.annotationId);
    let selectedCategory = existingAnnotation ? manualCategoryById(existingAnnotation.categoryId) || {
        categoryId: existingAnnotation.categoryId, ...existingAnnotation.categorySnapshot
    } : toolbarDescriptor.initialCategory || null;
    let savedNote = existingAnnotation?.note || '';
    const surface = {
        descriptor: toolbarDescriptor, annotations: existingAnnotation ? [{ ...existingAnnotation }] : [],
        current: () => currentManualSelectionUi === surface && toolbar.isConnected &&
            currentManualSelection === toolbarDescriptor &&
            (toolbarDescriptor.readOnly || currentManualDocument?.documentId === toolbarDescriptor.documentId) &&
            articleWorkspaceLifecycleGeneration === workspaceLifecycle &&
            contentNavigationIdentity() === navigationIdentity,
        canMutate: () => !toolbarDescriptor.readOnly && surface.validSource(),
        validSource: () => surface.current() && (toolbarDescriptor.readOnly
            ? toolbarDescriptor.sourceCurrent?.() === true : existingAnnotation
            ? selectionSurfaceExistingAnnotationCurrent(toolbarDescriptor)
            : isCurrentManualMutationCandidate(toolbarDescriptor) &&
            (toolbarDescriptor.anchorSegments?.length ? toolbarDescriptor.anchorSegments :
                [{ blockId: toolbarDescriptor.blockId, anchor: toolbarDescriptor.anchor }]).every(segment => {
                if (segment.anchor?.pdfAnchor) return true; // Native generation is checked by the existing guard.
                const block = currentManualBlocks.find(item => item.blockId === segment.blockId);
                const anchor = segment.anchor;
                return block?.element?.isConnected && anchor &&
                    manualReadableText(block.element).slice(anchor.startOffset, anchor.endOffset) === anchor.quote;
            })),
        cancelTasks: () => {
            epoch += 1;
            translationController?.abort(); translationController = null;
            speechController?.stop();
            if (operationId) {
                void chrome.runtime.sendMessage({ type: 'LLM_CONTROL_OPERATION', operationId, command: 'cancel' }).catch(() => {});
                operationId = '';
            }
        },
        dispose: () => { disposeDrag(); cancelAfterPaint(); surface.cancelTasks(); speechController?.destroy(); clearInterval(leaseTimer); }
    };
    currentManualSelectionUi = surface;
    // No editor timeout. Only an actual document/navigation lease change retires the surface.
    const leaseTimer = setInterval(() => { if (!surface.current()) closeManualSelectionToolbar(); }, 200);
    const node = (tag, className, text = '') => {
        const item = document.createElement(tag); item.className = className; item.textContent = translateUi(text); return item;
    };
    const button = (text, className, label = text) => {
        const item = makeManualButton(translateUi(text), className); item.title = translateUi(label); item.setAttribute('aria-label', translateUi(label)); return item;
    };
    const status = node('div', 'sci-selection-status');
    status.setAttribute('role', 'status');
    const modeStatuses = new Map();
    const renderModeStatus = () => {
        const message = modeStatuses.get(toolbar.dataset.mode) || { text: '', error: false };
        status.textContent = message.text; status.classList.toggle('is-error', message.error);
        status.dataset.selectionStatusMode = toolbar.dataset.mode || '';
    };
    const announce = (text, error = false, mode = toolbar.dataset.mode || 'translation') => {
        if (!surface.current()) return;
        modeStatuses.set(mode, { text: translateUi(text), error }); renderModeStatus();
        positionManualFloating(toolbar, toolbarDescriptor.rect);
    };
    const speechStatus = node('div', 'sci-selection-speech-status');
    speechStatus.setAttribute('role', 'status');
    const top = node('div', 'sci-selection-top');
    const palette = node('div', 'sci-selection-palette');
    palette.setAttribute('aria-label', translateUi('高亮类别'));
    const context = node('div', 'sci-selection-context');
    const contextSelect = document.createElement('select');
    contextSelect.setAttribute('aria-label', translateUi('切换手动高亮类别的阅读情境'));
    for (const mode of currentManualAnalysisModes) {
        const option = new Option(mode.name, mode.id); contextSelect.appendChild(option);
    }
    contextSelect.value = toolbarDescriptor.manualAnalysisModeId;
    contextSelect.disabled = !currentManualAnalysisModes.length;
    if (toolbarDescriptor.readOnly && !toolbarDescriptor.pendingAnnotation) { palette.hidden = true; contextSelect.disabled = true; }
    contextSelect.hidden = true;
    const contextToggle = button('▾', 'sci-selection-context-toggle', '切换阅读情境');
    contextToggle.setAttribute('aria-expanded', 'false');
    contextToggle.setAttribute('aria-controls', 'sci-selection-context-menu');
    const contextMenu = node('div', 'sci-selection-context-menu');
    contextMenu.id = 'sci-selection-context-menu'; contextMenu.hidden = true;
    contextMenu.setAttribute('role', 'group'); contextMenu.setAttribute('aria-label', translateUi('阅读情境'));
    const closeContextMenu = () => { contextMenu.hidden = true; contextToggle.setAttribute('aria-expanded', 'false'); };
    for (const mode of currentManualAnalysisModes) {
        const choice = button(mode.name, 'sci-selection-context-choice', mode.name);
        choice.dataset.modeId = mode.id;
        choice.addEventListener('click', () => {
            if (contextSelect.disabled) return;
            contextSelect.value = mode.id; contextSelect.dispatchEvent(new Event('change', { bubbles: true }));
            closeContextMenu(); contextToggle.focus({ preventScroll: true });
        });
        contextMenu.appendChild(choice);
    }
    const openContextMenu = () => {
        if (contextSelect.disabled) return;
        contextMenu.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modeId === contextSelect.value)));
        contextMenu.hidden = false; contextToggle.setAttribute('aria-expanded', 'true');
    };
    contextToggle.addEventListener('click', () => { if (contextMenu.hidden) openContextMenu(); else closeContextMenu(); });
    contextToggle.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); openContextMenu(); if (!contextMenu.hidden) contextMenu.querySelector('button')?.focus(); }
    });
    contextMenu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeContextMenu(); contextToggle.focus(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); const choices = [...contextMenu.querySelectorAll('button')]; const i = choices.indexOf(event.target);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (i + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
            choices[next]?.focus();
        }
    });
    toolbar.addEventListener('pointerdown', event => { if (!context.contains(event.target) && !contextMenu.contains(event.target)) closeContextMenu(); });
    context.append(contextSelect, contextToggle);
    const dragHandle = button('⠿', 'sci-selection-drag', '拖动划句弹窗');
    dragHandle.title = translateUi('拖动调整位置；方向键微调');
    disposeDrag = bindManualFloatingDrag(toolbar, dragHandle);
    top.append(dragHandle, context, palette, contextMenu);
    const speech = button('', 'sci-selection-speech', '朗读所选文字');
    speech.dataset.state = 'idle';
    speech.setAttribute('aria-pressed', 'false'); speech.setAttribute('aria-busy', 'false');
    const speakerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    speakerSvg.setAttribute('viewBox', '0 0 24 24'); speakerSvg.setAttribute('aria-hidden', 'true');
    speakerSvg.setAttribute('width', '18'); speakerSvg.setAttribute('height', '18');
    speakerSvg.setAttribute('fill', 'none'); speakerSvg.setAttribute('stroke', 'currentColor');
    speakerSvg.setAttribute('stroke-width', '1.6');
    const speakerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const speechHeadPath = 'M4 9h4l5-4v14l-5-4H4ZM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14';
    speakerPath.setAttribute('d', speechHeadPath);
    speakerPath.setAttribute('fill', 'none');
    speakerPath.setAttribute('stroke-linecap', 'round');
    speakerPath.setAttribute('stroke-linejoin', 'round');
    speakerSvg.appendChild(speakerPath); speech.appendChild(speakerSvg); top.appendChild(speech);
    speechController = SciLLM.createSelectionTtsController?.({
        sendMessage: message => chrome.runtime.sendMessage(message),
        getLease: () => speechLease,
        isCurrentLease: lease => lease?.selectionId === speechLease.selectionId && surface.validSource(),
        onState: state => {
            if (!surface.current()) return;
            speech.dataset.state = state.status;
            const active = ['loading', 'playing'].includes(state.status);
            speakerPath.setAttribute('d', state.status === 'playing' ? 'M6 6h12v12H6Z' : speechHeadPath);
            const label = active ? '停止朗读' : state.status === 'awaiting_play' ? '播放朗读' : '朗读所选文字';
            speech.title = translateUi(label); speech.setAttribute('aria-label', translateUi(label));
            speech.setAttribute('aria-pressed', String(active));
            speech.setAttribute('aria-busy', String(state.status === 'loading'));
            speechStatus.textContent = state.status === 'awaiting_play'
                ? translateUi('朗读：浏览器需要再次点击才能播放。') : state.status === 'error'
                ? translateUi('朗读：' + (state.errorMessage || '未完成，请检查设置中的朗读服务。'))
                : state.noticeMessage ? translateUi(state.noticeMessage) : '';
            speechStatus.classList.toggle('is-error', state.status === 'error');
            positionManualFloating(toolbar, toolbarDescriptor.rect);
        }
    }) || null;
    speech.disabled = !speechController;
    const speechText = () => toolbarDescriptor.translationText ?? toolbarDescriptor.text;
    speech.addEventListener('click', event => {
        if (!surface.validSource() || !speechController) return;
        const state = speechController.getState();
        if (['loading', 'playing'].includes(state.status)) speechController.stop();
        else if (state.status === 'awaiting_play') void speechController.resume({ event });
        else void speechController.speak({ text: speechText(), event, automatic: false });
    });
    const body = node('div', 'sci-selection-body');
    const content = node('div', 'sci-selection-content');
    const rail = node('div', 'sci-selection-rail'); rail.setAttribute('role', 'tablist');
    rail.setAttribute('aria-label', translateUi('选区工具模式')); rail.setAttribute('aria-orientation', 'vertical');
    const panes = {}, tabs = {};
    for (const [mode, label, icon] of [
        ['translation', '本地翻译', 'translate'], ['note', '手写备注', 'note-pencil'],
        ['ai', 'AI 解读', 'magnifying-glass'], ['addition', '规则与缩略词', '']
    ]) {
        const pane = node('section', 'sci-selection-pane');
        pane.id = 'sci-selection-pane-' + mode; pane.setAttribute('role', 'tabpanel');
        pane.setAttribute('aria-label', translateUi(label)); pane.hidden = true; panes[mode] = pane; content.appendChild(pane);
        const tab = button('', 'sci-selection-mode', label);
        tab.id = 'sci-selection-tab-' + mode; tab.dataset.selectionMode = mode;
        tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', pane.id);
        pane.setAttribute('aria-labelledby', tab.id);
        if (icon) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
            svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', {
                translate: 'M3 5h12M9 2v3M12 5c-1 6-4 9-9 11M5 8c2 4 5 6 9 8m0 5 4-11 4 11m-7-3h6',
                'note-pencil': 'M13 3H4v18h16V11M8 17h8m-4-8 6-6 3 3-6 6-4 1 1-4Z',
                'magnifying-glass': 'M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'
            }[icon]);
            svg.appendChild(path); tab.appendChild(svg);
        }
        else { const letter = node('span', 'side-panel-tool-letter', 'A'); letter.setAttribute('aria-hidden', 'true'); tab.append(letter); }
        tabs[mode] = tab; rail.appendChild(tab);
        if (toolbarDescriptor.readOnly && !toolbarDescriptor.pendingAnnotation && mode !== 'translation') tab.disabled = true;
        tab.addEventListener('click', () => switchMode(mode));
    }
    const close = button('×', 'sci-selection-close', '关闭选区工具');
    close.addEventListener('click', closeManualSelectionToolbar); rail.appendChild(close);
    body.append(content, rail); toolbar.append(top, speechStatus, body, status);

    const translationResult = node('div', 'sci-selection-translation-result', '仅翻译所选文字，论文文本在本机处理。');
    translationResult.setAttribute('aria-live', 'polite');
    const translate = button('开启本地翻译', 'sci-selection-translate');
    translate.hidden = true;
    const translateHint = node('p', 'sci-selection-hint', '首次使用或资源缺失时，浏览器可能需要下载翻译资源。');
    panes.translation.append(translationResult, translateHint, translate);
    if (toolbarDescriptor.translationSelection) {
        translationResult.textContent = toolbarDescriptor.text;
        translateHint.textContent = translateUi('已选中译文，可朗读；保存高亮或备注请选中对应原文。');
        tabs.translation.setAttribute('aria-label', translateUi('译文选区'));
        tabs.translation.title = translateUi('译文选区');
    }
    const runTranslation = async () => {
        if (translationController) return;
        if (!surface.validSource()) { announce('页面正文已变化，请重新选择文字', true, 'translation'); return; }
        const adapter = globalThis.__brevessBilingualTranslation;
        if (!adapter?.translateSelection) {
            translate.hidden = false;
            announce('当前浏览器的本地翻译接口不可用，未启用云端翻译。', true, 'translation'); return;
        }
        surface.cancelTasks(); const ticket = epoch;
        const controller = new AbortController(); translationController = controller;
        translate.hidden = true; translateHint.hidden = true;
        translate.disabled = true; translate.setAttribute('aria-busy', 'true');
        translationResult.textContent = translateUi('正在准备本地翻译…');
        const translationStartedAt = Date.now();
        let translationOutcome = 'cancelled';
        try {
            const result = await adapter.translateSelection(toolbarDescriptor.translationText ?? toolbarDescriptor.text, {
                signal: controller.signal,
                onProgress: progress => {
                    if (!surface.validSource() || ticket !== epoch || controller.signal.aborted) return;
                    if (progress?.translatedText) translationResult.textContent = progress.translatedText +
                        (progress.complete ? '' : '\n' + translateUi('其余内容正在翻译…'));
                },
                onState: state => {
                    if (!surface.current() || ticket !== epoch) return;
                    if (state.phase === 'downloading') translationResult.textContent =
                        translateUi('浏览器正在准备本地翻译资源：' + Math.round((Number(state.progress) || 0) * 100) + '%（需要时下载）');
                }
            });
            if (surface.validSource() && ticket === epoch) {
                translationResult.textContent = result; translate.textContent = translateUi('重新翻译');
                translationOutcome = 'success';
            }
        } catch (error) {
            if (surface.current() && ticket === epoch && error.code !== 'ABORTED') {
                translationOutcome = 'failed';
                translate.hidden = false; translateHint.hidden = false;
                translate.textContent = translateUi(error.code === 'USER_ACTIVATION_REQUIRED' ? '开启本地翻译' : '重试翻译');
                translationResult.textContent = (error.partialTranslation?.translatedText
                    ? error.partialTranslation.translatedText + '\n' + translateUi('其余内容未完成，可重试。') + '\n' : '') + translateUi(error.code === 'USER_ACTIVATION_REQUIRED'
                    ? '浏览器需要一次点击才能启动本地翻译，请点击“开启本地翻译”。' : '本地翻译失败：' + error.message);
            }
        } finally {
            if (surface.current() && ticket === epoch) void chrome.runtime.sendMessage({
                type: 'ARTICLE_NOTIFICATION', timestamp: Date.now(), pageUrl: effectiveArticlePageUrl(), documentIdentity: contentDocumentIdentity,
                level: translationOutcome === 'failed' ? 'error' : translationOutcome === 'success' ? 'success' : 'info',
                task: { label: '划句翻译', engine: '浏览器本地翻译', models: [], requests: 0,
                    elapsedMs: Math.max(0, Date.now() - translationStartedAt), status: translationOutcome,
                    usageState: 'unavailable' }
            }).catch(() => {});
            if (ticket === epoch) { translationController = null; translate.disabled = false; translate.removeAttribute('aria-busy'); }
        }
    };
    translate.addEventListener('click', runTranslation);

    const note = node('textarea', 'sci-selection-note');
    note.rows = 5; note.maxLength = 4000; note.placeholder = translateUi('写下判断、疑问或后续线索');
    note.setAttribute('aria-label', translateUi('手写备注'));
    const retainedDraft = draftKey && manualAnnotationDrafts.get(draftKey);
    note.value = retainedDraft?.sourceIdentity === manualAnnotationSourceIdentity(existingAnnotation)
        ? retainedDraft.note : savedNote;
    note.addEventListener('input', () => {
        if (!draftKey) return;
        manualAnnotationDrafts.set(draftKey, { note: note.value, sourceIdentity: manualAnnotationSourceIdentity(existingAnnotation) });
    });
    const noteHint = node('p', 'sci-selection-hint', '备注随所选原文保存；未选颜色时使用当前情境第一个类别。');
    const save = button('保存', 'sci-selection-save');
    const noteFooter = node('div', 'sci-selection-note-footer'); noteFooter.append(save);
    if (existingAnnotation) {
        const quote = node('blockquote', 'sci-selection-note-quote'); quote.textContent = existingAnnotation.quote || '';
            quote.setAttribute('translate', 'no');
        const categoryLabel = node('div', 'sci-selection-note-category');
        categoryLabel.textContent = selectedCategory.name || selectedCategory.categoryId;
        panes.note.append(quote, categoryLabel);
        const remove = button('删除标注', 'sci-selection-delete');
        remove.addEventListener('click', async () => {
            if (saving || !surface.validSource()) return;
            saving = true; remove.disabled = true; save.disabled = true;
            try {
                const response = await sendManualMessage({ type: 'ANNOTATION_DELETE',
                    documentId: toolbarDescriptor.documentId, annotationId: existingAnnotation.annotationId });
                // A durable ACK belongs to the document, not the transient editor.
                // Closing/replacing the surface must not leave a deleted mark locally.
                if (currentManualDocument?.documentId !== toolbarDescriptor.documentId ||
                    articleWorkspaceLifecycleGeneration !== workspaceLifecycle ||
                    contentNavigationIdentity() !== navigationIdentity) return;
                manualAnnotationDrafts.delete(draftKey);
                updateCurrentManualRecord(response.record);
                if (surface.current() || currentManualSelectionUi?.descriptor.existingAnnotation?.annotationId ===
                    existingAnnotation.annotationId) closeManualSelectionToolbar();
                restoreManualAnnotations(response.record.annotations); scheduleCurrentArticleArchiveSave();
                showManualStatus('手动标注已删除', 'success');
            } catch (error) { announce('删除失败：' + error.message, true, 'note'); }
            finally { saving = false; remove.disabled = false; save.disabled = false; }
        });
        noteFooter.append(remove);
    }
    const noteSharing = node('div', 'sci-selection-note-sharing-controls');
    panes.note.append(note, noteHint, noteFooter, noteSharing);
    appendManualNoteSharingControls(noteSharing, surface, note, announce, translateUi);
    const prepareAnnotation = () => {
        if (!toolbarDescriptor.pendingAnnotation) return Promise.resolve();
        if (annotationPreparation) return annotationPreparation;
        annotationPreparation = (async () => {
            const resolved = await toolbarDescriptor.prepareAnnotation?.();
            if (!surface.validSource()) throw new Error('页面正文已变化，请重新选择文字');
            if (!resolved?.validation?.valid || !resolved.documentId || !resolved.anchor) {
                throw new Error(resolved?.validation?.message || '标注位置尚未准备好，请稍后重试');
            }
            Object.assign(toolbarDescriptor, resolved, { readOnly: false, pendingAnnotation: false });
            if (!toolbarDescriptor.manualAnalysisModeId) toolbarDescriptor.manualAnalysisModeId = currentManualAnalysisModeId;
            contextSelect.replaceChildren();
            currentManualAnalysisModes.forEach(mode => contextSelect.appendChild(new Option(mode.name, mode.id)));
            contextSelect.value = toolbarDescriptor.manualAnalysisModeId;
            contextSelect.disabled = !currentManualAnalysisModes.length;
            renderCategories();
            announce('', false, 'note');
        })().finally(() => { annotationPreparation = null; });
        return annotationPreparation;
    };
    const persist = async (category, text) => {
        if (saving) return;
        if (!surface.validSource()) { announce('页面正文已变化，请重新选择文字', true, 'note'); return; }
        saving = true; save.disabled = true; contextSelect.disabled = true;
        palette.querySelectorAll('button').forEach(item => { item.disabled = true; });
        try {
            if (toolbarDescriptor.pendingAnnotation) announce('正在准备标注位置，备注已保留…', false, 'note');
            await prepareAnnotation();
            category = category || manualCategoriesForAnalysisMode(toolbarDescriptor.manualAnalysisModeId)[0];
            if (!category) throw new Error('当前情境没有可用高亮类别，请先选择其他情境');
            await saveSelectionSurfaceAnnotations(surface, category, text);
            if (!surface.current()) return;
            selectedCategory = category; savedNote = text;
            if (draftKey && note.value === text) manualAnnotationDrafts.delete(draftKey);
            const categoryLabel = panes.note.querySelector('.sci-selection-note-category');
            if (categoryLabel) categoryLabel.textContent = category.name || category.categoryId;
            palette.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.categoryId === category.categoryId)));
            appendManualNoteSharingControls(noteSharing, surface, note, announce, translateUi);
            announce('已保存', false, 'note');
        } catch (error) { announce('保存失败：' + error.message + '。草稿仍保留，可重试。', true, 'note'); }
        finally {
            saving = false;
            if (surface.current()) {
                save.disabled = false; contextSelect.disabled = !currentManualAnalysisModes.length;
                palette.querySelectorAll('button').forEach(item => { item.disabled = false; });
            }
        }
    };
    save.addEventListener('click', () => {
        const category = selectedCategory || manualCategoriesForAnalysisMode(toolbarDescriptor.manualAnalysisModeId)[0];
        void persist(category, note.value);
    });

    const actions = currentManualSelectionActions.filter(action => action.enabled !== false);
    const actionSelect = node('select', 'sci-selection-action-select');
    actionSelect.setAttribute('aria-label', translateUi('AI 划词动作'));
    actions.forEach(action => actionSelect.appendChild(new Option(action.name, action.id)));
    actionSelect.value = (actions.find(action => action.id === 'explain') || actions[0])?.id || '';
    const promptDetails = node('details', 'sci-selection-prompt-options');
    const promptSummary = node('summary', '', '当前提示词');
    const prompt = node('textarea', 'sci-selection-prompt');
    prompt.setAttribute('aria-label', translateUi('本次临时提示词')); prompt.rows = 4; prompt.maxLength = 3000;
    const drafts = new Map();
    const selectPrompt = () => { prompt.value = drafts.get(actionSelect.value) ?? actions.find(action => action.id === actionSelect.value)?.prompt ?? ''; };
    selectPrompt();
    prompt.addEventListener('input', () => drafts.set(actionSelect.value, prompt.value));
    actionSelect.addEventListener('change', selectPrompt);
    const webLabel = node('label', 'sci-selection-web-label');
    const web = node('input', 'sci-selection-web'); web.type = 'checkbox';
    web.checked = currentManualSelectionWebSearchEnabled;
    web.disabled = !currentManualSelectionWebSearchSupported;
    webLabel.append(web, document.createTextNode(translateUi('允许联网检索')));
    promptDetails.append(promptSummary, prompt,
        node('p', 'sci-selection-hint', '仅用于本次请求。默认提示词请在设置中修改。'), webLabel);
    const aiResult = node('div', 'sci-selection-ai-result', '点击 AI 解读所选文字。');
    aiResult.setAttribute('aria-live', 'polite');
    const runAi = button('AI', 'sci-selection-run-ai', '执行 AI 解读');
    runAi.disabled = !actions.length;
    const cancelAi = button('取消', 'sci-selection-cancel-ai'); cancelAi.hidden = true;
    const aiActions = node('div', 'sci-selection-ai-actions'); aiActions.append(runAi, cancelAi);
    panes.ai.append(actionSelect, promptDetails, aiResult, aiActions);
    const resetTasks = () => {
        translate.disabled = false; translate.removeAttribute('aria-busy');
        runAi.disabled = !actions.length; runAi.removeAttribute('aria-busy'); cancelAi.hidden = true;
        actionSelect.disabled = false; prompt.disabled = false; web.disabled = false;
    };
    cancelAi.addEventListener('click', () => { surface.cancelTasks(); resetTasks(); aiResult.textContent = translateUi('已取消'); });
    runAi.addEventListener('click', async () => {
        if (!surface.validSource()) { announce('页面正文已变化，请重新选择文字', true, 'ai'); return; }
        if (!currentManualSelectionProfileId) { announce('请先在插件设置中配置划词动作模型。', true, 'ai'); return; }
        if (!prompt.value.trim()) { announce('请输入本次提示词。', true, 'ai'); return; }
        surface.cancelTasks(); const ticket = epoch; const id = automaticAnnotationId('selection');
        operationId = id; runAi.disabled = true; runAi.setAttribute('aria-busy', 'true'); cancelAi.hidden = false;
        actionSelect.disabled = true; prompt.disabled = true; web.disabled = true;
        aiResult.textContent = translateUi('正在解读…');
        try {
            const response = await sendManualMessage({
                type: 'LLM_ASK_SELECTION', operationId: id, turnId: id,
                prompt: prompt.value, selectedText: toolbarDescriptor.text,
                profileId: currentManualSelectionProfileId, webSearch: { enabled: web.checked },
                document: { title: document.title, url: navigationIdentity, documentId: toolbarDescriptor.documentId },
                workspaceLifecycle
            }, { isCurrent: () => surface.validSource() && ticket === epoch && operationId === id });
            if (!surface.validSource() || ticket !== epoch) return;
            if (response.operationId !== id || response.message?.status !== 'completed') throw new Error('选区解读未完成，请重试。');
            const blocks = response.message.answerBlocks || [];
            const text = blocks.map(block => String(block.markdown || '')).filter(Boolean).join('\n\n');
            if (!text) throw new Error('模型未返回可显示的结果。');
            // Model output is data, never HTML; links are only from the grounded response below.
            aiResult.textContent = text;
            const receipt = response.webGrounding || response.message.webGrounding;
            if (receipt?.receiptId && Array.isArray(receipt.grounding?.sources)) {
                const links = node('div', 'sci-selection-sources', '联网来源：');
                const seen = new Set();
                for (const source of receipt.grounding.sources.slice(0, 16)) {
                    let url; try { url = new URL(source.url); } catch (_) { continue; }
                    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
                    seen.add(url.href);
                    const link = node('a', ''); link.textContent = String(source.title || url.hostname);
            link.setAttribute('translate', 'no');
                    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
                    links.appendChild(link);
                }
                if (seen.size) aiResult.appendChild(links);
            }
        } catch (error) {
            if (surface.current() && ticket === epoch) aiResult.textContent = translateUi('解读失败：' + error.message);
        } finally {
            void chrome.runtime.sendMessage({ type: 'LLM_CONTROL_OPERATION', operationId: id, command: 'release' }).catch(() => {});
            if (surface.current() && ticket === epoch) { operationId = ''; resetTasks(); }
        }
    });

    const ruleDetails = node('details', 'sci-selection-rule-options');
    ruleDetails.appendChild(node('summary', '', '加入高亮规则'));
    const ruleCategory = node('select', 'sci-selection-rule-category'); ruleCategory.setAttribute('aria-label', translateUi('选择要填入固定短语的高亮规则'));
    const ruleActions = node('div', 'sci-selection-rule-actions');
    const include = button('加入白名单', 'sci-manual-rule-include');
    const exclude = button('加入黑名单', 'sci-manual-rule-exclude');
    for (const [control, type] of [[include, 'include'], [exclude, 'exclude']]) control.addEventListener('click', () => {
        if (!surface.validSource()) { announce('页面正文已变化，请重新选择文字', true); return; }
        void appendManualFixedPhrase(ruleCategory.value, type, toolbarDescriptor, [ruleCategory, include, exclude], { keepOpen: true, isCurrent: surface.validSource });
    });
    ruleActions.append(include, exclude); ruleDetails.append(ruleCategory, ruleActions); panes.addition.appendChild(ruleDetails);
    const abbreviation = appendManualAbbreviationEditor(panes.addition, toolbarDescriptor, { keepOpen: true, isCurrent: surface.validSource });
    abbreviation.hidden = false;
    const rebindAnnotation = !existingAnnotation && currentManualRebindId && manualAnnotationById(currentManualRebindId);
    if (rebindAnnotation) {
        const rebind = button('重新绑定此标注', 'sci-selection-rebind');
        rebind.addEventListener('click', () => { if (surface.validSource()) void reanchorManualAnnotation(rebindAnnotation.annotationId); });
        panes.addition.appendChild(rebind);
    }
    if (currentManualUnresolved.length) {
        const details = node('details', 'sci-selection-unresolved');
        details.appendChild(node('summary', '', '待重新定位 ' + currentManualUnresolved.length));
        const unresolved = appendUnresolvedManualList(details); unresolved.hidden = false; panes.addition.appendChild(details);
    }
    const renderCategories = () => {
        const categories = manualCategoriesForAnalysisMode(toolbarDescriptor.manualAnalysisModeId);
        palette.replaceChildren(); ruleCategory.replaceChildren();
        categories.forEach(category => {
            const dot = button('', 'sci-selection-color', category.name);
            dot.title = category.name; dot.setAttribute('aria-label', category.name);
            dot.dataset.categoryId = category.categoryId;
            dot.style.setProperty('--sci-category-color', category.color);
            dot.setAttribute('aria-pressed', String(selectedCategory?.categoryId === category.categoryId));
            dot.addEventListener('click', () => void persist(category, note.value));
            palette.appendChild(dot); ruleCategory.appendChild(new Option(category.name, category.categoryId));
        });
        include.disabled = exclude.disabled = !categories.length;
        context.title = currentManualAnalysisModes.find(mode => mode.id === contextSelect.value)?.name || '阅读情境';
    };
    contextSelect.addEventListener('change', () => {
        toolbarDescriptor.manualAnalysisModeId = contextSelect.value;
        if (!surface.annotations.length) selectedCategory = null;
        renderCategories(); positionManualFloating(toolbar, toolbarDescriptor.rect);
    });
    function switchMode(mode) {
        if (toolbarDescriptor.readOnly && !toolbarDescriptor.pendingAnnotation && mode !== 'translation') return;
        if (toolbar.dataset.mode !== mode) {
            if (translationController) {
                translationResult.textContent = translateUi('已取消，可重新翻译。');
                translate.hidden = false; translate.textContent = translateUi('重新翻译');
            }
            if (operationId) aiResult.textContent = translateUi('已取消');
            surface.cancelTasks(); resetTasks();
        }
        toolbar.dataset.mode = mode;
        renderModeStatus();
        for (const key of Object.keys(panes)) {
            panes[key].hidden = key !== mode; tabs[key].setAttribute('aria-selected', String(key === mode));
            tabs[key].tabIndex = key === mode ? 0 : -1;
        }
        positionManualFloating(toolbar, toolbarDescriptor.rect);
    }
    rail.addEventListener('keydown', event => {
        const keys = Object.keys(tabs), index = keys.indexOf(event.target.dataset.selectionMode);
        if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 :
            (index + (event.key === 'ArrowDown' ? 1 : -1) + keys.length) % keys.length;
        switchMode(keys[next]); tabs[keys[next]].focus();
    });
    toolbar.addEventListener('keydown', event => { if (globalThis.BrevessInputTools?.isEditingEvent(event)) return; if (event.key === 'Escape') { event.preventDefault(); closeManualSelectionToolbar(); } });
    toolbar.addEventListener('toggle', () => positionManualFloating(toolbar, toolbarDescriptor.rect), true);
    document.documentElement.appendChild(toolbar);
    const selectionInterfaceLanguage=SciLLM.getInterfaceLanguage?.()||llmPresentationState.language||'zh-CN';
    const selectionDefaultMode=/^en(?:-|$)/i.test(selectionInterfaceLanguage)||!/[\p{Script=Latin}]/u.test(String(toolbarDescriptor.text||'').normalize('NFKC'))?'note':'translation';
    renderCategories(); switchMode(rebindAnnotation ? 'addition' : descriptor.openNote ? 'note' : toolbarDescriptor.readOnly&&!toolbarDescriptor.pendingAnnotation ? 'translation' : selectionDefaultMode);
    if (descriptor.llmMark) appendAiFeedbackEditor(panes.ai, descriptor.llmMark);
    (toolbar.dataset.mode==='note' ? note : descriptor.focusModeSelect ? contextToggle : tabs[toolbar.dataset.mode]).focus({ preventScroll: true });
    cancelAfterPaint = scheduleManualAfterPaint(() => {
        if (!surface.current()) return;
        const cleaned = toolbarDescriptor.prepareText?.();
        if (typeof cleaned === 'string') toolbarDescriptor.translationText = cleaned;
        if (toolbarDescriptor.pendingAnnotation) {
            void prepareAnnotation().catch(error => announce(error.message + '；备注草稿仍保留。', true, 'note'));
        }
        if (toolbar.dataset.mode === 'translation' && !toolbarDescriptor.translationSelection) void runTranslation();
        if (selectionEvent?.isTrusted === true && !existingAnnotation && speechController) {
            void speechController.speak({ text: speechText(), event: selectionEvent, automatic: true });
        }
    });
}
/* production:showManualSelectionToolbar:end */

/* production:closeManualSelectionToolbar:start */
function closeManualSelectionToolbar() {
    currentManualSelectionUi?.dispose();
    currentManualSelectionUi = null;
    document.getElementById('sci-manual-toolbar')?.remove();
    currentManualSelection = null;
    manualUiLifecycle.retain({ selection: null });
}
/* production:closeManualSelectionToolbar:end */

/* production:clampManualFloating:start */
function clampManualFloating(element, left, top) {
    const width = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    element.style.maxWidth = `${Math.max(0, width - 16)}px`;
    element.style.left = `${Math.max(8, Math.min(left, width - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(top, window.innerHeight - element.offsetHeight - 8))}px`;
}
/* production:clampManualFloating:end */

/* production:bindManualFloatingDrag:start */
function bindManualFloatingDrag(element, handle) {
    let drag = null;
    const stop = () => {
        const pointerId = drag?.pointerId;
        drag = null;
        handle.style.cursor = 'grab';
        if (pointerId !== undefined && handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    };
    const down = event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault(); event.stopPropagation();
        const rect = element.getBoundingClientRect();
        drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        handle.setPointerCapture?.(event.pointerId); handle.style.cursor = 'grabbing';
    };
    const move = event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        element.dataset.manualPositioned = 'true';
        clampManualFloating(element, drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    };
    const key = event => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!directions[event.key]) return;
        event.preventDefault(); event.stopPropagation();
        const rect = element.getBoundingClientRect(), [x, y] = directions[event.key];
        element.dataset.manualPositioned = 'true';
        clampManualFloating(element, rect.left + x * (event.shiftKey ? 32 : 8), rect.top + y * (event.shiftKey ? 32 : 8));
    };
    const swallow = event => { event.preventDefault(); event.stopPropagation(); };
    const bindings = [['pointerdown', down], ['pointermove', move], ['pointerup', stop],
        ['pointercancel', stop], ['lostpointercapture', stop], ['keydown', key], ['click', swallow]];
    for (const [type, callback] of bindings) handle.addEventListener(type, callback);
    window.addEventListener('blur', stop);
    return () => { stop(); window.removeEventListener('blur', stop);
        for (const [type, callback] of bindings) handle.removeEventListener(type, callback); };
}
/* production:bindManualFloatingDrag:end */

/* production:positionManualFloating:start */
function positionManualFloating(element, rect) {
    if (element.dataset.manualPositioned === 'true') {
        const current = element.getBoundingClientRect();
        clampManualFloating(element, current.left, current.top);
        return;
    }
    const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    element.style.maxWidth = `${Math.max(0, viewportWidth - 16)}px`;
    const width = Math.min(element.offsetWidth, Math.max(0, viewportWidth - 16));
    const height = Math.min(element.offsetHeight, Math.max(0, window.innerHeight - 16));
    const left = Math.max(8, Math.min(
        (rect.left + rect.right - width) / 2,
        viewportWidth - width - 8
    ));
    const preferredTop = rect.bottom + 8;
    const candidateTop = preferredTop + height <= window.innerHeight - 8
        ? preferredTop : Math.max(8, rect.top - height - 8);
    const top = Math.max(8, Math.min(
        candidateTop,
        Math.max(8, window.innerHeight - height - 8)
    ));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
}
/* production:positionManualFloating:end */

/* production:makeManualButton:start */
function makeManualButton(label, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
}
/* production:makeManualButton:end */

/* production:scheduleManualAfterPaint:start */
function scheduleManualAfterPaint(callback) {
    let disposed = false, timer = null;
    // The browser paints the toolbar before source projection or model work.
    if (typeof requestAnimationFrame !== 'function') { callback(); return () => {}; }
    const frame = requestAnimationFrame(() => {
        timer = setTimeout(() => { if (!disposed) callback(); }, 0);
    });
    return () => { disposed = true; cancelAnimationFrame(frame); if (timer !== null) clearTimeout(timer); };
}
/* production:scheduleManualAfterPaint:end */

/* production:manualAnnotationDraftKey:start */
function manualAnnotationDraftKey(documentId, annotationId) {
    return `${documentId}\u0000${annotationId}`;
}
/* production:manualAnnotationDraftKey:end */

/* production:manualAnnotationSourceIdentity:start */
function manualAnnotationSourceIdentity(annotation) {
    return JSON.stringify([annotation?.annotationId, annotation?.quote, annotation?.prefix,
        annotation?.suffix, annotation?.blockFingerprint, annotation?.startOffset,
        annotation?.endOffset, annotation?.pdfAnchor || null]);
}
/* production:manualAnnotationSourceIdentity:end */

/* production:selectionSurfaceExistingAnnotationCurrent:start */
function selectionSurfaceExistingAnnotationCurrent(descriptor) {
    const original = descriptor.existingAnnotation;
    const current = original && manualAnnotationById(original.annotationId);
    if (!current || manualAnnotationSourceIdentity(current) !== manualAnnotationSourceIdentity(original)) return false;
    if (!original.pdfAnchor) return true;
    const native = globalThis.__brevessNativePdfDocument;
    return Number(descriptor.pdfDocumentGeneration) === Number(native?.documentGeneration) &&
        SciLLM.pdfAnchorMatchesDocument?.(original.pdfAnchor, native?.structure?.documentHash || '') === true;
}
/* production:selectionSurfaceExistingAnnotationCurrent:end */

/* production:manualAnnotationById:start */
function manualAnnotationById(annotationId) {
    return currentManualDocument?.record?.annotations?.find(
        annotation => annotation.annotationId === annotationId
    ) || null;
}
/* production:manualAnnotationById:end */

/* production:manualCategoryById:start */
function manualCategoryById(categoryId) {
    return currentManualCategories.find(category => category.categoryId === categoryId) || null;
}
/* production:manualCategoryById:end */

/* production:manualCategoriesForAnalysisMode:start */
function manualCategoriesForAnalysisMode(modeId = currentManualAnalysisModeId) {
    const selectedModeId = String(modeId || '');
    const mode = currentManualAnalysisModes.find(item => item.id === selectedModeId);
    if (!mode) return currentManualCategories;
    const categoriesById = new Map(currentManualCategories.map(category => [
        category.categoryId, category
    ]));
    return mode.categoryIds.map(categoryId => categoriesById.get(categoryId))
        .filter(Boolean);
}
/* production:manualCategoriesForAnalysisMode:end */

/* production:pastelManualColor:start */
function pastelManualColor(color) {
    const value = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color.slice(1) : 'F2D978';
    const channels = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
    const mixed = channels.map(channel => Math.round(channel * 0.42 + 255 * 0.58));
    return `rgb(${mixed.join(', ')})`;
}
/* production:pastelManualColor:end */

/* production:automaticAnnotationId:start */
function automaticAnnotationId(sourceType = 'automatic') {
    return globalThis.crypto?.randomUUID?.() ||
        `${sourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
/* production:automaticAnnotationId:end */

/* production:appendManualAbbreviationEditor:start */
function appendManualAbbreviationEditor(toolbar, descriptor, options = {}) {
    const panel = document.createElement('section');
    panel.className = 'sci-manual-abbreviation-panel';
    panel.hidden = true;

    const heading = document.createElement('strong');
    heading.textContent = '加入本文缩略词表';
    const hint = document.createElement('p');
    hint.textContent = '会随本文工作区保存；稍后可在全文缩写表中导入全局记忆。';
    panel.append(heading, hint);

    const draft = SciLLM.inferSelectedAbbreviationDraft(descriptor?.text || '');
    const fields = document.createElement('div');
    fields.className = 'sci-manual-abbreviation-fields';
    const abbreviationLabel = document.createElement('label');
    abbreviationLabel.textContent = '缩写';
    const abbreviationInput = document.createElement('input');
    abbreviationInput.type = 'text';
    abbreviationInput.maxLength = 30;
    abbreviationInput.value = draft.abbreviation;
    abbreviationInput.placeholder = '例如 TNF';
    abbreviationInput.setAttribute('aria-label', '手动缩写');
    abbreviationLabel.appendChild(abbreviationInput);
    const fullNameLabel = document.createElement('label');
    fullNameLabel.textContent = '全称';
    const fullNameInput = document.createElement('input');
    fullNameInput.type = 'text';
    fullNameInput.maxLength = 240;
    fullNameInput.value = draft.fullName;
    fullNameInput.placeholder = '例如 tumor necrosis factor';
    fullNameInput.setAttribute('aria-label', '手动缩写全称');
    fullNameLabel.appendChild(fullNameInput);
    fields.append(abbreviationLabel, fullNameLabel);
    panel.appendChild(fields);

    const status = document.createElement('span');
    status.className = 'sci-manual-abbreviation-status';
    status.setAttribute('role', 'status');
    const save = makeManualButton('加入缩略词表', 'sci-manual-primary-action');
    save.addEventListener('click', async () => {
        if (options.isCurrent && !options.isCurrent()) return;
        const entry = SciLLM.normalizeUserAbbreviationEntry({
            abbreviation: abbreviationInput.value,
            fullName: fullNameInput.value,
            paragraphId: descriptor?.blockId,
            sourceKey: descriptor?.blockId,
            navigationRevision: currentArticleStructure?.revision
        });
        if (!entry) {
            status.textContent = '请填写有效缩写和完整全称。';
            status.classList.add('is-error');
            (abbreviationInput.value.trim() ? fullNameInput : abbreviationInput).focus();
            return;
        }
        save.disabled = true;
        abbreviationInput.disabled = true;
        fullNameInput.disabled = true;
        status.classList.remove('is-error');
        status.textContent = '正在保存…';
        try {
            await addCurrentArticleAbbreviation(entry);
            if (options.isCurrent && !options.isCurrent()) return;
            showManualStatus(
                `已加入本文缩略词表：${entry.abbreviation} — ${entry.fullName}`,
                'success'
            );
            if (!options.keepOpen) releaseSelectionAfterManualAction();
            else status.textContent = '已保存到本文缩略词表';
        } catch (error) {
            save.disabled = false;
            abbreviationInput.disabled = false;
            fullNameInput.disabled = false;
            status.classList.add('is-error');
            status.textContent = `保存失败：${error.message}`;
        } finally {
            save.disabled = false;
            abbreviationInput.disabled = false;
            fullNameInput.disabled = false;
        }
    });
    const actions = document.createElement('div');
    actions.className = 'sci-manual-abbreviation-actions';
    actions.append(status, save);
    panel.appendChild(actions);
    toolbar.appendChild(panel);
    return panel;
}
/* production:appendManualAbbreviationEditor:end */

/* production:appendManualNoteSharingControls:start */
function appendManualNoteSharingControls(host, surface, note, announce, translateUi = value => value) {
    return; // Store first release: no collaboration UI; persisted fields stay unchanged.
    host.replaceChildren();
    const record = currentManualDocument?.record;
    const annotations = surface.annotations.map(item =>
        record?.annotations?.find(saved => saved.annotationId === item.annotationId &&
            manualAnnotationSourceIdentity(saved) === manualAnnotationSourceIdentity(item))).filter(Boolean);
    if (!annotations.length) {
        host.textContent = translateUi('新备注默认仅个人可见；保存后可逐条设置可见性。');
        return;
    }
    for (const annotation of annotations) {
        const request = buildManualNoteSharingRequest(record, annotation, currentManualDocument?.documentHash);
        const sourceIdentity = manualAnnotationSourceIdentity(annotation);
        const control = document.createElement('button');
        control.type = 'button'; control.className = 'sci-selection-note-sharing';
        control.dataset.annotationId = annotation.annotationId;
        const prefix = annotations.length > 1 ? `标注 ${annotations.indexOf(annotation) + 1} · ` : '';
        const renderState = state => {
            if (!control.isConnected) return;
            const label = ({ private: '仅个人可见', group: '课题组内共享', public: '公开' })[state?.visibility] || '仅个人可见';
            const unverified = state?.resourceId && state.verified !== true;
            control.textContent = translateUi(unverified ? `${prefix}可见性（点击核验）` : `${prefix}可见性：${label}`);
            control.title = translateUi(unverified ? `上次记录：${label}；当前权限需服务核验` : label);
            control.setAttribute('aria-label', translateUi(`${prefix}设置高亮备注可见性${unverified ? '，点击核验' : `，当前${label}`}`));
        };
        const refresh = () => Promise.resolve(globalThis.BrevessSharing?.getLocalState?.(request.localKey))
            .then(renderState).catch(() => { control.textContent = translateUi(`${prefix}设置可见性`); });
        control.textContent = translateUi(`${prefix}可见性：仅个人可见`);
        control.addEventListener('click', async event => {
            if (!event.isTrusted) return;
            if (!surface.validSource()) { announce('页面正文已变化，请重新打开标注', true, 'note'); return; }
            const saved = manualAnnotationById(annotation.annotationId);
            if (!saved || manualAnnotationSourceIdentity(saved) !== sourceIdentity) {
                announce('标注来源已变化，请重新打开标注', true, 'note'); return;
            }
            // Match the persisted annotation's Unicode form without trimming edits or rewriting either value.
            if (String(note.value ?? '').normalize('NFKC') !== String(saved.note ?? '').normalize('NFKC')) {
                announce('请先保存备注，再设置可见性；当前编辑内容仍保留。', true, 'note'); return;
            }
            if (!globalThis.BrevessSharing?.open) { announce('共享模块尚未就绪，请重新打开页面', true, 'note'); return; }
            control.disabled = true;
            try {
                await globalThis.BrevessSharing.open(buildManualNoteSharingRequest(
                    currentManualDocument.record, saved, currentManualDocument.documentHash));
                await refresh();
            } catch (_) { announce('无法打开共享设置；备注仍保存在本机。', true, 'note'); }
            finally { control.disabled = false; }
        });
        host.appendChild(control); void refresh();
    }
}
/* production:appendManualNoteSharingControls:end */
 class NativeHighlighter { constructor(){this.matchCounts={};} /* production:buildRegexes:start */
    buildRegexes(categories) {
        const regexes = [];
        
        Object.entries(categories).forEach(([key, category]) => {
            const excludeRegexes = (Array.isArray(category.excludePatterns)
                ? category.excludePatterns : [])
                .map(pattern => {
                    try { return new RegExp(pattern, 'gi'); } catch (_) { return null; }
                })
                .filter(Boolean);
            if (category.isRegex) {
                // 正则表达式模式
                const regex = new RegExp(category.patterns[0], 'gi');
                regexes.push({
                    regex: regex,
                    category: key,
                    color: category.color,
                    name: category.name,
                    originalPattern: category.patterns[0],
                    isRegex: true,
                    excludeRegexes
                });
            } else {
                // 简单列表模式
                category.patterns.forEach(pattern => {
                    // 转义特殊字符，但保留.*用于通配
                    let regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
                    regexPattern = regexPattern.replace(/\\\.\\\*/g, '.*?'); // 恢复.*的通配功能
                    
                    // 添加单词边界（忽略大小写）
                    const regex = new RegExp(`\\b${regexPattern}\\b`, 'gi');
                    
                    regexes.push({
                        regex: regex,
                        category: key,
                        color: category.color,
                        name: category.name,
                        originalPattern: pattern,
                        isRegex: false,
                        excludeRegexes
                    });
                });
            }
        });
        
        return regexes;
    }
/* production:buildRegexes:end */

/* production:findMatches:start */
    findMatches(text, regexes, mode) {
        const matches = [];
        
        regexes.forEach(({
            regex, category, color, name, originalPattern, excludeRegexes = []
        }) => {
            const excludedRanges = [];
            excludeRegexes.forEach(excludeRegex => {
                excludeRegex.lastIndex = 0;
                let excluded;
                while ((excluded = excludeRegex.exec(text)) !== null) {
                    if (!excluded[0]) {
                        excludeRegex.lastIndex = Math.max(
                            excludeRegex.lastIndex + 1, excluded.index + 1
                        );
                        continue;
                    }
                    excludedRanges.push({
                        start: excluded.index,
                        end: excluded.index + excluded[0].length
                    });
                }
            });
            regex.lastIndex = 0; // 重置正则状态
            let match;
            
            while ((match = regex.exec(text)) !== null) {
                const matchedText = match[0];
                if (!matchedText) { regex.lastIndex = match.index + 1; continue; }
                const startIndex = match.index;
                const endIndex = startIndex + matchedText.length;
                
                // 如果是句子模式，扩展到整个句子
                let highlightStart = startIndex;
                let highlightEnd = endIndex;
                
                if (mode === 'sentence') {
                    const bounds = SciLLM.findScientificSentenceBounds(text, startIndex, endIndex);
                    highlightStart = bounds.start;
                    highlightEnd = bounds.end;
                }
                if (excludedRanges.some(range =>
                    range.start < highlightEnd && range.end > highlightStart
                )) {
                    continue;
                }
                
                matches.push({
                    start: highlightStart,
                    end: highlightEnd,
                    color: color,
                    category: category,
                    name: name,
                    matchedText: text.substring(highlightStart, highlightEnd),
                    matchedKeyword: matchedText, // 实际匹配到的关键词
                    originalPattern: originalPattern
                });
                
                // 增加计数
                if (!this.matchCounts[category]) {
                    this.matchCounts[category] = 0;
                }
                this.matchCounts[category]++;
            }
        });
        
        // 按位置排序并合并重叠区域
        matches.sort((a, b) => a.start - b.start);
        return this.mergeOverlappingMatches(matches).map(item => ({
            ...item,
            matchedText: text.substring(item.start, item.end)
        }));
    }
/* production:findMatches:end */

/* production:mergeOverlappingMatches:start */
    mergeOverlappingMatches(matches) {
        if (matches.length === 0) return matches;
        
        const merged = [];
        let current = matches[0];
        
        for (let i = 1; i < matches.length; i++) {
            const next = matches[i];
            
            if (next.start <= current.end) {
                // 重叠，扩展当前匹配（保留第一个匹配的颜色和信息）
                if (next.end > current.end) {
                    current.end = next.end;
                }
            } else {
                merged.push(current);
                current = next;
            }
        }
        merged.push(current);
        
        return merged;
    }
/* production:mergeOverlappingMatches:end */

/* production:createHighlightSpan:start */
    createHighlightSpan(match, mode) {
        const span = document.createElement('span');
        span.className = 'sci-highlight';
        span.dataset.highlightMode = mode;
        span.dataset.analysisModeId = this.activeAnalysisModeId || 'regex-default';
        span.dataset.source = 'regex';
        span.dataset.categoryId = match.category;
        span.dataset.categoryName = match.name;
        span.setAttribute('data-category', match.category);
        span.setAttribute('data-category-name', match.name);
        span.setAttribute('data-matched-keyword', match.matchedKeyword);
        span.style.borderBottomColor = match.color;
        span.style.color = '#000';
        span.style.padding = '2px 4px';
        span.style.borderRadius = '3px';
        span.style.cursor = 'help';
        span.style.transition = 'all 0.2s';
        span.style.position = 'relative';
        span.tabIndex = 0;
        span.setAttribute('role', 'button');
        span.setAttribute(
            'aria-label',
            `${match.name}：${match.matchedText || match.matchedKeyword || ''}。按回车可修改类别或备注`
        );
        const tooltipText = mode === 'sentence'
            ? `${match.name}\n匹配词：${match.matchedKeyword}`
            : match.name;
        span.setAttribute('title', tooltipText);
        span.addEventListener('mouseenter', event => {
            event.target.style.transform = 'scale(1.02)';
            event.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
            event.target.style.zIndex = '1000';
            this.showTooltip(event.target, match);
        });
        span.addEventListener('mouseleave', event => {
            event.target.style.transform = 'scale(1)';
            event.target.style.boxShadow = 'none';
            event.target.style.zIndex = 'auto';
            this.hideTooltip();
        });
        const openEditor = async event => {
            event.preventDefault();
            event.stopPropagation();
            const dismissalRevision = manualSelectionDismissalRevision;
            const manualMark = await ensureAutomaticHighlightAnnotation(
                span, { sourceType: 'regex', match }
            );
            if (manualMark && dismissalRevision === manualSelectionDismissalRevision) {
                showHighlightContextPopover(manualMark);
            }
        };
        span.addEventListener('click', event => { void openEditor(event); });
        span.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            void openEditor(event);
        });
        return span;
    }
/* production:createHighlightSpan:end */

/* production:showTooltip:start */
    showTooltip(element, match) {
        // 移除已存在的tooltip
        this.hideTooltip();
        
        const tooltip = document.createElement('div');
        tooltip.id = 'sci-highlight-tooltip';
        tooltip.style.cssText = `
            position: absolute;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.4;
            z-index: 10000;
            pointer-events: none;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;
        
        // 设置内容
        const content = `
            <div style="font-weight: 600; margin-bottom: 4px; color: ${match.color};">
                📋 ${match.name}
            </div>
            <div style="font-size: 11px; opacity: 0.9;">
                匹配词：<strong>${match.matchedKeyword}</strong>
            </div>
        `;
        tooltip.replaceChildren(...this.createTooltipContent(element, match));
        
        document.body.appendChild(tooltip);
        
        // 计算位置
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let top = rect.bottom + window.scrollY + 5;
        let left = rect.left + window.scrollX + (rect.width / 2) - (tooltipRect.width / 2);
        
        // 确保不超出视口
        if (left < 0) left = 10;
        if (left + tooltipRect.width > window.innerWidth) {
            left = window.innerWidth - tooltipRect.width - 10;
        }
        
        // 如果tooltip会超出底部，显示在上方
        if (top + tooltipRect.height > window.innerHeight + window.scrollY) {
            top = rect.top + window.scrollY - tooltipRect.height - 5;
        }
        
        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
        
        // 添加淡入动画
        tooltip.style.opacity = '0';
        setTimeout(() => {
            tooltip.style.transition = 'opacity 0.2s';
            tooltip.style.opacity = '1';
        }, 10);
    }
/* production:showTooltip:end */

/* production:createTooltipContent:start */
    createTooltipContent(element, match = {}) {
        const manualMark = element?.matches?.('.sci-manual-highlight')
            ? element : element?.closest?.('.sci-manual-highlight');
        const annotation = manualMark
            ? manualAnnotationById(manualMark.dataset.annotationId) : null;
        const categoryName = annotation?.categorySnapshot?.name ||
            match.name || element?.dataset?.categoryName || '未分类';
        const categoryColor = annotation?.categorySnapshot?.color ||
            match.color || element?.dataset?.categoryColor || '#F2D978';
        const heading = document.createElement('div');
        heading.style.cssText =
            `font-weight:600;margin-bottom:4px;color:${categoryColor};`;
        heading.textContent = categoryName;
        const tooltipCategoryId = annotation?.categoryId || match.category || element?.dataset?.categoryId;
        const builtinTooltipName = SciLLM.getBuiltinCatalog?.('zh-CN')?.categories?.[tooltipCategoryId]?.name;
        const hasAuthoredCategoryName = annotation?.categorySnapshot?.name || match.name || element?.dataset?.categoryName;
        if (hasAuthoredCategoryName && (!builtinTooltipName || builtinTooltipName.normalize('NFKC') !== categoryName.normalize('NFKC'))) {
            heading.setAttribute('translate', 'no');
        }
        const children = [heading];
        const matchedKeyword = String(
            match.matchedKeyword || annotation?.sourceQuery || ''
        ).trim();
        if (matchedKeyword) {
            const detail = document.createElement('div');
            detail.style.cssText = 'font-size:11px;opacity:.9;';
            detail.textContent = annotation?.sourceType === 'semantic'
                ? `检索意图：${matchedKeyword}` : `匹配词：${matchedKeyword}`;
            children.push(detail);
        }
        if (String(annotation?.note || '').trim()) {
            const note = document.createElement('div');
            note.style.cssText =
                'margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.24);font-size:11px;';
            note.textContent = `备注：${annotation.note}`;
            children.push(note);
        }
        return children;
    }
/* production:createTooltipContent:end */

/* production:hideTooltip:start */
    hideTooltip() {
        const tooltip = document.getElementById('sci-highlight-tooltip');
        if (tooltip) {
            tooltip.remove();
        }
    }
/* production:hideTooltip:end */ }
 return {open:showManualSelectionToolbar,close:closeManualSelectionToolbar,pastel:pastelManualColor,
  highlighter:new NativeHighlighter(),setMode(id){currentManualAnalysisModeId=id;},
  reset(){closeManualSelectionToolbar();manualAnnotationDrafts.clear();}};
};
