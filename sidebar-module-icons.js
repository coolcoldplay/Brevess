/* Production task adapter for the selected SemanticIcons 02 / R4.3.
 * Frozen component, original SVGs and licenses: vendor/semantic-icons-r42/.
 * Task dispatch and receipts remain owned by popup.js.
 */
(function(root) {
  'use strict';
  const icons = root.SemanticIcons;
  const names = Object.freeze({ navigation: '导航', highlights: '高亮', figures: '解图', chat: '问答', notes: '笔记' });
  const states = { idle: '就绪', running: 'AI 运行中', complete: '已完成', error: '失败', cancelled: '已停止' };
  const records = new WeakMap();

  function decorate(button, key) {
    if (!Object.hasOwn(names, key)) throw new Error('Unknown module ' + key);
    if (records.has(button)) return button;
    const selected = button.getAttribute('aria-selected') === 'true';
    icons.decorate(button, key, 2);
    button.classList.add('bvi-button');
    button.dataset.bviModule = key;
    button.dataset.scheme = 'semantic-02-r43';
    button.querySelector('.sr-icon').classList.add('bvi-icon');
    button.querySelector('.sr-label')?.remove();
    button.insertAdjacentHTML('beforeend', '<span class="bvi-progress" aria-hidden="true"><span></span></span><span class="bvi-state-text"></span>');
    records.set(button, { key, state: 'idle' });
    setSelected(button, selected, true);
    setState(button, 'idle');
    return button;
  }

  function setSelected(button, selected, instant = false) {
    if (!records.has(button)) throw new Error('Decorate before setting selection');
    icons.select(button, Boolean(selected), !instant);
    button.setAttribute('aria-selected', String(Boolean(selected)));
    // These are tabs, not toggle buttons; preserve the existing tab semantics.
    button.removeAttribute('aria-pressed');
  }

  function setState(button, state, progress = null) {
    if (!Object.hasOwn(states, state)) throw new Error('Unknown status ' + state);
    const record = records.get(button);
    if (!record) throw new Error('Decorate before setting state');
    const previous = record.state;
    if (previous !== state) icons.status(button, state);
    record.state = state;
    button.dataset.status = state;
    button.dataset.indeterminate = String(state === 'running' && !Number.isFinite(progress));
    button.style.setProperty('--bvi-progress', String(Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0));
    const description = names[record.key] + '：' + states[state];
    button.setAttribute('aria-label', description);
    button.setAttribute('aria-busy', String(state === 'running'));
    button.title = description;
    button.querySelector('.bvi-state-text').textContent = states[state];
    if (previous !== state) button.dispatchEvent(new CustomEvent('bvi:statechange', {
      bubbles: true, detail: { module: record.key, status: state, previous }
    }));
  }

  root.BrevessIcons = Object.freeze({
    decorate, setSelected, setState,
    svg: key => icons.svg(key, 2),
    modules: Object.freeze(Object.keys(names)), names,
    resourceVersion: 'SemanticIcons 02 / R4.3 (Lucide, Tabler, MDI)'
  });
})(window);
