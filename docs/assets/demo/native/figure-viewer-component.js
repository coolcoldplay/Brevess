/* Exact production figure viewer with an in-memory website backend. */
window.BVCreateFigureViewer=function(env){
 const {document,window,SciLLM,getFigureViewerInventory,loadSharedFigureOriginalResource,promoteSavedFigureOriginalDisplay,bindAnnotations,publishFigureImageViewerState,bodyFigureAnnotationLayers}=env;
 const FIGURE_IMAGE_VIEWER_ID='sci-figure-image-viewer';
 let figureImageViewerGeneration=0,figureImageViewerObjectUrl='',figureImageViewerPointerCleanup=null,figureImageViewerMagnifierCleanup=null,figureImageViewerAnnotationCleanup=null,figureImageViewerViewportCleanup=null,figureImageViewerKeyHandler=null;
 const findFigureAnalysisTarget=id=>getFigureViewerInventory().find(f=>f.figureId===id);
 const figureViewerDisplayTitle=figure=>figure.figureLabel+' · '+figure.title;
 const adoptFigureViewerAnalysisSource=async()=>[],figureImageDiagnosticCode=error=>error.message;
 const bindFigureViewerAnnotations=async(...args)=>{const editor=await bindAnnotations(...args);figureImageViewerAnnotationCleanup=()=>editor?.destroy();};
 /* production:showFigureImageViewer:start */
async function showFigureImageViewer(figureId, {
    captionVisible = false,
    navigationMode = ''
} = {}) {
    const figure = findFigureAnalysisTarget(figureId);
    if (!figure) return { success: false, code: 'FIGURE_NOT_FOUND' };
    const originalImages = Array.from(figure.imageElements || []).map((image, imageIndex) => ({ image, imageIndex,
        sourceIdentity: SciLLM.figureOriginalDisplaySourceIdentity(image) }));
    closeFigureImageViewer({ notify: false });
    const generation = figureImageViewerGeneration;

    const viewer = document.createElement('section');
    viewer.id = FIGURE_IMAGE_VIEWER_ID;
    viewer.dataset.figureId = figure.figureId || figureId;
    viewer.dataset.loading = 'true';
    viewer.dataset.captionVisible = String(captionVisible === true);
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', `${figure.figureLabel || figureId} 高清原图`);

    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = figureViewerDisplayTitle(figure);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sci-figure-viewer-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭高清原图');
    header.append(title, close);

    const canvas = document.createElement('div');
    canvas.className = 'sci-figure-viewer-canvas';
    canvas.tabIndex = 0;
    const stage = document.createElement('div');
    stage.className = 'sci-figure-viewer-stage';
    const loading = document.createElement('p');
    loading.className = 'sci-figure-viewer-loading';
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-live', 'polite');
    loading.textContent = `已触发查看 · 正在加载 ${figure.figureLabel || figureId} 高清原图…`;
    stage.appendChild(loading);
    canvas.appendChild(stage);

    const image = document.createElement('img');
    image.alt = figure.figureLabel || figureId;
    image.draggable = false;
    const controls = document.createElement('div');
    controls.className = 'sci-figure-viewer-controls';
    controls.hidden = true;
    const imageControls = document.createElement('div');
    imageControls.className = 'sci-figure-viewer-header-controls'; imageControls.hidden = true;
    header.insertBefore(imageControls, close);
    let scale = 1;
    const label = document.createElement('span');
    label.setAttribute('aria-live', 'polite');
    const qualityLabel = document.createElement('span');
    qualityLabel.className = 'sci-figure-viewer-quality';
    const revealLoadedImage = () => {
        if (generation !== figureImageViewerGeneration) return;
        viewer.dataset.loading = 'false';
        stage.replaceChildren(image);
        controls.hidden = false;
        imageControls.hidden = false;
        applyScale(1);
    };
    image.addEventListener('load', revealLoadedImage);
    const applyScale = next => {
        scale = Math.min(4, Math.max(.25, next));
        const overflowScale = Math.max(1, scale);
        stage.style.width = `${overflowScale * 100}%`;
        stage.style.height = `${overflowScale * 100}%`;
        image.style.maxWidth = `${100 / overflowScale}%`;
        image.style.maxHeight = `${100 / overflowScale}%`;
        image.style.transform = `scale(${scale})`;
        label.textContent = `${Math.round(scale * 100)}%`;
    };
    const makeControl = (text, ariaLabel, handler) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.setAttribute('aria-label', ariaLabel);
        button.addEventListener('click', handler);
        return button;
    };
    const fitControl = makeControl('适配窗口', '使原图适配窗口', () => {
        applyScale(1);
        canvas.scrollTo({ left: 0, top: 0 });
    });
    const captionControl = makeControl(
        captionVisible ? '隐藏图注' : '查看图注',
        captionVisible ? '隐藏当前 Figure 图注' : '查看当前 Figure 图注',
        () => {
            const visible = viewer.dataset.captionVisible !== 'true';
            viewer.dataset.captionVisible = String(visible);
            captionControl.textContent = visible ? '隐藏图注' : '查看图注';
            captionControl.setAttribute(
                'aria-label',
                visible ? '隐藏当前 Figure 图注' : '查看当前 Figure 图注'
            );
            captionControl.setAttribute('aria-pressed', String(visible));
            publishFigureImageViewerState(getFigureImageViewerState());
        }
    );
    captionControl.classList.add('sci-figure-viewer-caption-toggle');
    captionControl.setAttribute('aria-pressed', String(captionVisible === true));
    imageControls.append(
        makeControl('−', '缩小原图', () => applyScale(scale - .25)),
        label,
        makeControl('+', '放大原图', () => applyScale(scale + .25)),
        fitControl,
        captionControl,
        qualityLabel
    );

    figureImageViewerMagnifierCleanup = bindFigureViewerMagnifier(viewer, image, controls);
    figureImageViewerPointerCleanup = bindFigureViewerPointerControls(canvas, image, () => scale, applyScale);

    figureImageViewerKeyHandler = event => {
        if (globalThis.BrevessInputTools?.isEditingEvent(event)) return;
        if (event.target.closest?.('input,textarea,[contenteditable="true"]')) return;
        const direction = {
            ArrowLeft: 'previous',
            ArrowRight: 'next',
            ArrowUp: 'first',
            ArrowDown: 'last'
        }[event.key];
        const figureNumber = /^[0-9]$/.test(event.key)
            ? (event.key === '0' ? 10 : Number(event.key)) : 0;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeFigureImageViewer();
            return;
        }
        if (!direction && !figureNumber) return;
        event.preventDefault();
        event.stopPropagation();
        if (figureNumber) {
            void navigateFigureImageViewer('', figureNumber);
            return;
        }
        const targetId = adjacentFigureViewerId(figureId, direction);
        if (targetId && targetId !== figureId) {
            void showFigureImageViewer(targetId, {
                captionVisible: viewer.dataset.captionVisible === 'true',
                navigationMode: 'direction'
            });
        }
    };
    document.addEventListener('keydown', figureImageViewerKeyHandler, true);
    viewer.addEventListener('click', event => {
        if (event.target === viewer) closeFigureImageViewer();
    });
    close.addEventListener('click', closeFigureImageViewer);
    viewer.append(header, canvas, controls);
    document.documentElement.appendChild(viewer);
    figureImageViewerViewportCleanup = SciLLM.bindFigureViewerViewport(viewer);
    publishFigureImageViewerState({
        open: true,
        figureId: figure.figureId || figureId,
        loading: true,
        captionVisible: viewer.dataset.captionVisible === 'true',
        navigationMode
    });
    close.focus({ preventScroll: true });

    const loaded = await loadSharedFigureOriginalResource(figure);
    const { sources, resource, cacheMode } = loaded;
    if (!loaded.current() || generation !== figureImageViewerGeneration) {
        return { success: false, code: 'VIEWER_SUPERSEDED' };
    }
    if (!sources.length) {
        viewer.dataset.loading = 'false';
        loading.className = 'sci-figure-viewer-error';
        loading.textContent = '没有找到可用的 Figure 图片地址。';
        return { success: false, code: 'IMAGE_NOT_FOUND' };
    }

    if (!loaded.current() || generation !== figureImageViewerGeneration) {
        return { success: false, code: 'VIEWER_SUPERSEDED' };
    }
    if (resource?.bytes?.length) {
        const blob = new Blob([resource.bytes], {
            type: resource.contentType || 'application/octet-stream'
        });
        figureImageViewerObjectUrl = URL.createObjectURL(blob);
        image.src = figureImageViewerObjectUrl;
        const annotationStatus = makeControl('正在准备标注…', '准备图片标注', () => { void prepareAnnotations(); });
        annotationStatus.disabled = true; controls.append(annotationStatus);
        const prepareAnnotations = async () => {
            annotationStatus.disabled = true;
            try {
                await image.decode();
                await bindFigureViewerAnnotations(viewer, image, canvas, controls, figure, resource, originalImages);
                annotationStatus.remove();
            } catch (error) {
                if (!viewer.isConnected) return;
                annotationStatus.disabled = false; annotationStatus.textContent = '重试加载标注';
                annotationStatus.title = error?.message || '标注暂不可用，原图仍可查看。';
            }
        };
        void prepareAnnotations();
        qualityLabel.textContent = [
            resource.pixelWidth && resource.pixelHeight
                ? `${resource.pixelWidth} × ${resource.pixelHeight}` : '',
            resource.workspaceStored ? '本地文献原图' : resource.cacheStored ? (resource.cacheHit ? '本地缓存' : '已自动缓存') :
                (cacheMode === 'read-write' ? '缓存未保存' : '')
        ].filter(Boolean).join(' · ');
        const bodyPromoted = await promoteSavedFigureOriginalDisplay(figure, resource, originalImages, { allowTransient: true }).catch(() => false);
        if (!loaded.current() || generation !== figureImageViewerGeneration) return { success: false, code: 'VIEWER_SUPERSEDED' };
        const analysisSourceAdopted = await adoptFigureViewerAnalysisSource(
            figure, resource
        ).then(images => Boolean(images?.length)).catch(error => {
            console.warn('Brevess：原图已显示，但未能复用为解图来源',
                figureImageDiagnosticCode(error));
            return false;
        });
        return {
            success: true,
            open: true,
            figureId,
            sourceUrl: resource.sourceUrl,
            pixelWidth: resource.pixelWidth,
            pixelHeight: resource.pixelHeight,
            cacheHit: resource.cacheHit === true,
            cacheStored: resource.cacheStored === true,
            bodyPromoted,
            analysisSourceAdopted,
            captionVisible: viewer.dataset.captionVisible === 'true'
        };
    }

    let sourceIndex = 0;
    image.addEventListener('error', () => {
        sourceIndex += 1;
        if (sourceIndex < sources.length) {
            image.src = sources[sourceIndex];
            return;
        }
        const failure = document.createElement('p');
        failure.className = 'sci-figure-viewer-error';
        failure.textContent = '高清原图加载失败；出版社可能要求在正文会话中直接读取。';
        viewer.dataset.loading = 'false';
        stage.replaceChildren(failure);
        controls.hidden = true;
    });
    image.src = sources[sourceIndex];
    return {
        success: true,
        open: true,
        figureId,
        fallback: true,
        captionVisible: viewer.dataset.captionVisible === 'true'
    };
}
/* production:showFigureImageViewer:end */

