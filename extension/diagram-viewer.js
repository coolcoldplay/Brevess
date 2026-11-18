(async function () {
  'use strict';
  const $ = id => document.getElementById(id);
  $('close').onclick = () => window.close();
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.fullscreenElement) window.close();
  });
  $('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { $('status').textContent = '可使用窗口右上角的最大化按钮展开。'; }
  };
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '全屏';
  });
  try {
    const value = await BrevessDiagramViewer.consume(location.hash.slice(1));
    $('title').textContent = value.title;
    const view = BrevessDiagramViewer.create(value.source, { expand:false, fit:true });
    $('diagram').append(view);
    if (!await view.ready) throw Error('示意图暂无法渲染，可展开图形源码查看。');
    $('status').textContent = '滚轮缩放 · 拖动平移 · 关闭后继续原对话';
    view.querySelector('.article-chat-mermaid-viewport').focus({ preventScroll:true });
    window.addEventListener('resize', () => view.fit());
  } catch (error) {
    $('title').textContent = '暂时无法打开示意图';
    $('status').textContent = error.message;
  }
})();
