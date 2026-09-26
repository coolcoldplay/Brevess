const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractFigureTitle,
  extractArticleFiguresFromRecords,
  splitFigureCaptionByPanelGroups
} = require('../core/figure-extractor.js');

for (const { name, label, caption, title, translatedTitle = '' } of [
  {
    name: 'S3 title ending in a digit before adjacent publisher controls',
    label: 'Figure S3',
    caption: 'Figure S3. Nefh expression in Vglut2+ neurons at day 3Show full captionFigure viewer(A) Quantification.',
    title: 'Nefh expression in Vglut2+ neurons at day 3'
  },
  {
    name: 'main Figure title beside a hide-caption control',
    label: 'Figure 2',
    caption: 'Figure 2. ERK1/2-dependent responseHide full captionFigure viewer (A-C) Validation.',
    title: 'ERK1/2-dependent response'
  },
  {
    name: 'bilingual supplemental title beside English controls',
    label: 'Figure S4',
    caption: 'Figure S4. Nefh+/+ and Nefh−/− neurons 图 S4 比较 Nefh+/+ 与 Nefh−/− 神经元Show full captionFigure viewer (A) Validation.',
    title: 'Nefh+/+ and Nefh−/− neurons',
    translatedTitle: '比较 Nefh+/+ 与 Nefh−/− 神经元'
  },
  {
    name: 'Chinese title beside the show-caption label',
    label: 'Figure S5',
    caption: 'Figure S5. Imaging controls 图 S5 观察 Vglut2+ 神经元成像显示完整图注Figure viewer (A) Imaging.',
    title: 'Imaging controls',
    translatedTitle: '观察 Vglut2+ 神经元成像'
  },
  {
    name: 'Chinese title beside the hide-caption label and Panel marker',
    label: 'Figure 6',
    caption: 'Figure 6. Validation 图 6 验证 ERK1/2隐藏完整图注(A) Assay.',
    title: 'Validation',
    translatedTitle: '验证 ERK1/2'
  },
  {
    name: 'Extended Data title beside a viewer label',
    label: 'Extended Data Figure 7',
    caption: 'Extended Data Fig. 7. CX3CR1+ replicationFigure viewer (B-D) Validation.',
    title: 'CX3CR1+ replication'
  },
  {
    name: 'supplemental title beside Figure360 branding',
    label: 'Supplementary Figure S8',
    caption: 'Supplementary Figure S8. Validation at day 8Figure360 author presentation (A) Assay.',
    title: 'Validation at day 8'
  },
  {
    name: 'ordinary spaced controls retain the existing boundary',
    label: 'Figure 9',
    caption: 'Figure 9. Independent cohort Show full caption Figure viewer (A) Cohort.',
    title: 'Independent cohort'
  },
  {
    name: 'Panel boundaries remain earlier than later controls',
    label: 'Figure 10',
    caption: 'Figure 10. Vglut2+ and ERK1/2 (A-C) Nefh expressionShow full captionFigure viewer',
    title: 'Vglut2+ and ERK1/2'
  },
  {
    name: 'similar words and numeric identifiers are not control labels',
    label: 'Figure 11',
    caption: 'Figure 11. Figure3600 measurements show full captioning and figure viewers in a benchmark (A) Design.',
    title: 'Figure3600 measurements show full captioning and figure viewers in a benchmark'
  },
  {
    name: 'scientific symbols survive title cleanup',
    label: 'Figure S12',
    caption: 'Figure S12. IL-1β, p53, Ca2+ and ERK1/2 in Nefh−/− neurons (A) Assay.',
    title: 'IL-1β, p53, Ca2+ and ERK1/2 in Nefh−/− neurons'
  }
]) {
  test(`FIG-004 derived title: ${name}`, () => {
    assert.deepEqual(extractFigureTitle(caption, label), { title, translatedTitle });
  });
}

for (const label of ['Figure 3', 'Figure S3', 'Extended Data Figure 3']) {
  test(`FIG-004 keeps the complete raw caption and Panel evidence for ${label}`, () => {
    const caption = `${label}. Validation at day 3Show full captionFigure viewer (A) Nefh+/+ control. (B-C) Nefh−/− response.`;
    const captionElement = { textContent: caption, querySelector: () => null };
    const element = {
      textContent: caption,
      className: '',
      querySelector: () => captionElement,
      querySelectorAll: selector => /img|panel/i.test(selector) ? [] : [captionElement],
      getAttribute: () => '',
      closest: () => null
    };
    const [record] = extractArticleFiguresFromRecords({ querySelectorAll: () => [element] }, []);
    assert.equal(record.caption, caption);
    assert.equal(captionElement.textContent, caption);
    assert.deepEqual(record.panelHints, ['A', 'B', 'C']);
    assert.equal(extractFigureTitle(record.caption, record.figureLabel).title, 'Validation at day 3');
    assert.equal(record.caption, caption, 'deriving the title does not rewrite evidence');
    const blocks = splitFigureCaptionByPanelGroups(record.caption);
    assert.match(blocks[0].text, /3Show full captionFigure viewer$/);
    assert.deepEqual(blocks.slice(1).map(block => block.panels), [['A'], ['B', 'C']]);
    assert.match(blocks[2].text, /Nefh−\/− response\.$/u);
  });
}