/* production:closeFigureImageViewer:start */
function closeFigureImageViewer({ notify = true } = {}) {
    const previous = getFigureImageViewerState();
    figureImageViewerGeneration += 1;
    figureImageViewerPointerCleanup?.();
    figureImageViewerPointerCleanup = null;
    figureImageViewerMagnifierCleanup?.();
    figureImageViewerMagnifierCleanup = null;
    figureImageViewerAnnotationCleanup?.();
    figureImageViewerAnnotationCleanup = null;
    document.getElementById(FIGURE_IMAGE_VIEWER_ID)?.remove();
    for (const layer of bodyFigureAnnotationLayers.values()) layer.refresh();
    figureImageViewerViewportCleanup?.();
    figureImageViewerViewportCleanup = null;
    if (figureImageViewerObjectUrl) {
        URL.revokeObjectURL(figureImageViewerObjectUrl);
        figureImageViewerObjectUrl = '';
    }
    if (figureImageViewerKeyHandler) {
        document.removeEventListener('keydown', figureImageViewerKeyHandler, true);
        figureImageViewerKeyHandler = null;
    }
    if (notify && previous.open) {
        publishFigureImageViewerState({
            open: false,
            figureId: previous.figureId,
            loading: false
        });
    }
    return { success: true, open: false, figureId: '' };
}
/* production:closeFigureImageViewer:end */

