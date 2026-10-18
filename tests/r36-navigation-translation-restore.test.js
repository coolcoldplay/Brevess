const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function sourceOf(script, name) {
    const match = new RegExp(`(?:async )?function ${name}\\(`).exec(script);
    assert.ok(match, name);
    const tail = script.slice(match.index);
    const end = tail.slice(1).search(/\n(?:async )?function /);
    assert.ok(end >= 0, name);
    return tail.slice(0, end + 1);
}

test('the normal workspace snapshot carries the content-owned side panel state', () => {
    const handler = content.slice(
        content.indexOf("request.action === 'getArticleWorkspaceSnapshot'"),
        content.indexOf("request.action === 'acknowledgeArticleParagraphNoteReveal'")
    );
    assert.match(handler, /sidePanelUiState:\s*articleWorkspaceSidePanelUiState/,
        'A reopened side panel must be able to recover translations without a folder restore');
});

test('a new side panel applies snapshot translations only when its local cache is empty', () => {
    const calls = [];
    const context = {
        Map,
        outlineTitleTranslations: new Map(),
        applyRestoredSidePanelUiState(uiState) {
            calls.push(uiState);
        }
    };
    vm.createContext(context);
    vm.runInContext(sourceOf(popup, 'restoreSnapshotSidePanelUiState'), context);

    const state = { outlineTitleTranslations: [['html', 'results', 'Results', '结果']] };
    assert.equal(context.restoreSnapshotSidePanelUiState(state), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], state);

    context.outlineTitleTranslations.set('html\u0000results',
        ['html', 'results', 'Results', '新结果']);
    assert.equal(context.restoreSnapshotSidePanelUiState({
        outlineTitleTranslations: [['html', 'results', 'Results', '旧结果']]
    }), false);
    assert.equal(calls.length, 1, 'A background snapshot must not roll back newer translations');
});

test('workspace refresh restores the content-owned side panel state after rendering', () => {
    const refresh = sourceOf(popup, 'performArticleWorkspaceRefresh');
    const render = refresh.indexOf('renderArticleWorkspaceSnapshot(refreshedSnapshot)');
    const restore = refresh.indexOf('restoreSnapshotSidePanelUiState(response.sidePanelUiState)');
    assert.ok(render >= 0, 'workspace snapshot rendering');
    assert.ok(restore > render, 'side panel state must be applied after the new snapshot renders');
});

test('closing or hiding the side panel flushes the pending UI state immediately', () => {
    assert.match(sourceOf(popup, 'flushActiveWorkspaceUiStateSave'),
        /sendTabMessage\([^)]*saveArticleWorkspaceUiState/s);
    const setup = sourceOf(popup, 'setupActiveWorkspaceUiStatePersistence');
    assert.match(setup, /addEventListener\('pagehide'/);
    assert.match(setup, /addEventListener\('visibilitychange'/);
    assert.match(setup, /flushActiveWorkspaceUiStateSave\(\)/);
});

test('a tab-scoped session snapshot provides translations before workspace reinitialization', () => {
    assert.match(sourceOf(popup, 'flushActiveWorkspaceUiStateSave'),
        /brevessSidePanelUiState:\$\{tabId\}/);
    assert.match(sourceOf(popup, 'restoreSessionCachedSidePanelUiState'),
        /cached\.contextKey !== contextKey/);
    const synchronize = sourceOf(popup, 'synchronizeActiveTabContext');
    assert.ok(synchronize.indexOf('restoreSessionCachedSidePanelUiState(tab?.id, key)') <
        synchronize.indexOf('if (activePanelTabContext.pdfMode)'));
});
