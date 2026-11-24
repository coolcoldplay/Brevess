// Serialize expensive bitmap jobs across tabs. Nothing is fetched by this host.
(() => {
  let pending = 0, tail = Promise.resolve();
  function run(job) {
    return new Promise((resolve,reject) => {
      const worker = new Worker(chrome.runtime.getURL('core/web-panel-worker.js'));
      const timer = setTimeout(() => finish(new Error('Panel 识别超时，可以重试')), 30000);
      function finish(error,model) {
        clearTimeout(timer); worker.terminate();
        if (error) reject(error); else resolve(model);
      }
      worker.onmessage = e => e.data?.error ? finish(new Error(e.data.error)) : finish(null,e.data);
      worker.onerror = () => finish(new Error('Panel 图像分析器无法启动'));
      try { worker.postMessage(job); } catch(e) { finish(e); }
    });
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply) => {
    if (msg?.target !== 'brevess-web-panel-worker' || !isBackgroundNetworkSender(sender)) return false;
    if (pending >= 6) { reply({error:'其他 Figure 正在提取，请稍后重试'}); return false; }
    pending++;
    const task = tail.then(() => run(msg.job));
    tail = task.catch(() => {}).finally(() => pending--);
    task.then(result => reply({result}), e => reply({error:e.message}));
    return true;
  });
})();
