(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.Workbench ||= {},api);})(globalThis,()=>{
  'use strict';
  const glyphs = Object.freeze({
    'align-left': '<path d="M4 3V21"/><rect x="8" y="5" width="12" height="4"/><rect x="8" y="15" width="8" height="4"/>',
    'align-center-x': '<path d="M12 2V22"/><rect x="4" y="5" width="16" height="4"/><rect x="7" y="15" width="10" height="4"/>',
    'align-right': '<path d="M20 3V21"/><rect x="4" y="5" width="12" height="4"/><rect x="8" y="15" width="8" height="4"/>',
    'align-top': '<path d="M3 4H21"/><rect x="5" y="8" width="4" height="12"/><rect x="15" y="8" width="4" height="8"/>',
    'align-center-y': '<path d="M2 12H22"/><rect x="5" y="4" width="4" height="16"/><rect x="15" y="7" width="4" height="10"/>',
    'align-bottom': '<path d="M3 20H21"/><rect x="5" y="4" width="4" height="12"/><rect x="15" y="8" width="4" height="8"/>',
    'distribute-horizontal': '<path d="M2 4V20M22 4V20"/><rect x="5" y="7" width="2" height="10"/><rect x="11" y="7" width="2" height="10"/><rect x="17" y="7" width="2" height="10"/>',
    'distribute-vertical': '<path d="M4 2H20M4 22H20"/><rect x="7" y="5" width="10" height="2"/><rect x="7" y="11" width="10" height="2"/><rect x="7" y="17" width="10" height="2"/>',
    'distribute-horizontal-centers': '<path d="M4 3V21M12 3V21M20 3V21"/><rect x="2" y="8" width="4" height="8"/><rect x="9" y="6" width="6" height="12"/><rect x="18" y="8" width="4" height="8"/>',
    'distribute-vertical-centers': '<path d="M3 4H21M3 12H21M3 20H21"/><rect x="8" y="2" width="8" height="4"/><rect x="6" y="9" width="12" height="6"/><rect x="8" y="18" width="8" height="4"/>',
    group: '<rect x="3" y="3" width="18" height="18"/><rect x="6" y="6" width="5" height="5"/><rect x="13" y="13" width="5" height="5"/>',
    ungroup: '<rect x="3" y="3" width="18" height="18" stroke-dasharray="2 3"/><rect x="5" y="5" width="5" height="5"/><rect x="14" y="14" width="5" height="5"/>',
    copy: '<path d="M8 4H20V16"/><rect x="4" y="8" width="12" height="12"/>',
    duplicate: '<path d="M8 3H20V15"/><rect x="4" y="7" width="12" height="14"/><path d="M7 14H13M10 11V17"/>',
    'delete-selection': '<path d="M3 7H21M9 7V3H15V7M9 11V17M15 11V17"/><path d="M5 7V21H19V7"/>',
  });
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  // Extra attributes are controlled markup from the application, never user content.
  function iconButton(action,label,extra='') {
    if (!Object.prototype.hasOwnProperty.call(glyphs,action)) throw new RangeError('Unsupported workbench icon action');
    const name = escape(label);
    return `<button type="button" class="icon-button" data-action="${escape(action)}" title="${name}" aria-label="${name}"${extra ? ' '+extra : ''}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${glyphs[action]}</svg></button>`;
  }
  return {iconButton};
});
