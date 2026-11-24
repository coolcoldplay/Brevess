// One Figure per worker. Returning geometry keeps the full-resolution artwork
// on its owning page and frees the detector's pixel buffers on termination.
'use strict';
importScripts('web-panel-index.js','../vendor/panel-extract/engine.js', '../vendor/panel-extract/plate.js', '../vendor/panel-extract/export.js');

self.onmessage = async ({data}) => {
  let bitmap;
  try {
    const {raster, expected, direct, sourceWidth, sourceHeight} = data;
    const bytes = Uint8Array.from(atob(raster.slice(raster.indexOf(',') + 1)), c => c.charCodeAt(0));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2,'0')).join('');
    const fingerprint = hash + '-' + sourceWidth + 'x' + sourceHeight;
    if (direct) {
      self.postMessage({fingerprint, panels:[{label:direct, rect:{x:0,y:0,width:1,height:1}, method:'publisher', needsReview:false}]});
      return;
    }
    const cacheKey = ['r4-1',fingerprint,expected.join('')].join(':');
    const cached = await WebPanelIndex.read(cacheKey);
    if (cached) { self.postMessage({fingerprint,panels:cached}); return; }
    bitmap = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
    if (Math.max(bitmap.width,bitmap.height) > 1750) throw Error('Panel 分析图超出尺寸限制');
    const source = new OffscreenCanvas(bitmap.width,bitmap.height);
    source.getContext('2d').drawImage(bitmap,0,0);
    const letters = expected.join('');
    const run = letters.length >= 2 && 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.startsWith(letters) ? letters : '';
    const model = PanelEngine.analyze(source, [], [], run, {captionCandidates:!!run, matchPrintedCase:true, neutralGlyphs:true, plate:true});
    model.source = source;
    const found = model.items.map(item => item.label.toUpperCase());
    const incomplete = expected.some(letter => !found.includes(letter));
    const panels = model.items.flatMap((item,i) => {
      const label = found[i];
      if (!/^[A-Z]$/.test(label) || found.indexOf(label)!==i || !item.anchor ||
          (expected.length >= 2 && !expected.includes(label))) return [];
      const box = PanelOutput.bounds(model,i,0);
      const [x,y,w,h] = PanelOutput.asXYWH(box);
      if (w<8 || h<8 || w*h < 120) return [];
      const rect = {x:x/source.width, y:y/source.height, width:w/source.width, height:h/source.height};
      const mask = PanelOutput.cropMask(model,i,box);
      const complexMask = mask && mask.hidden.length + mask.white.length > 8000;
      const needsReview = incomplete || !expected.includes(label) || item.error > .26 || !!complexMask;
      return [{label, rect, mask:complexMask ? null : mask, method:'detected', needsReview}];
    });
    await WebPanelIndex.save(cacheKey,panels);
    self.postMessage({fingerprint,panels});
  } catch (e) { self.postMessage({error:e.message || '无法识别 Panel'}); }
  finally { bitmap?.close(); }
};
