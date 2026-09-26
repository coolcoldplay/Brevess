// The only automatically loaded page code. Keep article extraction, annotations,
// model requests and the full reader behind the user's semantic-find shortcut.
(function attachSemanticFindShortcut() {
    if (globalThis.__brevessSemanticFindShortcut) return;
    let shortcutKey = '';
    globalThis.__brevessSemanticFindShortcut = { get shortcutKey() { return shortcutKey; } };
    let loading = false;
    let settingsSequence = 0;
    let failureNotice = null;
    async function refreshShortcut() {
        const sequence = ++settingsSequence;
        try {
            const response = await chrome.runtime.sendMessage({ type: 'SEMANTIC_FIND_GET_SHORTCUT' });
            if (sequence === settingsSequence && response?.success) {
                shortcutKey = String(response.key || '').normalize('NFKC').trim().toUpperCase();
            }
        } catch (_) { /* An extension reload requires the article to be refreshed. */ }
    }
    void refreshShortcut();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.sciLlmSettingsV2) void refreshShortcut();
    });
    function showFailure() {
        failureNotice?.remove();
        const notice = document.createElement('div');
        notice.dataset.sciPluginUi = 'true';
        notice.setAttribute('role', 'alert');
        notice.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#fff;color:#222;border:1px solid #555;padding:12px;font:14px/1.5 sans-serif;max-width:320px';
        notice.textContent = '语义检索暂时无法启动，请刷新页面后重试。';
        const close = document.createElement('button');
        close.textContent = '×';
        close.setAttribute('aria-label', '关闭');
        close.addEventListener('click', () => notice.remove());
        notice.append(close);
        document.documentElement.append(notice);
        failureNotice = notice;
    }
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') failureNotice?.remove();
        // Once loaded, the reader owns key handling, including Enter and Escape.
        if (globalThis.__brevessSemanticFind || event.defaultPrevented ||
            event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.composedPath?.()[0] || event.target;
        if (target instanceof Element && target.closest(
            'input,textarea,select,option,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog'
        )) return;
        if (!shortcutKey || String(event.key || '').normalize('NFKC').toUpperCase() !== shortcutKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (loading) return;
        loading = true;
        failureNotice?.remove();
        chrome.runtime.sendMessage({ type: 'SEMANTIC_FIND_OPEN' })
            .then(response => { if (response?.success !== true) showFailure(); })
            .catch(showFailure)
            .finally(() => { loading = false; });
    }, true);
})();
