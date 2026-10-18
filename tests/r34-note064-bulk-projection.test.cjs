'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source.js');
const reviewOutline = require('../core/review-outline.js');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function harness() {
    const structure = { revision: 7, paragraphs: [
        { paragraphId: 'p-1', sourceKey: 's-1', sectionId: 'results', sectionTitle: 'Results',
            text: 'First validated result paragraph.' },
        { paragraphId: 'p-2', sourceKey: 's-2', sectionId: 'results', sectionTitle: 'Results',
            text: 'Second validated result paragraph.' }
    ] };
    const notes = new Map([['p-1', { paragraphId: 'p-1', sourceKey: 's-1', note: '人工笔记。' }]]);
    const writes = [];
    let asset = null;
    let documentHash = 'hash-a';
    const context = {
        Map, JSON, Object, Number, String, Array, Date,
        articleParagraphNotes: notes,
        articleWorkspaceLifecycleGeneration: 1,
        currentArticleWorkspace: { workspaceId: 'workspace-a', workspaceGeneration: 3 },
        currentArticleStructure: structure,
        currentManualDocument: { documentId: 'doc-a' },
        lastPreparedStudy: null,
        getCanonicalArticleSnapshot: () => ({ documentHash, structure }),
        refreshActivePdfSemanticNavigationContext: () => null,
        resolveWorkspaceParagraph: target => structure.paragraphs.find(paragraph =>
            paragraph.paragraphId === target?.paragraphId &&
            (!target?.sourceKey || paragraph.sourceKey === target.sourceKey)) || null,
        normalizeArticleNavigatorText: value => String(value || '').replace(/\s+/gu, ' ').trim(),
        buildArticleWorkspaceSnapshot: () => ({ paragraphNotes: [...notes.values()] }),
        ensureCurrentArticleWorkspace: async () => context.currentArticleWorkspace,
        getWorkspaceAssetCheckpoint: async () => asset ? JSON.parse(JSON.stringify(asset)) : null,
        persistWorkspaceAssetCheckpoint: async (relativePath, payload, options) => {
            options.commitGuard?.();
            writes.push(JSON.parse(JSON.stringify({ relativePath, payload })));
            asset = { content: JSON.parse(JSON.stringify(payload)), revision: (asset?.revision || 0) + 1,
                contentHash: `hash-${writes.length}`, writeToken: `token-${writes.length}` };
            return { saved: true };
        },
        scheduleArticleParagraphNoteMarkers() {},
        SciLLM: {
            mergeReviewParagraphSummariesIntoNotes: reviewOutline.mergeReviewParagraphSummariesIntoNotes,
            resolveArticleStructureParagraph: (value, target) => (value?.paragraphs || [])
                .find(paragraph => paragraph.paragraphId === target?.paragraphId &&
                    (!target?.sourceKey || paragraph.sourceKey === target.sourceKey)) || null
        }
    };
    vm.createContext(context);
    vm.runInContext(['queueParagraphNoteMutation', 'persistParagraphNoteTransaction',
        'normalizeParagraphNoteMarkerOffset', 'articleParagraphNoteSourceEntry',
        'paragraphNoteMutationValue',
        'updateArticleParagraphNoteMarkerOffset', 'updateArticleParagraphNote',
        'applyReviewOutlineParagraphNotes'].map(name => functionSource(content, name)).join('\n'), context);
    const summaries = [
        { paragraphId: 'p-1', summary: '第一段概述。' },
        { paragraphId: 'p-2', summary: '第二段概述。' }
    ];
    return { context, structure, notes, writes, summaries, asset: () => asset,
        setDocumentHash: value => { documentHash = value; },
        getDocumentHash: () => documentHash,
        paragraphs: structure.paragraphs.map(paragraph => ({ ...paragraph })) };
}

test('NOTE-064 bulk paragraph summaries persist once and preserve human notes', async () => {
    const h = harness();
    assert.equal(typeof h.context.applyReviewOutlineParagraphNotes, 'function');
    const first = await h.context.applyReviewOutlineParagraphNotes({
        summaries: h.summaries, paragraphs: h.paragraphs, expectedLifecycle: 1
    });
    assert.deepEqual(first.addedParagraphIds, ['p-1', 'p-2']);
    assert.equal(h.notes.get('p-1').note, '人工笔记。\n\n第一段概述。');
    assert.equal(h.notes.get('p-2').note, '第二段概述。');
    const marker = h.context.articleParagraphNoteSourceEntry('p-2');
    assert.ok(marker, 'the projected note must resolve to a current paragraph marker entry');
    assert.equal(marker.note, '第二段概述。');
    assert.equal(marker.documentHash, 'hash-a');
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].relativePath, 'annotations/paragraph-notes.json');
    assert.equal(h.writes[0].payload.notes.length, 2);

    const second = await h.context.applyReviewOutlineParagraphNotes({
        summaries: h.summaries, paragraphs: h.paragraphs, expectedLifecycle: 1
    });
    assert.deepEqual(second.addedParagraphIds, []);
    assert.deepEqual(second.alreadyPresentParagraphIds.sort(), ['p-1', 'p-2']);
    assert.equal(h.notes.get('p-1').note, '人工笔记。\n\n第一段概述。');
    assert.equal(h.writes.length, 2, 'an idempotent rerun may checkpoint but never duplicates text');
});

