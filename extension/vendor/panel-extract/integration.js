/* Host adapter for the BREVESS PDF reader. The standalone editor only sees a
 * File from the owning reader. Persist rectangles, not duplicate PDF images. */
const BrevessPanelEditor = (() => {
  const store = SciLLM.PdfPanelEvidence;
  function restore(job, rec) {
    const row = job.priorRecords?.get(store.key(rec));
    if (!row?.edit) return;
    rec.brevessKey = row.key;
    rec.edit = row.edit;
    Object.assign(rec, row.restore);
  }
  async function record(job, rec, model, manual = false) {
    if (!job.hash) return;
    const page = job.pages[rec.page - 1], pixels = [model.source.width, model.source.height];
    const panels = model.items.flatMap((item, id) => {
      if (item.whole) return [];
      const box = PanelOutput.bounds(model,id,0);
      const rect = store.pageRect(box, rec.box, pixels, [page.w,page.h]);
      if (!rect) return [];
      const evidence = PaperCaption.forItem(rec.evidence,item);
      const issues = (rec.fusion?.issues || []).filter(i => !i.label || i.label === item.label);
      return [{label:item.label, rect, pixelBox:box, mask:PanelOutput.cropMask(model,id,box), authorText:evidence.targetText,
        legend:evidence.sharedLegend, members:item.members || [], needsReview:!!(rec.uncertain || item.review || issues.length),
        ambiguous:issues.some(i => ['anchor-ambiguous','figure-location','candidate-conflict'].includes(i.code))}];
    });
    const row = {key:store.key(rec),figureId:store.figureId(rec), name:rec.name, title:rec.evidence?.title || '',
      page:rec.page,captionPage:rec.captionPage || null,pageSize:[page.w,page.h], figureBox:rec.box.slice(),
      verifiedPage:!!(rec.evidence?.figureId===store.figureId(rec) && rec.evidence.complete && !rec.uncertain &&
        rec.evidence.expected?.length && rec.evidence.expected.every(l => panels.some(p=>p.label.toUpperCase()===l)) &&
        !rec.fusion?.issues?.some(i => ['missing-label','figure-location','candidate-conflict','expansion-conflict'].includes(i.code))),
      sourcePixels:pixels, panels, issues:rec.fusion?.issues || []};
    if (manual) {
      const settings = rec.saved || {};
      row.restore = {name:rec.name, page:rec.page,box:rec.box.slice(),manualRegion:!!rec.manualRegion,
        resolution:rec.resolution,fusion:rec.fusion,uncertain:!!rec.uncertain,
        saved:{items:structuredClone(model.items),pad:settings.pad || 0,paper:settings.paper || 'paper'}};
    }
    const saved = await store.put(job.hash,row,manual,rec.edit);
    if (manual) rec.edit = saved.edit;
  }
  async function save() {
    try {
      await PaperBatch.saveCurrent();
      PanelEditor.status('Panel 校正已保存到这份 PDF。','ok');
    } catch(e) { PanelEditor.status(e.message,'warn'); throw e; }
  }
  function ready() {
    document.getElementById('persistCorrections').onclick = () => save().catch(() => {});
    globalThis.BrevessPanelFrame = {
      async load(file,hash,preferred,indexOnly) {
        const existing = await store.read(hash);
        return PaperBatch.load(file,{hash,preferred,indexOnly,priorRecords:new Map(existing.figures.map(r => [r.key,r]))});
      },
      select: (id,label) => PaperBatch.selectEvidence(id,label),
      save
    };
  }
  document.addEventListener('DOMContentLoaded',ready,{once:true});
  return {restore,record};
})();
