/* Pinned fictional demonstration catalog; original seed.js SHA256 fea599becef2cbc21d901960aaf429eeaa270b85e512e68e25fa4177016dee19; source is preserved. */
(function(root){const resources=[
  {
    "id": "paper-a",
    "type": "paper",
    "paperId": "paper-a",
    "title": "Paper A · 刺激与因子 X",
    "subtitle": "演示论文 · 2025 · 模型 α",
    "detail": "虚构材料。核心贡献：以扰动和救援设计讨论刺激与因子 X 的关系。可借鉴对照，不等同于当前课题中的因果依据。",
    "condition": "细胞模型 α / 24 h"
  },
  {
    "id": "paper-b",
    "type": "paper",
    "paperId": "paper-b",
    "title": "Paper B · 因子 X 与表型",
    "subtitle": "演示论文 · 2026 · 模型 β",
    "detail": "虚构材料。比较不同条件下表型响应。模型 β 的阴性结果为竞争性解释保留空间。",
    "condition": "动物模型 β / 7 d"
  },
  {
    "id": "figure-a1",
    "type": "figure",
    "paperId": "paper-a",
    "figureId": "figure-a1",
    "title": "Paper A · Figure 1",
    "subtitle": "扰动 → 救援 → 条件对照",
    "panels": [
      "panel-a1a",
      "panel-a1b"
    ],
    "image": "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22480%22%20height%3D%22260%22%20viewBox%3D%220%200%20480%20260%22%3E%3Crect%20width%3D%22480%22%20height%3D%22260%22%20fill%3D%22%23f7f7f7%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%2232%22%20font-size%3D%2218%22%20font-family%3D%22sans-serif%22%20fill%3D%22%23333%22%3EFigure%201%20%C2%B7%20DEMO%3C%2Ftext%3E%3Cpath%20d%3D%22M55%2060V214H435%22%20fill%3D%22none%22%20stroke%3D%22%23444%22%20stroke-width%3D%222%22%2F%3E%3Crect%20x%3D%2290%22%20y%3D%22140%22%20width%3D%2248%22%20height%3D%2274%22%20fill%3D%22%23bbb%22%2F%3E%3Crect%20x%3D%22175%22%20y%3D%2290%22%20width%3D%2248%22%20height%3D%22124%22%20fill%3D%22%23555%22%2F%3E%3Crect%20x%3D%22260%22%20y%3D%22123%22%20width%3D%2248%22%20height%3D%2291%22%20fill%3D%22%23999%22%2F%3E%3Crect%20x%3D%22345%22%20y%3D%2268%22%20width%3D%2248%22%20height%3D%22146%22%20fill%3D%22%23333%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%22245%22%20font-size%3D%2213%22%20fill%3D%22%23777%22%20font-family%3D%22sans-serif%22%3E%E7%A4%BA%E6%84%8F%E7%B4%A0%E6%9D%90%20%C2%B7%20%E4%B8%8D%E4%BB%A3%E8%A1%A8%E7%A7%91%E7%A0%94%E7%BB%93%E6%9E%9C%3C%2Ftext%3E%3C%2Fsvg%3E",
    "detail": "演示叙事：先确认效应，再用救援排除非特异扰动。可借鉴布局，不是自己的结果。"
  },
  {
    "id": "figure-b2",
    "type": "figure",
    "paperId": "paper-b",
    "figureId": "figure-b2",
    "title": "Paper B · Figure 2",
    "subtitle": "时间序列与相反结果",
    "panels": [
      "panel-b2a",
      "panel-b2b"
    ],
    "image": "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22480%22%20height%3D%22260%22%20viewBox%3D%220%200%20480%20260%22%3E%3Crect%20width%3D%22480%22%20height%3D%22260%22%20fill%3D%22%23f7f7f7%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%2232%22%20font-size%3D%2218%22%20font-family%3D%22sans-serif%22%20fill%3D%22%23333%22%3EFigure%202%20%C2%B7%20DEMO%3C%2Ftext%3E%3Crect%20x%3D%2230%22%20y%3D%2260%22%20width%3D%22420%22%20height%3D%22145%22%20fill%3D%22%23e3e3e3%22%2F%3E%3Cg%20fill%3D%22%23999%22%3E%3Ccircle%20cx%3D%2295%22%20cy%3D%22115%22%20r%3D%2224%22%2F%3E%3Ccircle%20cx%3D%22187%22%20cy%3D%22157%22%20r%3D%2220%22%2F%3E%3Ccircle%20cx%3D%22295%22%20cy%3D%22103%22%20r%3D%2227%22%2F%3E%3Ccircle%20cx%3D%22384%22%20cy%3D%22158%22%20r%3D%2219%22%2F%3E%3C%2Fg%3E%3Ctext%20x%3D%2222%22%20y%3D%22245%22%20font-size%3D%2213%22%20fill%3D%22%23777%22%20font-family%3D%22sans-serif%22%3E%E7%A4%BA%E6%84%8F%E7%B4%A0%E6%9D%90%20%C2%B7%20%E4%B8%8D%E4%BB%A3%E8%A1%A8%E7%A7%91%E7%A0%94%E7%BB%93%E6%9E%9C%3C%2Ftext%3E%3C%2Fsvg%3E",
    "detail": "演示叙事：呈现模型 β 与模型 α 的差异，保留相反结果。"
  },
  {
    "id": "block-a",
    "type": "block",
    "paperId": "paper-a",
    "figureId": "figure-a1",
    "title": "1A–1B",
    "subtitle": "Paper A · 扰动与救援",
    "condition": "细胞模型 α / 24 h",
    "panels": [
      "panel-a1a",
      "panel-a1b"
    ],
    "detail": "演示证据：扰动降低因子 X；救援使读出恢复。充分/必要性需结合当前关系与实验条件判断。",
    "direction": "support"
  },
  {
    "id": "block-b",
    "type": "block",
    "paperId": "paper-b",
    "figureId": "figure-b2",
    "title": "2A–2B",
    "subtitle": "Paper B · 条件差异 / 相反结果",
    "condition": "动物模型 β / 7 d",
    "panels": [
      "panel-b2a",
      "panel-b2b"
    ],
    "detail": "演示相反结果：在模型 β 中，因子 X 上调未伴随表型增强。不能忽略模型与时程差异。",
    "direction": "contrary"
  },
  {
    "id": "panel-a1a",
    "type": "panel",
    "paperId": "paper-a",
    "figureId": "figure-a1",
    "title": "Paper A · 1A",
    "subtitle": "扰动设计 / 分组与对照",
    "image": "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22480%22%20height%3D%22260%22%20viewBox%3D%220%200%20480%20260%22%3E%3Crect%20width%3D%22480%22%20height%3D%22260%22%20fill%3D%22%23f7f7f7%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%2232%22%20font-size%3D%2218%22%20font-family%3D%22sans-serif%22%20fill%3D%22%23333%22%3E%E5%8E%9F%E6%96%87%20Panel%201A%20%C2%B7%20DEMO%3C%2Ftext%3E%3Cpath%20d%3D%22M55%2060V214H435%22%20fill%3D%22none%22%20stroke%3D%22%23444%22%20stroke-width%3D%222%22%2F%3E%3Crect%20x%3D%2290%22%20y%3D%22140%22%20width%3D%2248%22%20height%3D%2274%22%20fill%3D%22%23bbb%22%2F%3E%3Crect%20x%3D%22175%22%20y%3D%2290%22%20width%3D%2248%22%20height%3D%22124%22%20fill%3D%22%23555%22%2F%3E%3Crect%20x%3D%22260%22%20y%3D%22123%22%20width%3D%2248%22%20height%3D%2291%22%20fill%3D%22%23999%22%2F%3E%3Crect%20x%3D%22345%22%20y%3D%2268%22%20width%3D%2248%22%20height%3D%22146%22%20fill%3D%22%23333%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%22245%22%20font-size%3D%2213%22%20fill%3D%22%23777%22%20font-family%3D%22sans-serif%22%3E%E7%A4%BA%E6%84%8F%E7%B4%A0%E6%9D%90%20%C2%B7%20%E4%B8%8D%E4%BB%A3%E8%A1%A8%E7%A7%91%E7%A0%94%E7%BB%93%E6%9E%9C%3C%2Ftext%3E%3C%2Fsvg%3E",
    "detail": "可借鉴扰动组、载体对照和基线组安排。示意图不是实际数据。"
  },
  {
    "id": "panel-a1b",
    "type": "panel",
    "paperId": "paper-a",
    "figureId": "figure-a1",
    "title": "Paper A · 1B",
    "subtitle": "救援设计 / 统计展示",
    "image": "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22480%22%20height%3D%22260%22%20viewBox%3D%220%200%20480%20260%22%3E%3Crect%20width%3D%22480%22%20height%3D%22260%22%20fill%3D%22%23f7f7f7%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%2232%22%20font-size%3D%2218%22%20font-family%3D%22sans-serif%22%20fill%3D%22%23333%22%3E%E5%8E%9F%E6%96%87%20Panel%201B%20%C2%B7%20DEMO%3C%2Ftext%3E%3Cpath%20d%3D%22M55%2060V214H435%22%20fill%3D%22none%22%20stroke%3D%22%23444%22%20stroke-width%3D%222%22%2F%3E%3Crect%20x%3D%2290%22%20y%3D%22140%22%20width%3D%2248%22%20height%3D%2274%22%20fill%3D%22%23bbb%22%2F%3E%3Crect%20x%3D%22175%22%20y%3D%2290%22%20width%3D%2248%22%20height%3D%22124%22%20fill%3D%22%23555%22%2F%3E%3Crect%20x%3D%22260%22%20y%3D%22123%22%20width%3D%2248%22%20height%3D%2291%22%20fill%3D%22%23999%22%2F%3E%3Crect%20x%3D%22345%22%20y%3D%2268%22%20width%3D%2248%22%20height%3D%22146%22%20fill%3D%22%23333%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%22245%22%20font-size%3D%2213%22%20fill%3D%22%23777%22%20font-family%3D%22sans-serif%22%3E%E7%A4%BA%E6%84%8F%E7%B4%A0%E6%9D%90%20%C2%B7%20%E4%B8%8D%E4%BB%A3%E8%A1%A8%E7%A7%91%E7%A0%94%E7%BB%93%E6%9E%9C%3C%2Ftext%3E%3C%2Fsvg%3E",
    "detail": "可借鉴救援组及配对展示。示意图不是实际数据。"
  },
  {
    "id": "panel-b2a",
    "type": "panel",
    "paperId": "paper-b",
    "figureId": "figure-b2",
    "title": "Paper B · 2A",
    "subtitle": "时间序列 / 视觉排版",
    "image": "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22480%22%20height%3D%22260%22%20viewBox%3D%220%200%20480%20260%22%3E%3Crect%20width%3D%22480%22%20height%3D%22260%22%20fill%3D%22%23f7f7f7%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%2232%22%20font-size%3D%2218%22%20font-family%3D%22sans-serif%22%20fill%3D%22%23333%22%3E%E5%8E%9F%E6%96%87%20Panel%202A%20%C2%B7%20DEMO%3C%2Ftext%3E%3Crect%20x%3D%2230%22%20y%3D%2260%22%20width%3D%22420%22%20height%3D%22145%22%20fill%3D%22%23e3e3e3%22%2F%3E%3Cg%20fill%3D%22%23999%22%3E%3Ccircle%20cx%3D%2295%22%20cy%3D%22115%22%20r%3D%2224%22%2F%3E%3Ccircle%20cx%3D%22187%22%20cy%3D%22157%22%20r%3D%2220%22%2F%3E%3Ccircle%20cx%3D%22295%22%20cy%3D%22103%22%20r%3D%2227%22%2F%3E%3Ccircle%20cx%3D%22384%22%20cy%3D%22158%22%20r%3D%2219%22%2F%3E%3C%2Fg%3E%3Ctext%20x%3D%2222%22%20y%3D%22245%22%20font-size%3D%2213%22%20fill%3D%22%23777%22%20font-family%3D%22sans-serif%22%3E%E7%A4%BA%E6%84%8F%E7%B4%A0%E6%9D%90%20%C2%B7%20%E4%B8%8D%E4%BB%A3%E8%A1%A8%E7%A7%91%E7%A0%94%E7%BB%93%E6%9E%9C%3C%2Ftext%3E%3C%2Fsvg%3E",
    "detail": "可借鉴并列时间点与统一比例尺。示意图不是实际数据。"
  },
  {
    "id": "panel-b2b",
    "type": "panel",
    "paperId": "paper-b",
    "figureId": "figure-b2",
    "title": "Paper B · 2B",
    "subtitle": "条件对照 / 阴性结果",
    "image": "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22480%22%20height%3D%22260%22%20viewBox%3D%220%200%20480%20260%22%3E%3Crect%20width%3D%22480%22%20height%3D%22260%22%20fill%3D%22%23f7f7f7%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%2232%22%20font-size%3D%2218%22%20font-family%3D%22sans-serif%22%20fill%3D%22%23333%22%3E%E5%8E%9F%E6%96%87%20Panel%202B%20%C2%B7%20DEMO%3C%2Ftext%3E%3Cpath%20d%3D%22M55%2060V214H435%22%20fill%3D%22none%22%20stroke%3D%22%23444%22%20stroke-width%3D%222%22%2F%3E%3Crect%20x%3D%2290%22%20y%3D%22140%22%20width%3D%2248%22%20height%3D%2274%22%20fill%3D%22%23bbb%22%2F%3E%3Crect%20x%3D%22175%22%20y%3D%2290%22%20width%3D%2248%22%20height%3D%22124%22%20fill%3D%22%23555%22%2F%3E%3Crect%20x%3D%22260%22%20y%3D%22123%22%20width%3D%2248%22%20height%3D%2291%22%20fill%3D%22%23999%22%2F%3E%3Crect%20x%3D%22345%22%20y%3D%2268%22%20width%3D%2248%22%20height%3D%22146%22%20fill%3D%22%23333%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%22245%22%20font-size%3D%2213%22%20fill%3D%22%23777%22%20font-family%3D%22sans-serif%22%3E%E7%A4%BA%E6%84%8F%E7%B4%A0%E6%9D%90%20%C2%B7%20%E4%B8%8D%E4%BB%A3%E8%A1%A8%E7%A7%91%E7%A0%94%E7%BB%93%E6%9E%9C%3C%2Ftext%3E%3C%2Fsvg%3E",
    "detail": "可借鉴条件对照及阴性结果表达。示意图不是实际数据。"
  },
  {
    "id": "fragment-a",
    "type": "fragment",
    "paperId": "paper-a",
    "title": "Paper A · 机制片段",
    "subtitle": "刺激 → 因子 X · 1A–1B",
    "condition": "细胞模型 α / 24 h",
    "nodes": [
      {
        "id": "f-n1",
        "label": "刺激",
        "x": 0,
        "y": 0
      },
      {
        "id": "f-n2",
        "label": "因子 X",
        "x": 230,
        "y": 0
      }
    ],
    "edges": [
      {
        "source": "f-n1",
        "target": "f-n2",
        "claim": "调节",
        "bindings": [
          {
            "resourceId": "block-a",
            "types": [],
            "judgement": "待按当前关系复核",
            "review": true
          }
        ]
      }
    ],
    "detail": "演示整理片段。预览确认节点复用；跨条件迁入应保留待复核。"
  }
];
// This getter creates fresh builtin demonstration material for an explicit
// prototype import. It never visits or rewrites stored/imported user objects.
const displayFields=new Set(['title','subtitle','condition','detail','label','claim','judgement']);
const builtinImageIds=new Set(['figure-a1','figure-b2','panel-a1a','panel-a1b','panel-b2a','panel-b2b']);
const builtinImageLabels=['示意素材 · 不代表科研结果','原文 Panel 1A · DEMO','原文 Panel 1B · DEMO','原文 Panel 2A · DEMO','原文 Panel 2B · DEMO'];
function getResearchWorkbenchPrototypeCatalog(){
  const result=structuredClone(resources);
  if(root.SciLLM?.getInterfaceLanguage?.()!=='en')return result;
  const visit=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){
    if(displayFields.has(key)&&typeof child==='string')value[key]=root.SciLLM.translateInterfaceText?.(child,'en')||child;
    // Exact labels in this immutable builtin SVG only; never parse user images.
    else if(key==='image'&&builtinImageIds.has(value.id)&&child===resources.find(row=>row.id===value.id)?.image){
      value[key]=builtinImageLabels.reduce((image,label)=>image.replaceAll(encodeURIComponent(label),encodeURIComponent(root.SciLLM.translateInterfaceText?.(label,'en')||label)),child);
    }
    else if(child&&typeof child==='object')visit(child);
  }};
  visit(result);return result;
}
const api={getResearchWorkbenchPrototypeCatalog};if(typeof module==="object"&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis);