/* production:getFigureImageViewerState:start */
function getFigureImageViewerState() {
    const viewer = document.getElementById(FIGURE_IMAGE_VIEWER_ID);
    return {
        success: true,
        open: Boolean(viewer),
        figureId: String(viewer?.dataset?.figureId || ''),
        loading: viewer?.dataset?.loading === 'true',
        captionVisible: viewer?.dataset?.captionVisible === 'true'
    };
}
/* production:getFigureImageViewerState:end */

/* production:adjacentFigureViewerId:start */
function adjacentFigureViewerId(figureId, direction) {
    const figures = getFigureViewerInventory();
    if (!figures.length) return '';
    const foundIndex = figures.findIndex(item => item.figureId === figureId);
    const currentIndex = foundIndex >= 0 ? foundIndex : 0;
    if (direction === 'first') return figures[0].figureId;
    if (direction === 'last') return figures.at(-1).figureId;
    const offset = direction === 'previous' ? -1 : 1;
    return figures[(currentIndex + offset + figures.length) % figures.length].figureId;
}
/* production:adjacentFigureViewerId:end */

/* production:navigateFigureImageViewer:start */
async function navigateFigureImageViewer(direction, figureNumber = 0) {
    const allowedDirections = new Set(['previous', 'next', 'first', 'last']);
    const viewerState = getFigureImageViewerState();
    if (!viewerState.open) {
        return { ...viewerState, success: false, code: 'VIEWER_NOT_OPEN' };
    }
    const requestedFigureNumber = Number(figureNumber);
    let targetId = '';
    if (Number.isInteger(requestedFigureNumber) && requestedFigureNumber > 0) {
        const requestedFigure = getFigureViewerInventory().find(item =>
            item.isSupplemental !== true &&
            Number(item.figureNumber) === requestedFigureNumber
        );
        if (!requestedFigure) {
            return {
                ...viewerState,
                success: false,
                code: 'FIGURE_NOT_FOUND',
                requestedFigureNumber
            };
        }
        targetId = requestedFigure.figureId;
    } else if (!allowedDirections.has(direction)) {
        return { ...viewerState, success: false, code: 'INVALID_DIRECTION' };
    } else {
        targetId = adjacentFigureViewerId(viewerState.figureId, direction);
    }
    if (!targetId || targetId === viewerState.figureId) return viewerState;
    return showFigureImageViewer(targetId, {
        captionVisible: viewerState.captionVisible === true,
        navigationMode: requestedFigureNumber > 0 ? 'number' : 'direction'
    });
}
/* production:navigateFigureImageViewer:end */