test('NOTE-064 bulk projection rejects a changed paragraph without writing', async () => {
    const h = harness();
    h.structure.paragraphs[1].text = 'Changed after the model started.';
    await assert.rejects(h.context.applyReviewOutlineParagraphNotes({
        summaries: h.summaries, paragraphs: h.paragraphs, expectedLifecycle: 1
    }), { code: 'PARAGRAPH_STALE' });
    assert.equal(h.writes.length, 0);
    assert.equal(h.notes.get('p-1').note, '人工笔记。');
    assert.equal(h.notes.has('p-2'), false);
});

test('NOTE-064 bulk projection rejects a replaced workspace before mutation', async () => {
    const h = harness();
    const getAsset = h.context.getWorkspaceAssetCheckpoint;
    h.context.getWorkspaceAssetCheckpoint = async () => {
        h.context.currentArticleWorkspace = { workspaceId: 'workspace-b', workspaceGeneration: 1 };
        return getAsset();
    };
    await assert.rejects(h.context.applyReviewOutlineParagraphNotes({
        summaries: h.summaries, paragraphs: h.paragraphs, expectedLifecycle: 1
    }), { code: 'PARAGRAPH_STALE' });
    assert.equal(h.writes.length, 0);
    assert.equal(h.notes.has('p-2'), false);
});

test('NOTE-068 marker drag offsets persist with the note and survive note edits', async () => {
    const h = harness();
    await h.context.applyReviewOutlineParagraphNotes({
        summaries: h.summaries, paragraphs: h.paragraphs, expectedLifecycle: 1
    });
    const moved = await h.context.updateArticleParagraphNoteMarkerOffset({
        paragraphId: 'p-2', sourceKey: 's-2', documentHash: 'hash-a',
        expectedNote: '第二段概述。', dx: 12, dy: -8
    });
    assert.equal(moved.saved, true);
    assert.deepEqual(JSON.parse(JSON.stringify(moved.markerOffset)), { dx: 12, dy: -8 });
    assert.equal(h.notes.get('p-2').note, '第二段概述。');
    assert.deepEqual(JSON.parse(JSON.stringify(h.notes.get('p-2').markerOffset)),
        { dx: 12, dy: -8 });
    assert.equal(h.context.articleParagraphNoteSourceEntry('p-2').markerOffset.dy, -8);

    await h.context.updateArticleParagraphNote({
        paragraphId: 'p-2', sourceKey: 's-2', navigationRevision: 7,
        note: '人工修改后的笔记', expectedNote: '第二段概述。'
    });
    assert.equal(h.notes.get('p-2').note, '人工修改后的笔记');
    assert.deepEqual(JSON.parse(JSON.stringify(h.notes.get('p-2').markerOffset)),
        { dx: 12, dy: -8 });

    h.setDocumentHash('hash-b');
    assert.equal(h.context.articleParagraphNoteSourceEntry('p-2').markerOffset, undefined,
        'an offset from another document must not be applied to a reused paragraph id');
});

test('NOTE-068 marker offsets reject a stale note and cannot mutate a deleted note', async () => {
    const h = harness();
    await h.context.applyReviewOutlineParagraphNotes({
        summaries: h.summaries, paragraphs: h.paragraphs, expectedLifecycle: 1
    });
    const before = h.writes.length;
    await assert.rejects(h.context.updateArticleParagraphNoteMarkerOffset({
        paragraphId: 'p-2', sourceKey: 's-2', documentHash: 'hash-a',
        expectedNote: '旧内容', dx: 1, dy: 2
    }), { code: 'PARAGRAPH_STALE' });
    assert.equal(h.writes.length, before);
    h.notes.delete('p-2');
    await assert.rejects(h.context.updateArticleParagraphNoteMarkerOffset({
        paragraphId: 'p-2', sourceKey: 's-2', documentHash: 'hash-a',
        expectedNote: '第二段概述。', dx: 1, dy: 2
    }), { code: 'PARAGRAPH_STALE' });
});
