(async () => {
  const title = document.getElementById('offlineArticleTitle');
  const status = document.getElementById('offlineArticleStatus');
  const frame = document.getElementById('offlineArticleFrame');
  const workspaceId = new URLSearchParams(location.search).get('workspaceId') || '';
  document.getElementById('offlineArticleClose').addEventListener('click', () => close());
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ARTICLE_WORKSPACE_GET_ASSET',
      workspaceId,
      relativePath: 'article/offline-snapshot.html'
    });
    if (!response?.success || !response.data?.asset?.content) {
      throw new Error(response?.error?.message || '未找到离线正文快照');
    }
    const html = String(response.data.asset.content);
    frame.srcdoc = html;
    title.textContent = frame.title || 'Brevess 离线文献';
    status.textContent = `已从本机恢复 · ${new Intl.NumberFormat('zh-CN').format(html.length)} 字符`;
  } catch (error) {
    title.textContent = '无法打开离线文献';
    status.textContent = error.message;
  }
})();
void globalThis.SciLLM?.bootstrapInterfaceLanguage?.();