/* production:bindFigureViewerPointerControls:start */
function bindFigureViewerPointerControls(canvas, image, getScale, applyScale) {
    let drag = null, dragFrame = 0, dragPoint = null, zoomFrame = 0, zoomPoint = null, zoomDelta = 0;
    const paintDrag = () => {
        dragFrame = 0;
        if (!drag || !dragPoint) return;
        canvas.scrollLeft = drag.left - (dragPoint.x - drag.x);
        canvas.scrollTop = drag.top - (dragPoint.y - drag.y);
    };
    const stop = () => {
        if (dragFrame) { window.cancelAnimationFrame(dragFrame); paintDrag(); }
        const pointerId = drag?.pointerId;
        drag = null;
        dragPoint = null;
        canvas.classList.remove('is-dragging');
        if (pointerId !== undefined && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    };
    const down = event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault();
        if (zoomFrame) { window.cancelAnimationFrame(zoomFrame); paintZoom(); }
        drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
        canvas.classList.add('is-dragging');
        canvas.setPointerCapture?.(event.pointerId);
    };
    const move = event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!(event.buttons & 1)) { stop(); return; }
        dragPoint = { x: event.clientX, y: event.clientY };
        if (!dragFrame) dragFrame = window.requestAnimationFrame(paintDrag);
    };
    const paintZoom = () => {
        zoomFrame = 0;
        const point = zoomPoint, delta = zoomDelta;
        zoomPoint = null; zoomDelta = 0;
        if (!point || !image.isConnected) return;
        const before = image.getBoundingClientRect();
        if (!before.width || !before.height) return;
        const x = (point.x - before.left) / before.width;
        const y = (point.y - before.top) / before.height;
        applyScale(getScale() * Math.exp(-Math.max(-500, Math.min(500, delta)) * .002));
        const after = image.getBoundingClientRect();
        canvas.scrollLeft += after.left + x * after.width - point.x;
        canvas.scrollTop += after.top + y * after.height - point.y;
    };
    const wheel = event => {
        if (!image.isConnected || !image.naturalWidth) return;
        event.preventDefault(); stop();
        zoomPoint = { x: event.clientX, y: event.clientY };
        zoomDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
        if (!zoomFrame) zoomFrame = window.requestAnimationFrame(paintZoom);
    };
    const bindings = [['pointerdown', down], ['pointermove', move], ['pointerup', stop], ['pointercancel', stop], ['lostpointercapture', stop], ['wheel', wheel]];
    for (const [type, handler] of bindings) canvas.addEventListener(type, handler, { passive: false });
    window.addEventListener('blur', stop);
    return () => {
        stop();
        if (zoomFrame) window.cancelAnimationFrame(zoomFrame);
        zoomFrame = 0; zoomPoint = null; zoomDelta = 0;
        for (const [type, handler] of bindings) canvas.removeEventListener(type, handler);
        window.removeEventListener('blur', stop);
    };
}
/* production:bindFigureViewerPointerControls:end */

/* production:bindFigureViewerMagnifier:start */
function bindFigureViewerMagnifier(viewer, image, controls) {
    let enabled = false;
    const lens = SciLLM.createFigureMagnifier?.({ document,
        isActive: () => enabled && viewer.isConnected,
        acceptImage: candidate => candidate === image });
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'sci-figure-annotation-icon'; button.dataset.figureViewerMagnifier = '';
    button.append(SciLLM.figureAnnotationToolIcon(document, 'magnifier')); button.setAttribute('aria-pressed', 'false');
    button.title = '开启局部放大镜';
    button.setAttribute('aria-label', '开启局部放大镜');
    button.addEventListener('click', () => {
        enabled = !enabled; button.setAttribute('aria-pressed', String(enabled));
        button.setAttribute('aria-label', enabled ? '关闭局部放大镜' : '开启局部放大镜');
        button.title = enabled ? '关闭局部放大镜' : '开启局部放大镜';
        if (!enabled) lens?.hide();
    });
    controls.appendChild(button);
    return () => lens?.destroy();
}
/* production:bindFigureViewerMagnifier:end */
 return {open:showFigureImageViewer,close:closeFigureImageViewer,state:getFigureImageViewerState};
};
