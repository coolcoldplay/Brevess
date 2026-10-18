(async () => {
  const title = document.getElementById('offlineArticleTitle');
  const status = document.getElementById('offlineArticleStatus');
  const frame = document.getElementById('offlineArticleFrame');
  const workspaceId = new URLSearchParams(location.search).get('workspaceId') || '';
  const imageDialog = document.getElementById('offlineImageDialog');
  const startReading = document.getElementById('offlineArticleStartReading');
  startReading.addEventListener('click', async () => {
    startReading.disabled = true;
    try {
      const opened = await chrome.runtime.sendMessage({ type: 'OFFLINE_READER_START_READING' });
      if (!opened?.success) throw new Error(opened?.error?.message || '保存记录暂不可用，请重新打开');
    } catch (error) { status.textContent = error.message; }
    finally { startReading.disabled = false; }
  });
  document.getElementById('offlineImageClose').addEventListener('click', () => imageDialog.close());
  document.getElementById('offlineArticleClose').addEventListener('click', () => close());
  try {
    const saved = await chrome.runtime.sendMessage({ type: 'OFFLINE_ARTICLE_GET_SNAPSHOT', readerUrl: location.href });
    if (!saved?.success || !saved.data?.binding || saved.data.binding.workspaceId !== workspaceId) {
      throw new Error(saved?.error?.message || '保存记录的文献归属未确认，请从本机历史重新打开');
    }
    const binding = saved.data.binding;
    const response = await chrome.runtime.sendMessage({
      type: 'ARTICLE_WORKSPACE_GET_ASSET',
      workspaceId,
      relativePath: 'article/offline-snapshot.html'
    });
    if (!response?.success || !response.data?.asset?.content) {
      throw new Error(response?.error?.message || '未找到离线正文快照');
    }
    if ((Number(response.data.workspaceGeneration) || 1) !== binding.workspaceGeneration ||
        response.data.asset.revision !== saved.data.assetReceipt.revision ||
        response.data.asset.contentHash !== saved.data.assetReceipt.contentHash) {
      throw new Error('这篇文献的保存版本已变化，请重新打开');
    }
    const html = String(response.data.asset.content);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    let metadata = null;
    try {
      metadata = JSON.parse(decodeURIComponent(parsed.querySelector('meta[name="brevess-offline-snapshot"]')?.content || ''));
      if (metadata.schemaVersion !== 1 || metadata.workspaceId !== workspaceId ||
          metadata.workspaceGeneration !== (Number(response.data.workspaceGeneration) || Number(response.data.asset.workspaceGeneration) || 1)) metadata = null;
    } catch (_) { metadata = null; }
    frame.srcdoc = html;
    document.documentElement.dataset.offlineWorkspaceId = binding.workspaceId;
    document.documentElement.dataset.offlineWorkspaceGeneration = String(binding.workspaceGeneration);
    const original = document.getElementById('offlineArticleOriginal');
    if (/^https?:\/\//i.test(saved.data.snapshot?.url || '')) { original.href = saved.data.snapshot.url; original.hidden = false; }
    startReading.disabled = false;
    title.textContent = parsed.title || 'Brevess 离线文献';
    status.textContent = metadata?.complete === true
      ? '已从本机恢复网页、样式与阅读图片 · 点击“查看保存记录”可在侧栏阅读已保存结果 · 离线只读'
      : metadata?.complete === false
        ? `已从本机恢复部分网页 · ${metadata.missingResources?.length ? `${metadata.missingResources.length} 项资源未保存` : '部分布局或资源完整度未确认'}，请联网后重新保存 · 保存记录可在侧栏只读查看`
        : '已从本机恢复旧网页快照 · 图片与样式完整度未记录 · 保存记录可在侧栏只读查看';
    const missingList = document.getElementById('offlineArticleMissing');
    for (const item of metadata?.missingResources || []) {
      const line = document.createElement('li');
      line.textContent = `${item.kind || '资源'}：${item.url || '嵌入资源'}（${item.reason || '未保存'}）`;
      missingList.append(line);
    }
    if (missingList.childElementCount) document.getElementById('offlineArticleReport').hidden = false;
    const imageList = document.getElementById('offlineArticleImageList');
    const seen = new Set();
    for (const source of parsed.querySelectorAll('img[src]')) {
      const dataUrl = source.getAttribute('data-brevess-original-image') || source.getAttribute('src') || '';
      if (!/^data:image\/(?:avif|gif|jpe?g|png|webp|bmp|tiff?);base64,[a-z0-9+/]+={0,2}$/i.test(dataUrl) || seen.has(dataUrl)) continue;
      seen.add(dataUrl);
      const label = source.alt || `图片 ${seen.size}`;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => {
        document.getElementById('offlineImageLabel').textContent = label;
        const preview = document.getElementById('offlineImagePreview'); preview.src = dataUrl; preview.alt = label;
        imageDialog.showModal();
      });
      imageList.append(button);
    }
    if (seen.size) document.getElementById('offlineArticleImages').hidden = false;
  } catch (error) {
    title.textContent = '无法打开离线文献';
    status.textContent = error.message;
  }
})();
void globalThis.SciLLM?.bootstrapInterfaceLanguage?.();
