/* Editable view of the existing Markdown store; citations and image IDs stay canonical. */
(() => {
  const api = globalThis.SciLLM, plainEditor = api.attachLiteratureNoteEditor;
  api.literatureNoteImagePlaceholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const colors = {black:'#242424',red:'#b42318',orange:'#995700',green:'#216e39',blue:'#175cd3',purple:'#6938a8'};
  const escape = text => text.replace(/[\\`*_\[\]<>|]/g, '\\$&');
  function markdown(root) {
    const children = node => [...node.childNodes].map(walk).join('');
    const inline=(s,mark)=>s.split('\n').map(line=>line.trim()?line.replace(/^(\s*)(.*?)(\s*)$/,'$1'+mark+'$2'+mark+'$3'):line).join('\n');
    function walk(n) {
      if (n.nodeType === 3) return escape(n.textContent.replace(/\u00a0/g,' ').replace(/\u200b/g,''));
      if (n.nodeType !== 1 || n.hasAttribute('data-note-editor-ui')) return '';
      if (n.dataset.noteSourceId) return '(' + n.dataset.noteSourceId + ')';
      if (n.dataset.noteImage) return '![' + (n.alt||'图片').replace(/[\[\]\n]/g,' ') + '](brevess-image:' + n.dataset.noteImage + ')';
      const s=children(n), tag=n.tagName;
      if (['STRONG','B'].includes(tag)) return inline(s,'**');
      if (['EM','I'].includes(tag)) return inline(s,'*');
      if (tag==='CODE') {const ticks='`'.repeat(Math.max(1,...(n.textContent.match(/`+/g)||[]).map(v=>v.length+1)));return ticks+n.textContent+ticks;}
      if (tag==='BR') return '\n';
      if (tag==='A' && /^https?:\/\//i.test(n.getAttribute('href')||'')) return '['+s+']('+n.getAttribute('href')+')';
      const color=n.dataset.brevessColor || (n.style.color || n.getAttribute('color')) && Object.keys(colors).find(k=>{const e=root.ownerDocument.createElement('span'),v=root.ownerDocument.createElement('span');e.style.color=colors[k];v.style.color=n.style.color||n.getAttribute('color')||'';return e.style.color===v.style.color;});
      if(color) return '<span data-brevess-color="'+color+'">'+s+'</span>';
      if(tag==='TABLE') {
        const rows=[...n.rows].map(row=>[...row.cells].map(c=>children(c).trim().replace(/\n/g,' ')));
        if(!rows.length)return '';
        const count=Math.max(...rows.map(r=>r.length));const line=r=>'| '+Array.from({length:count},(_,i)=>r[i]||'').join(' | ')+' |';
        const align=[...n.rows[0].cells].map(c=>({left:':---',right:'---:',center:':---:'}[c.style.textAlign]||'---'));
        return '\n\n'+[line(rows[0]),line(align),...rows.slice(1).map(line)].join('\n')+'\n\n';
      }
      if(tag==='UL'||tag==='OL') return '\n'+[...n.children].map((li,i)=>{
        const nested=[...li.children].filter(e=>['UL','OL'].includes(e.tagName));
        const body=[...li.childNodes].filter(e=>!nested.includes(e)).map(walk).join('').trim();
        return (tag==='OL'?((li.hasAttribute('value')?Number(li.getAttribute('value')):(Number(n.getAttribute('start'))||1)+i))+'. ':'- ')+body+
          nested.map(e=>'\n'+walk(e).trim().split('\n').map(l=>'  '+l).join('\n')).join('');
      }).join('\n')+'\n';
      if(tag==='P'||tag==='DIV') return s+'\n\n';
      return s;
    }
    return children(root).replace(/\n{3,}/g,'\n\n').trim();
  }
  api.serializeLiteratureNoteRichText=markdown;
  api.attachLiteratureNoteEditor = function(options={}) {
    if(!options.sourceEditor)return plainEditor(options);
    const {textarea,sourceEditor,fieldAction,renderMedia,translate=t=>t}=options,doc=textarea.ownerDocument;
    let rich=options.initialPreview!==false,range=null,composing=false,writing=false,destroyed=false,last='',lastRenderedMarkdown='';
    const listeners=[];const on=(e,t,f,o)=>{e.addEventListener(t,f,o);listeners.push(()=>e.removeEventListener(t,f,o));};
    const element=doc.createElement('div');element.className='literature-note-editor';element.dataset.brevessInterface='';
    const toolbar=doc.createElement('div');toolbar.className='literature-note-editor-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label',translate('笔记格式工具'));
    const status=doc.createElement('div');status.className='literature-note-editor-status';status.setAttribute('role','status');
    const surface=doc.createElement('div');surface.className='literature-note-editor-preview literature-note-rich';surface.contentEditable='true';surface.setAttribute('role','textbox');surface.setAttribute('aria-multiline','true');surface.setAttribute('aria-label',textarea.getAttribute('aria-label'));surface.dataset.placeholder=textarea.placeholder;surface.dataset.i18nUserContent='';
    element.append(toolbar,status,surface);
    function capture(){const s=doc.getSelection();if(s?.rangeCount && surface.contains(s.anchorNode)&&surface.contains(s.focusNode))range=s.getRangeAt(0).cloneRange();}
    function restore(saved=range){surface.focus({preventScroll:true});const s=doc.getSelection();s.removeAllRanges();if(saved && surface.contains(saved.commonAncestorContainer))s.addRange(saved);else{const r=doc.createRange();r.selectNodeContents(surface);r.collapse(false);s.addRange(r);}const caret=s.rangeCount?s.getRangeAt(0):null;if(caret?.collapsed&&caret.startContainer.nodeType!==3){const anchor=doc.createTextNode('\u200b');caret.insertNode(anchor);caret.setStart(anchor,1);caret.collapse(true);s.removeAllRanges();s.addRange(caret);}capture();}
    function decorate(){renderMedia?.(surface);for(const b of surface.querySelectorAll('[data-note-source-id]'))b.contentEditable='false';}
    function draw(){surface.replaceChildren(api.renderLiteratureNoteMarkdown(doc,textarea.value));decorate();last=sourceEditor.canonicalValue();lastRenderedMarkdown=markdown(surface);range=null;}
    function commit(){
      if(writing||composing||destroyed)return true;
      for(const img of surface.querySelectorAll('img[data-note-pending-image]')) {
        img.removeAttribute('src');
        delete img.dataset.notePendingImage;
      }
      const next=markdown(surface);
      if(next===lastRenderedMarkdown)return true;
      if(next.length>12000 || api.parseLiteratureNoteMarkdown(next).error){status.textContent='内容或格式超出笔记限制，请撤销本次修改。';return false;}
      writing=true;const ok=sourceEditor.replaceRange(next,0,textarea.value.length);writing=false;
      if(!ok){status.textContent='未能保存修改，请撤销后重试。';return false;}
      last=sourceEditor.canonicalValue();decorate();lastRenderedMarkdown=markdown(surface);status.textContent='';return true;
    }
    function refresh(){if(destroyed)return;textarea.hidden=rich;surface.hidden=!rich;element.dataset.previewing=String(rich);surface.contentEditable=String(!textarea.disabled&&!textarea.readOnly);if(rich&&!writing&&last!==sourceEditor.canonicalValue())draw();}
    function command(name,value){if(composing||textarea.disabled||textarea.readOnly)return;if(!rich){sourceFormatting?.(name,value);return;}restore();doc.execCommand(name,false,value);commit();capture();}
    // Source mode keeps the existing Markdown formatter and its source-token guards.
    function sourceFormatting(name,value){const actions={bold:'bold',italic:'italic',insertUnorderedList:'bullet',insertOrderedList:'ordered',indent:'indent',outdent:'outdent',foreColor:'color'};const action=actions[name];if(!action)return;
      const result=api.formatLiteratureNoteSelection({text:textarea.value,start:textarea.selectionStart,end:textarea.selectionEnd,action,color:value});if(result.error){status.textContent='请选中完整文字后设置格式。';return;}textarea.setRangeText(result.text.slice(0),0,textarea.value.length);textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.focus();textarea.setSelectionRange(result.selectionStart,result.selectionEnd);
    }
    const canEdit = () => rich && !destroyed && !composing && !textarea.disabled && !textarea.readOnly;
    const announce = message => { status.textContent = message ? translate(message) : ''; };
    function group(label) {
      const box = doc.createElement('div');
      box.className = 'literature-note-format-group';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', translate(label));
      toolbar.append(box);
      return box;
    }
    function button(box, label, icon, action) {
      const control = doc.createElement('button');
      control.type = 'button';
      control.title = translate(label);
      control.setAttribute('aria-label', control.title);
      control.append(api.createLiteratureNoteFormatIcon(doc, icon));
      on(control, 'mousedown', event => { capture(); event.preventDefault(); });
      on(control, 'click', action);
      box.append(control);
      return control;
    }
    function insertButton(box, kind, label) {
      const control = button(box, label, kind, () => fieldAction?.(kind));
      control.dataset.noteFormatAction = kind;
    }
    const textGroup = group('文字格式');
    button(textGroup, '加粗选中文字', 'bold', () => command('bold'));
    const colorLabel = doc.createElement('label');
    colorLabel.className = 'literature-note-editor-color-label';
    colorLabel.title = translate('设置选中文字颜色');
    colorLabel.append(api.createLiteratureNoteFormatIcon(doc, 'color'));
    const color = doc.createElement('select');
    color.setAttribute('aria-label', translate('文字颜色'));
    color.add(new Option(translate('文字颜色'), ''));
    for (const [key, label] of Object.entries({black:'黑色',red:'红色',orange:'橙色',green:'绿色',blue:'蓝色',purple:'紫色'})) {
      color.add(new Option(translate(label), key));
    }
    on(color, 'mousedown', capture);
    on(color, 'change', () => { if (color.value) command('foreColor', rich ? colors[color.value] : color.value); color.value = ''; });
    colorLabel.append(color);
    textGroup.append(colorLabel);
    const listGroup = group('列表与缩进');
    for (const [icon, label, cmd] of [
      ['bullet','设置无序列表','insertUnorderedList'], ['ordered','设置有序列表','insertOrderedList'],
      ['indent','增加列表缩进','indent'], ['outdent','减少列表缩进','outdent']
    ]) button(listGroup, label, icon, () => command(cmd));
    const insertGroup = group('插入内容');
    insertButton(insertGroup, 'citation', '插入原文引文');
    insertButton(insertGroup, 'image', '插入图片');
    insertButton(insertGroup, 'table', '插入表格');
    const clearGroup = group('清空');
    clearGroup.classList.add('is-clear');
    insertButton(clearGroup, 'clear', '清空此字段');
    const tableTools = api.attachLiteratureNoteTableTools({surface, on, restore, commit, canEdit, translate, announce});

    function insert(text, saved=range, {replaceAll=false}={}) {
      if (!rich) return sourceEditor.replaceRange(text);
      if (replaceAll) { saved=doc.createRange(); saved.selectNodeContents(surface); }
      const box=doc.createElement('div');
      box.append(api.renderLiteratureNoteMarkdown(doc,text));
      const newTable = box.childElementCount === 1 && box.firstElementChild.tagName === 'TABLE'
        ? box.firstElementChild : null;
      if (newTable) {
        // Markdown cannot represent a table nested in a cell. Insert a sibling
        // table instead, then put the caret in its first data cell.
        newTable.dataset.noteTableInsert = '';
        const anchor = saved?.startContainer;
        const table = (anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest('table');
        if (table && surface.contains(table)) {
          saved = doc.createRange();
          saved.setStartAfter(table);
          saved.collapse(true);
        }
      }
      restore(saved);
      // Inline inserts must remain at the caret inside the current paragraph/table cell.
      if(box.children.length===1&&box.firstChild.tagName==='P')box.replaceChildren(...box.firstChild.childNodes);
      const walker=doc.createTreeWalker(box,4);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
      for(const n of nodes){const re=/\((p-[a-f0-9]{16}|pdf-paragraph:[a-f0-9]{16})\)/g;let m,at=0;const f=doc.createDocumentFragment();while((m=re.exec(n.textContent))){f.append(n.textContent.slice(at,m.index));const b=doc.createElement('button');b.type='button';b.contentEditable='false';b.dataset.noteSourceId=m[1];b.className='literature-note-source-square';b.textContent='•';f.append(b);at=re.lastIndex;}if(at){f.append(n.textContent.slice(at));n.replaceWith(f);}}
      // Chrome discards an image with no src during insertHTML. A local placeholder
      // keeps the ID-bearing node intact until the existing asset loader resolves it.
      for(const img of box.querySelectorAll('img[data-note-image]')){img.src=api.literatureNoteImagePlaceholder;img.dataset.notePendingImage='';}
      if(!doc.execCommand('insertHTML',false,box.innerHTML)){status.textContent='光标位置不可编辑，请重新点击字段后插入。';return false;}
      for(const img of surface.querySelectorAll('[data-note-pending-image]')){img.removeAttribute('src');delete img.dataset.notePendingImage;}
      if (newTable) {
        const inserted = surface.querySelector('table[data-note-table-insert]');
        if (inserted) {
          delete inserted.dataset.noteTableInsert;
          const firstCell = (inserted.rows[1] || inserted.rows[0])?.cells[0];
          if (firstCell) {
            const caret = doc.createRange();
            caret.selectNodeContents(firstCell);
            caret.collapse(true);
            restore(caret);
          }
        }
      }
      capture();
      return commit();
    }
    function removeCitation(chip) {
      if (!canEdit() || !surface.contains(chip)) return false;
      const selection = doc.createRange();
      selection.selectNode(chip);
      restore(selection);
      return doc.execCommand('delete') && commit();
    }
    // Look across inline formatting and empty caret anchors, but never cross a
    // paragraph or table-cell boundary to delete a reference on another line.
    function adjacentCitation(caret, backwards) {
      const node = caret.startContainer, offset = caret.startOffset;
      const element = node.nodeType === 1 ? node : node.parentElement;
      const block = element.closest('p,div,li,th,td') || surface;
      const hasText = value => value.replace(/\u200b/g, '').length > 0;
      if (node.nodeType === 3 && hasText(backwards ? node.data.slice(0, offset) : node.data.slice(offset))) return null;
      function neighbor(from) {
        for (let part = from; part && part !== block; part = part.parentNode) {
          const sibling = backwards ? part.previousSibling : part.nextSibling;
          if (sibling) return sibling;
        }
        return null;
      }
      let candidate = node.nodeType === 1 && node.childNodes[backwards ? offset - 1 : offset];
      candidate ||= neighbor(node);
      while (candidate) {
        if (candidate.nodeType === 1) {
          if (candidate.matches('[data-note-citation-chip]')) return candidate;
          if (candidate.matches('br,img,p,div,li,table,td,th,[contenteditable=false]')) return null;
          const child = backwards ? candidate.lastChild : candidate.firstChild;
          if (child) { candidate = child; continue; }
        } else if (hasText(candidate.textContent)) return null;
        candidate = neighbor(candidate);
      }
      return null;
    }
    on(surface, 'beforeinput', event => {
      if (!canEdit() || !['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) return;
      const selection = doc.getSelection();
      if (!selection?.isCollapsed || !selection.rangeCount) return;
      const chip = adjacentCitation(selection.getRangeAt(0), event.inputType === 'deleteContentBackward');
      if (chip) { event.preventDefault(); removeCitation(chip); }
    });
    on(surface, 'keydown', event => {
      const chip = event.target.closest('[data-note-citation-chip]');
      if (chip && ['Backspace','Delete'].includes(event.key) && canEdit()) {
        event.preventDefault();
        removeCitation(chip);
      }
    });
    on(surface, 'input', () => { commit(); capture(); });
    on(surface, 'compositionstart', () => { composing = true; });
    on(surface, 'compositionend', () => { composing = false; commit(); capture(); });
    on(doc, 'selectionchange', capture);
    const activate = event => {
      element.dataset.active = String(element.contains(event.target) || event.target === textarea);
    };
    on(doc, 'focusin', activate);
    on(doc, 'pointerdown', activate, true);
    on(surface,'paste',e=>{if([...e.clipboardData.items].some(i=>i.kind==='file'&&i.type.startsWith('image/')))return;e.preventDefault();restore();doc.execCommand('insertText',false,e.clipboardData.getData('text/plain'));commit();});
    on(surface,'drop',e=>e.preventDefault());
    on(textarea,'input',refresh);
    const observer=new MutationObserver(refresh);observer.observe(textarea,{attributes:true,attributeFilter:['disabled','readonly']});
    refresh();if(rich)draw();
    return {element,surface,refresh,capture,insert,commit,announce,removeCitation,get composing(){return composing;},get rich(){return rich;},bookmark(){capture();return range?.cloneRange();},focus(){rich?restore():textarea.focus({preventScroll:true});},canSetPreview:()=>!composing,
      setPreview(next){if(composing||rich&&!commit())return false;if (rich !== Boolean(next)) textarea.dispatchEvent(new Event('brevess-note-view-change'));
        tableTools.clear();rich=Boolean(next);refresh();if(rich)draw();return true;},destroy(){destroyed=true;textarea.dispatchEvent(new Event('brevess-note-view-change'));tableTools.clear();observer.disconnect();listeners.forEach(f=>f());element.remove();textarea.hidden=false;}};
  };
})();
