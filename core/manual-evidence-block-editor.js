(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const t = input => globalThis.SciLLM?.translateInterfaceText?.(input) || input;
  function authored(node) { node.setAttribute?.('data-i18n-ignore', ''); return node; }
  function labeledContent(doc, label, content) {
    if (!doc.createTextNode) {
      const line = doc.createElement('p'); line.textContent = `${t(label)}：${content}`; return authored(line);
    }
    const line = doc.createElement('p'), name = doc.createElement('span'), value = doc.createElement('span');
    name.textContent = label; value.textContent = content;
    line.append(name, doc.createTextNode(': '), authored(value));
    return line;
  }
  const fields = [['title', '标题'], ['method', '方法与对照'], ['observation', '观察结果'], ['conclusion', '结论']];
  function value(raw) {
    if (Array.isArray(raw)) return raw.slice(0, 64).map(item => typeof item === 'string' ? item : String(item?.value || '')).filter(Boolean).join('；');
    return typeof raw === 'string' ? raw : String(raw?.value || '');
  }
  function manualEvidenceEditorValues(block, panels = []) {
    if (!block) return Object.fromEntries(fields.map(([field]) => [field, '']));
    if (block.provenance === 'manual') return Object.fromEntries(fields.map(([field]) => [field, value(block[field])]));
    const members = panels.filter(panel => block.panelIds?.includes(panel.panelId || panel.panel));
    return { title: value(block.title) || value(block.groupGoal) || value(block.groupConclusion) || value(block.established),
      method: value(block.method) || members.map(panel => value(panel.experimentalMethods)).filter(Boolean).join('；'),
      observation: value(block.observation) || members.map(panel => value(panel.directObservation)).filter(Boolean).join('；'),
      conclusion: value(block.conclusion) || value(block.groupConclusion) || value(block.established) || value(block.groupGoal) };
  }
  function createManualEvidenceArchiveDetails(doc, entries, options = {}) {
    if (!Array.isArray(entries) || !entries.length) return null;
    const element = (tag, text, className = '') => {
      const node = doc.createElement(tag); node.textContent = text; node.className = className; return node;
    };
    const label = panelIds => options.panelLabel?.(panelIds) || (panelIds || []).join('、');
    const history = element('details', '', 'manual-evidence-archive');
    history.setAttribute?.('data-brevess-interface', '');
    history.append(element('summary', `证据块合并历史（${entries.length}）`));
    history.append(element('p', '合并前的来源记录，只读保留。历史说明不会自动成为当前结论，原联系仍需复核。', 'manual-evidence-note'));
    for (const entry of entries) {
      const block = entry.block || {};
      const target = (options.blocks || []).find(item => item.id === entry.mergedIntoBlockId);
      const item = element('details', '', 'manual-evidence-detail');
      item.append(authored(element('summary', `${label(block.panelIds) || t('原证据块')} → ${target ? label(target.panelIds) : t('已变更的证据块')}`)));
      const values = manualEvidenceEditorValues(block, entry.panels || []);
      for (const [field, name] of fields) item.append(labeledContent(doc, name, values[field] || t('未填写')));
      if (block.originalSource) {
        const prior = element('details', '', 'manual-evidence-detail');
        prior.append(element('summary', '接管前的来源记录'));
        prior.append(labeledContent(doc, '原 Panel', label(block.originalPanelIds)));
        for (const [field, name] of [['groupGoal', '原共同目标'], ['groupConclusion', '原组小结'], ['established', '原推断']]) {
          const text = value(block.originalSource[field]);
          if (text) prior.append(labeledContent(doc, name, text));
        }
        item.append(prior);
      }
      history.append(item);
    }
    return history;
  }
  function manualEvidencePanelIds(selected, extra) {
    const tokens = [...(selected || []), ...String(extra || '').split(/[\s,，、;；]+/u)].filter(Boolean);
    const ids = [];
    for (const raw of tokens) {
      const id = String(raw).trim().toUpperCase();
      if (!/^[A-Z]{1,3}[0-9]{0,2}$/u.test(id)) throw new Error('请分别填写原图中的 Panel 编号，例如 A、C、D；不要输入范围或 Figure 编号。');
      if (!ids.includes(id)) ids.push(id);
    }
    if (!ids.length) throw new Error('请至少选择或填写一个真实 Panel。');
    if (ids.length > 32) throw new Error('一个证据块最多包含 32 个 Panel。');
    return ids;
  }
  function createManualEvidenceBlockMutation({ figureId, blockId, id, selected, extra, values = {} }) {
    if (!figureId || !(blockId || id)) throw new Error('当前 Figure 或证据块标识缺失，请重新打开。');
    const block = { panelIds: manualEvidencePanelIds(selected, extra) };
    for (const [field] of fields) {
      block[field] = value(values[field]).trim();
      if (block[field].length > 4000) throw new Error('每项说明最多 4000 字，请缩短后保存。');
    }
    return blockId
      ? { type: 'update_manual_evidence_block', figureId, blockId, block, createMissingPanels: true }
      : { type: 'add_manual_evidence_block', figureId, block: { id, ...block }, createMissingPanels: true };
  }
  function createManualEvidenceRegroupMutation({ operation, figureId, source, newBlockId, selected, extra, mergeBlockId, values }) {
    if (!source?.id || !figureId) throw new Error('当前证据块不存在，请重新打开。');
    const block = createManualEvidenceBlockMutation({ figureId, blockId: source.id, selected: source.panelIds, values }).block;
    delete block.panelIds;
    if (operation === 'split') {
      const panelIds = manualEvidencePanelIds(selected, '');
      if (!newBlockId || panelIds.length >= source.panelIds.length || panelIds.some(id => !source.panelIds.includes(id))) {
        throw new Error('拆分时请选择原块的一部分 Panel；原块和新块都至少保留一个。');
      }
      return { type: 'split_manual_evidence_block', figureId, blockId: source.id, newBlockId, panelIds, block };
    }
    if (String(extra || '').trim() || (selected && (selected.length !== source.panelIds.length || selected.some(id => !source.panelIds.includes(id))))) {
      throw new Error('上方 Panel 成员尚有修改，请先保存成员变化，再进行合并。');
    }
    if (operation !== 'merge' || !mergeBlockId || mergeBlockId === source.id) throw new Error('请选择另一个需要合并的证据块。');
    return { type: 'merge_manual_evidence_blocks', figureId, blockId: source.id, sourceBlockIds: [mergeBlockId], block };
  }
  function createManualEvidenceBlockEditor(options) {
    const doc = options.document;
    let current = null;
    function close() {
      const prior = current; current = null;
      if (!prior) return;
      prior.dialog.close?.(); prior.dialog.remove();
      if (prior.focus?.isConnected) prior.focus.focus();
    }
    function open({ figure, panels = [], block = null, blocks = [] }) {
      close();
      const context = options.getContext();
      const dialog = doc.createElement('dialog');
      dialog.className = 'manual-evidence-dialog';
      dialog.setAttribute('data-brevess-interface', '');
      const editTitle = block ? '调整分组与说明' : '手动组合 Panel';
      dialog.setAttribute('aria-label', editTitle);
      const state = { dialog, context, focus: doc.activeElement, busy: false };
      current = state;
      const element = (tag, text, className = '') => {
        const node = doc.createElement(tag); node.textContent = text; node.className = className; return node;
      };
      const heading = element('h3', '');
      heading.append(authored(element('span', figure.figureLabel || 'Figure')), doc.createTextNode(' · '), element('span', editTitle));
      const note = element('p', '选择原图中共同支持一项结论的 Panel。说明可留空，保存后可直接拖到机制图联系上。', 'manual-evidence-note');
      const form = doc.createElement('form');
      const choices = element('fieldset', ''); choices.append(element('legend', '选择 Panel（可多选）'));
      const known = [...new Set([...panels.map(panel => String(panel.panelId || panel.panel || '').toUpperCase()), ...(block?.panelIds || [])])].filter(Boolean);
      const selected = new Set(block?.panelIds || []);
      for (const panelId of known) {
        const label = element('label', '', 'manual-evidence-choice');
        const checkbox = doc.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = panelId; checkbox.checked = selected.has(panelId);
        label.append(checkbox, element('span', panelId)); choices.append(label);
      }
      if (!known.length) choices.append(element('p', '尚无 Panel 目录，请对照原图填写下方编号。', 'manual-evidence-note'));
      const extraLabel = element('label', '补充原图中的 Panel 编号', 'manual-evidence-field');
      const extra = doc.createElement('input'); extra.type = 'text'; extra.placeholder = '例如 A、C、D'; extra.maxLength = 240;
      extraLabel.append(extra, element('small', '逐个填写图中已有编号；会保存为人工定义的 Panel，不推测图像或实验内容。'));
      form.append(choices, extraLabel);
      const inputs = {};
      const initialValues = manualEvidenceEditorValues(block, panels);
      for (const [field, labelText] of fields) {
        const label = element('label', labelText, 'manual-evidence-field');
        const input = doc.createElement('textarea'); input.rows = field === 'title' ? 2 : 3; input.maxLength = 4000; input.value = initialValues[field];
        input.name = field; inputs[field] = input; label.append(input); form.append(label);
      }
      form.append(element('p', '充分、必要、相关在绑定到具体联系后定义。人工证据块会在后续 AI 更新中保留。', 'manual-evidence-note'));
      const status = element('p', '', 'manual-evidence-status'); status.setAttribute('role', 'status');
      const actions = element('div', '', 'manual-evidence-actions');
      const cancel = element('button', '取消', 'btn btn-secondary'); cancel.type = 'button'; cancel.addEventListener('click', close);
      const save = element('button', '保存证据块', 'btn btn-primary'); save.type = 'submit';
      actions.append(cancel, save); form.append(status, actions); dialog.append(heading, note, form);
      const controls = () => Array.from(form.querySelectorAll('input, textarea, button, select'));
      async function persist(mutation) {
        if (state.busy || current !== state) return;
        state.busy = true; controls().forEach(control => { control.disabled = true; });
        status.textContent = '正在保存…';
        try {
          if (!options.isCurrent(context)) throw new Error('文献或草稿已有变化。本次输入仍保留，请复制后重新打开编辑器。');
          const result = await options.persist(mutation, context);
          if (current !== state) return;
          if (!options.isCurrent(context) && !options.isAcknowledged?.(result, context)) throw new Error('文献或草稿已有变化，本次保存结果未应用到当前界面。');
          if (!result?.success || !result.draft) throw new Error(result?.error || '证据块未保存。输入已保留，请重试。');
          options.onSaved?.(result, context, { figureId: figure.figureId, blockId: mutation.newBlockId || block?.id || mutation.block?.id });
          close();
        } catch (error) {
          if (current === state) status.textContent = /[\u3400-\u9fff]/u.test(error.message) ? error.message : '证据块未保存。请核对 Panel 编号后重试；输入已保留。';
        } finally {
          state.busy = false; if (current === state) controls().forEach(control => { control.disabled = false; });
        }
      }
      form.addEventListener('submit', event => {
        event.preventDefault();
        try {
          const mutation = createManualEvidenceBlockMutation({ figureId: figure.figureId, blockId: block?.id,
            id: block?.id || options.makeId(), selected: Array.from(choices.querySelectorAll('input:checked')).map(input => input.value),
            extra: extra.value, values: Object.fromEntries(fields.map(([field]) => [field, inputs[field].value])) });
          void persist(mutation);
        } catch (error) { status.textContent = error.message; }
      });
      if (block) {
        const regroup = element('details', '', 'manual-evidence-regroup');
        regroup.append(element('summary', '拆分或合并分组'));
        regroup.append(element('p', '拆分会把上方勾选的原有 Panel 移到新块，新块使用当前填写的说明；合并将选定块成员加入当前块，使用当前填写的说明，被并入块的说明保留在合并历史。旧联系引用保留并提示复核，证据类型不会自动转移。', 'manual-evidence-note'));
        const split = element('button', '将勾选 Panel 拆为新块', 'btn btn-secondary'); split.type = 'button';
        const values = () => Object.fromEntries(fields.map(([field]) => [field, inputs[field].value]));
        split.addEventListener('click', () => {
          try {
            if (extra.value.trim()) throw new Error('拆分仅移动原块已有成员；请先清空补充编号。');
            void persist(createManualEvidenceRegroupMutation({ operation: 'split', figureId: figure.figureId, source: block,
              newBlockId: options.makeId(), selected: Array.from(choices.querySelectorAll('input:checked')).map(input => input.value), values: values() }));
          } catch (error) { status.textContent = error.message; }
        });
        regroup.append(split);
        const mergeLabel = element('label', '合并另一个证据块', 'manual-evidence-field');
        const mergeSource = doc.createElement('select'); mergeSource.setAttribute('aria-label', '合并另一个证据块');
        const empty = element('option', '选择当前 Figure 的其他块'); empty.value = ''; mergeSource.append(empty);
        for (const other of blocks.filter(item => item.id !== block.id && item.kind !== 'transition' && item.sourceType !== 'bridge' && item.panelIds?.length)) {
          const option = authored(element('option', `${other.panelIds.join('、')} · ${manualEvidenceEditorValues(other).title || t('未填写标题')}`));
          option.value = other.id; mergeSource.append(option);
        }
        mergeLabel.append(mergeSource); regroup.append(mergeLabel);
        const merge = element('button', '合并所选块到当前块', 'btn btn-secondary'); merge.type = 'button';
        merge.addEventListener('click', () => {
          try { void persist(createManualEvidenceRegroupMutation({ operation: 'merge', figureId: figure.figureId, source: block, mergeBlockId: mergeSource.value,
            selected: Array.from(choices.querySelectorAll('input:checked')).map(input => input.value), extra: extra.value, values: values() })); }
          catch (error) { status.textContent = error.message; }
        });
        regroup.append(merge); form.insertBefore(regroup, status);
        const remove = element('button', '移除此证据块', 'btn btn-secondary'); remove.type = 'button';
        remove.addEventListener('click', () => void persist({ type: 'remove_evidence_block', figureId: figure.figureId, blockId: block.id }));
        actions.prepend(remove);
        form.insertBefore(element('p', '改变 Panel 成员或移除证据块后，已绑定的联系会保留来源记录并提示复核。', 'manual-evidence-note'), status);
      }
      dialog.addEventListener('cancel', event => { event.preventDefault(); if (!state.busy) close(); });
      doc.body.append(dialog); dialog.showModal();
      (choices.querySelector('input') || extra).focus();
      return dialog;
    }
    return Object.freeze({ open, close });
  }
  return { manualEvidencePanelIds, manualEvidenceEditorValues, createManualEvidenceBlockMutation, createManualEvidenceRegroupMutation, createManualEvidenceArchiveDetails, createManualEvidenceBlockEditor };
});
