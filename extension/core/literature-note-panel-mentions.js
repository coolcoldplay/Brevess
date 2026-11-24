/* Expand only a Panel reference that the reader has just typed or pasted. */
(() => {
  const api = globalThis.SciLLM;
  const pattern = /[@＠]F(ED|S)?([1-9]\d{0,2})([A-Z])/gi;
  const startsWord = /[a-z0-9_.+@＠\\-]/i;
  const continuesWord = /[a-z0-9_]/i;
  function boundary(text, start, end) {
    return !startsWord.test(text[start - 1] || '') && !continuesWord.test(text[end] || '');
  }
  function protectedMarkdown(text, offset) {
    const blocks = api.literatureNoteProtectedBlockRanges(text);
    if (!blocks.ok || blocks.ranges.some(range => range.start <= offset && offset < range.end)) return true;
    const line = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
    // Also leave an in-progress code span or link literal while it is being typed.
    let ticks = '';
    for (const match of line.matchAll(/(?<!\\)`+/g)) {
      if (!ticks) ticks = match[0];
      else if (ticks === match[0]) ticks = '';
    }
    return !!ticks || /!?\[[^\]]*$|\]\([^)]*$/.test(line);
  }

  // Offsets refer to editable text only. Keep block/cell boundaries and atomic
  // elements distinct so a token never spans a citation, an image or two cells.
  function richSnapshot(surface) {
    const runs = [];
    let text = '';
    function visit(node) {
      if (node.nodeType === 3) {
        if (!node.length) return;
        runs.push({node, start:text.length, end:text.length + node.length});
        text += node.data;
        return;
      }
      if (node.nodeType !== 1 || node.hasAttribute('data-note-editor-ui')) return;
      if (node.matches('br,img,a,code,button,[contenteditable=false]')) {
        runs.push({node, start:text.length, end:text.length + 1});
        text += '\ufffc';
        return;
      }
      const block = node.matches('div,p,li,th,td');
      if (block) text += '\n';
      node.childNodes.forEach(visit);
      if (block) text += '\n';
    }
    surface.childNodes.forEach(visit);
    function point(offset, left) {
      const run = left ? runs.find(r => offset > r.start && offset <= r.end)
                       : runs.find(r => offset >= r.start && offset < r.end);
      if (!run) {
        const next = runs.find(r => r.start >= offset);
        if (next) return point(next.start, false);
        return [surface, surface.childNodes.length];
      }
      if (run.node.nodeType === 3) return [run.node, offset - run.start];
      const parent = run.node.parentNode;
      return [parent, [...parent.childNodes].indexOf(run.node) + Number(offset === run.end)];
    }
    function offsetOf(node, offset) {
      const run = runs.find(r => r.node === node && node.nodeType === 3);
      if (run) return run.start + offset;
      const caret = surface.ownerDocument.createRange();
      caret.setStart(node, offset);
      caret.collapse(true);
      const next = runs.find(r => caret.comparePoint(r.node, 0) >= 0);
      return next?.start ?? text.length;
    }
    return {text, point, offsetOf};
  }

  function changedSpan(before, after) {
    let start = 0, oldEnd = before.length, newEnd = after.length;
    while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
    while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
    return {start, oldEnd, newEnd};
  }
  function shiftCaret(offset, start, end, delta) {
    if (offset <= start) return offset;
    return offset >= end ? offset + delta : end + delta;
  }

  api.attachLiteratureNotePanelMentions = function({field, editor, sourceEditor, resolve, context, isCurrent}) {
    const surface = editor.surface, doc = field.ownerDocument;
    for (const rich of [true, false]) {
      const target = rich ? surface : field;
      const snapshot = () => rich ? richSnapshot(surface) : {text:field.value};
      let previous = snapshot().text, composing = false, applying = false;
      const jobs = new Set();
      function cancel(job) { clearTimeout(job.timer); jobs.delete(job); }
      function reconcile(value, discover) {
        if (previous === value) return;
        const {start, oldEnd, newEnd} = changedSpan(previous, value);
        const delta = newEnd - oldEnd;
        previous = value;
        for (const job of jobs) {
          if (oldEnd <= job.start) job.start += delta;
          else if (start < job.start + job.raw.length) { cancel(job); continue; }
          if (!boundary(value, job.start, job.start + job.raw.length)) cancel(job);
        }
        if (!discover || newEnd <= start) return;
        const beginning = value.slice(0, newEnd);
        if (/(?:^|[^a-z0-9_.+@＠\\-])[@＠](?:F(?:S|ED)?(?:[1-9]\d{0,2})?)?$/i.test(beginning) &&
            (rich || !protectedMarkdown(value, newEnd - 1))) {
          editor.announce('主图 @F1A · 补图 @FS1A');
        }
        for (const match of value.matchAll(pattern)) {
          const at = match.index, end = at + match[0].length;
          if (at >= newEnd || end <= start || !boundary(value, at, end) ||
              !rich && protectedMarkdown(value, at) || [...jobs].some(job => job.start === at)) continue;
          const job = {raw:match[0], series:(match[1] || '').toLowerCase(), number:match[2],
            label:match[3].toUpperCase(), start:at, context:context()};
          jobs.add(job);
          // An immediately following ASCII letter may still be part of a word.
          job.timer = setTimeout(() => void expand(job), 180);
        }
      }
      function valid(job) {
        if (!jobs.has(job) || !field.isConnected || editor.rich !== rich || field.readOnly ||
            field.disabled || !isCurrent(job.context)) return false;
        const {text} = snapshot();
        if (!composing) reconcile(text, false);
        return jobs.has(job) && text.slice(job.start, job.start + job.raw.length) === job.raw &&
          boundary(text, job.start, job.start + job.raw.length);
      }
      function replace(job, asset) {
        const view = snapshot(), start = job.start, end = start + job.raw.length;
        if (sourceEditor.canonicalValue().length - job.raw.length + asset.markdown.length > api.LITERATURE_NOTE_FORMAT_LIMITS.maxLength)
          throw Error('字段已达到长度限制');
        if (!rich) {
          const a = field.selectionStart, b = field.selectionEnd, direction = field.selectionDirection;
          if (!sourceEditor.replaceRange(asset.markdown, start, end)) throw Error('此处无法插入图片');
          const delta = field.value.length - view.text.length;
          field.setSelectionRange(shiftCaret(a, start, end, delta), shiftCaret(b, start, end, delta), direction);
          return;
        }
        const range = doc.createRange();
        range.setStart(...view.point(start, false));
        range.setEnd(...view.point(end, true));
        if (range.toString() !== job.raw) return;
        const selection = doc.getSelection();
        const active = doc.activeElement === surface && selection.rangeCount &&
          surface.contains(selection.anchorNode) && surface.contains(selection.focusNode);
        if (active) {
          const a = view.offsetOf(selection.anchorNode, selection.anchorOffset);
          const b = view.offsetOf(selection.focusNode, selection.focusOffset);
          if (!editor.insert(asset.markdown, range)) throw Error('此处无法插入图片');
          const after = snapshot(), delta = after.text.length - view.text.length;
          // Keep the user's live selection, including text typed while cropping.
          selection.setBaseAndExtent(...after.point(shiftCaret(a, start, end, delta), true),
            ...after.point(shiftCaret(b, start, end, delta), true));
          editor.capture();
        } else {
          // Allow finishing in an unfocused field without interrupting another editor.
          const image = doc.createElement('img');
          image.dataset.noteImage = asset.id;
          image.alt = asset.alt;
          range.deleteContents();
          range.insertNode(image);
          if (!editor.commit()) throw Error('此处无法插入图片');
        }
      }
      async function expand(job) {
        try {
          if (!valid(job)) return;
          const asset = await resolve(job, () => valid(job));
          if (!asset || !valid(job)) return;
          if (composing) {
            // Never run an editing command through an active IME composition.
            job.asset = asset;
            return;
          }
          applying = true;
          replace(job, asset);
          reconcile(snapshot().text, false);
          editor.announce('');
        } catch (error) {
          if (valid(job)) editor.announce(job.raw + '：' + error.message);
        } finally {
          applying = false;
          if (!job.asset) cancel(job);
        }
      }
      target.addEventListener('beforeinput', () => {
        if (editor.rich === rich && !composing) reconcile(snapshot().text, false);
      });
      target.addEventListener('input', event => {
        if (editor.rich !== rich || composing || event.isComposing) return;
        reconcile(snapshot().text, !applying && event.inputType?.startsWith('insert'));
      });
      target.addEventListener('compositionstart', () => {
        reconcile(snapshot().text, false);
        composing = true;
      });
      target.addEventListener('compositionend', () => {
        composing = false;
        reconcile(snapshot().text, true);
        for (const job of jobs) if (job.asset) {
          try { if (valid(job)) { applying = true; replace(job, job.asset); } }
          catch (error) { if (valid(job)) editor.announce(job.raw + '：' + error.message); }
          finally { applying = false; cancel(job); reconcile(snapshot().text, false); }
        }
      });
      field.addEventListener('brevess-note-view-change', () => { for (const job of jobs) cancel(job); });
    }
  };
})();
