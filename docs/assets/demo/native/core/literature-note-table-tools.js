/* Keep table controls out of Markdown, clipboard text and the browser's undo entries. */
(() => {
  const api = globalThis.SciLLM;
  const groups = [
    [['rowAbove', '在上方插入行'], ['rowBelow', '在下方插入行'], ['rowDelete', '删除当前行']],
    [['columnLeft', '在左侧插入列'], ['columnRight', '在右侧插入列'], ['columnDelete', '删除当前列']],
    [['tableDelete', '删除整个表格', 'clear']]
  ];

  function makeCell(row, header, alignment, index) {
    const cell = row.ownerDocument.createElement(header ? 'th' : 'td');
    if (header) cell.scope = 'col';
    if (alignment) cell.style.textAlign = alignment;
    row.insertBefore(cell, row.cells[index] || null);
    return cell;
  }

  // Markdown has exactly one header row. Promote/demote cells with their contents
  // and column alignment when a command crosses that boundary.
  function changeHeader(row, header) {
    for (const old of [...row.cells]) {
      const cell = makeCell(row, header, old.style.textAlign, old.cellIndex);
      cell.append(...old.childNodes);
      old.remove();
    }
  }

  function editGrid(table, rowIndex, columnIndex, action) {
    if (action === 'tableDelete') return null;
    const header = table.rows[0];
    const widths = [...header.cells].map(cell => cell.style.textAlign);
    const row = table.rows[rowIndex];
    if (action === 'rowDelete') {
      if (table.rows.length === 1) return null;
      if (rowIndex === 0) {
        const promoted = table.rows[1];
        changeHeader(promoted, true);
        row.replaceWith(promoted);
      } else row.remove();
      rowIndex = Math.min(rowIndex, table.rows.length - 1);
    } else if (action === 'rowAbove' || action === 'rowBelow') {
      const index = rowIndex + (action === 'rowBelow' ? 1 : 0);
      const body = table.tBodies[0] || table.createTBody();
      const next = row.ownerDocument.createElement('tr');
      if (index === 0) {
        header.replaceWith(next);
        changeHeader(header, false);
        body.prepend(header);
      } else {
        // A table recovered from pasted HTML may have more than one tbody.
        const following = table.rows[index];
        (following?.parentElement || body).insertBefore(next, following || null);
      }
      for (const align of widths) makeCell(next, index === 0, align);
      rowIndex = index;
    } else if (action === 'columnDelete') {
      if (widths.length === 1) return null;
      for (const current of table.rows) current.deleteCell(columnIndex);
      columnIndex = Math.min(columnIndex, widths.length - 2);
    } else {
      const index = columnIndex + (action === 'columnRight' ? 1 : 0);
      for (const current of table.rows) makeCell(current, current === header, widths[columnIndex], index);
      columnIndex = index;
    }
    return {rowIndex, columnIndex};
  }

  api.attachLiteratureNoteTableTools = function({surface, on, restore, commit, canEdit, translate, announce}) {
    const doc = surface.ownerDocument;
    const tools = doc.createElement('caption');
    tools.contentEditable = 'false';
    tools.dataset.noteEditorUi = 'table';
    const bar = doc.createElement('div');
    bar.className = 'literature-note-table-tools';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', translate('表格操作'));
    tools.append(bar);
    let currentCell = null;

    function clear() {
      currentCell?.removeAttribute('data-note-current-cell');
      currentCell = null;
      tools.remove();
    }
    function selectedCell() {
      const selection = doc.getSelection();
      const focus = selection?.focusNode;
      const element = focus?.nodeType === 1 ? focus : focus?.parentElement;
      const cell = element?.closest('th,td');
      return cell && surface.contains(cell) ? cell : null;
    }
    function sync() {
      if (tools.contains(doc.activeElement)) return;
      const cell = canEdit() && surface.contains(doc.activeElement) && selectedCell();
      if (!cell) { if (currentCell) clear(); return; }
      if (cell === currentCell && tools.isConnected) return;
      currentCell?.removeAttribute('data-note-current-cell');
      currentCell = cell;
      cell.dataset.noteCurrentCell = '';
      const table = cell.closest('table');
      if (tools.parentElement !== table) table.prepend(tools);
      for (const [action, last, label] of [
        ['rowDelete', table.rows.length === 1, '删除当前行'],
        ['columnDelete', table.rows[0].cells.length === 1, '删除当前列']
      ]) {
        const button = bar.querySelector('[data-note-table-action="' + action + '"]');
        button.title = translate(last ? '删除表格' : label);
        button.setAttribute('aria-label', button.title);
      }
    }
    function focusCell(cell) {
      const caret = doc.createRange();
      caret.selectNodeContents(cell);
      caret.collapse(true);
      restore(caret);
      sync();
    }
    function change(action) {
      const cell = currentCell;
      if (!canEdit() || !cell?.isConnected || !surface.contains(cell)) return;
      const table = cell.closest('table');
      const row = cell.parentElement.rowIndex;
      const column = cell.cellIndex;
      const draft = table.cloneNode(true);
      draft.querySelector('caption[data-note-editor-ui]')?.remove();
      draft.querySelector('[data-note-current-cell]')?.removeAttribute('data-note-current-cell');
      const target = editGrid(draft, row, column, action);
      const index = [...surface.querySelectorAll('table')].indexOf(table);
      const proposed = surface.cloneNode(true);
      const original = proposed.querySelectorAll('table')[index];
      if (target) original.replaceWith(draft.cloneNode(true));
      else original.remove();
      if (api.parseLiteratureNoteMarkdown(api.serializeLiteratureNoteRichText(proposed)).error) {
        announce('表格超过字段限制，请先缩小表格。');
        return;
      }
      clear();
      const range = doc.createRange();
      range.selectNode(table);
      restore(range);
      // One native editing command makes an entire structural change undoable.
      // Keep image IDs, including images whose async hydration is still pending.
      if (target) for (const image of draft.querySelectorAll('img[data-note-image]')) {
        image.src = api.literatureNoteImagePlaceholder;
        image.dataset.notePendingImage = '';
      }
      const ok = target ? doc.execCommand('insertHTML', false, draft.outerHTML) : doc.execCommand('delete');
      if (!ok) { announce('表格未能修改，请重新选择单元格。'); sync(); return; }
      const updated = target && surface.querySelectorAll('table')[index];
      if (updated) {
        for (const img of updated.querySelectorAll('[data-note-pending-image]')) {
          img.removeAttribute('src');
          delete img.dataset.notePendingImage;
        }
        focusCell(updated.rows[target.rowIndex].cells[target.columnIndex]);
      }
      commit();
    }

    for (const entries of groups) {
      const group = doc.createElement('span');
      for (const [action, label, icon = action] of entries) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.title = translate(label);
        button.setAttribute('aria-label', button.title);
        button.dataset.noteTableAction = action;
        button.append(api.createLiteratureNoteFormatIcon(doc, icon));
        on(button, 'mousedown', event => event.preventDefault());
        on(button, 'click', () => change(action));
        group.append(button);
      }
      bar.append(group);
    }
    on(doc, 'selectionchange', sync);
    on(doc, 'focusin', sync);
    on(surface, 'pointerup', sync);
    on(surface, 'keyup', sync);
    on(surface, 'keydown', event => {
      if (!canEdit() || event.isComposing) return;
      if (tools.contains(event.target)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (currentCell) focusCell(currentCell);
        }
        return;
      }
      sync();
      if (!currentCell) return;
      if (event.key === 'F10' && event.altKey) {
        event.preventDefault();
        bar.querySelector('button').focus();
      } else if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const cells = [...currentCell.closest('table').rows].flatMap(row => [...row.cells]);
        const next = cells[cells.indexOf(currentCell) + (event.shiftKey ? -1 : 1)];
        if (next) { event.preventDefault(); focusCell(next); }
        else if (!event.shiftKey) {
          event.preventDefault();
          change('rowBelow');
          if (currentCell) focusCell(currentCell.parentElement.cells[0]);
        }
      }
    });
    return {clear};
  };
})();
