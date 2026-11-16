'use strict';
(() => {
  const toggle = document.querySelector('#language');
  const translated = [...document.querySelectorAll('[data-en]')];
  translated.forEach(el => { el.dataset.zh = el.textContent; });
  function setLanguage(next) {
    document.documentElement.lang = next;
    const en = next === 'en';
    translated.forEach(el => { el.textContent = el.dataset[en ? 'en' : 'zh']; });
    toggle.textContent = en ? '中' : 'EN';
    toggle.setAttribute('aria-label', en ? '切换到中文' : 'Switch to English');
    document.title = en ? 'BREVESS — Paper reading & research planning' : 'BREVESS — 论文阅读与课题工作台';
    document.querySelector('.nav .brand').setAttribute('aria-label', en ? 'BREVESS home' : 'BREVESS 首页');
    document.querySelector('.nav nav').setAttribute('aria-label', en ? 'Main navigation' : '主导航');
    document.querySelector('.footer nav').setAttribute('aria-label', en ? 'More information' : '更多信息');
    document.querySelectorAll('.close-dialog').forEach(button => button.setAttribute('aria-label', en ? 'Close' : '关闭'));
    document.dispatchEvent(new Event('brevess-languagechange'));
    try { localStorage.setItem('brevess-site-language', next); } catch { /* Optional preference. */ }
  }
  toggle.addEventListener('click', () => setLanguage(document.documentElement.lang === 'en' ? 'zh-CN' : 'en'));
  try { if (localStorage.getItem('brevess-site-language') === 'en') setLanguage('en'); } catch { /* Optional preference. */ }
  document.querySelectorAll('[data-dialog]').forEach(button => {
    button.addEventListener('click', () => document.getElementById(button.dataset.dialog).showModal());
  });
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('.close-dialog').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
})();
