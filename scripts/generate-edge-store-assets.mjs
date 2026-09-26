import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const output = path.join(root, 'docs', 'edge-store', 'assets');
fs.mkdirSync(output, { recursive: true });
const logo = fs.readFileSync(path.join(root, 'icons', 'Brevess-logo.png')).toString('base64');
const logoUrl = `data:image/png;base64,${logo}`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });

async function capture(filename, width, height, body, { transparent = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html>
    <html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}
      html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden}
      body{font-family:"Segoe UI","Microsoft YaHei",Arial,sans-serif}
      ${body.css || ''}
    </style></head><body>${body.html || ''}</body></html>`);
  await page.screenshot({
    path: path.join(output, filename),
    omitBackground: transparent
  });
}

await capture('store-logo-300.png', 300, 300, {
  css: 'body{display:grid;place-items:center;background:transparent}img{width:284px;height:284px;object-fit:contain}',
  html: `<img src="${logoUrl}" alt="">`
}, { transparent: true });

await capture('small-tile-440x280.png', 440, 280, {
  css: `
    body{display:flex;align-items:center;gap:24px;padding:30px;background:#f5f7f8;color:#0b3658}
    .logo{width:126px;height:126px;object-fit:contain;filter:drop-shadow(0 12px 22px rgba(11,71,120,.18))}
    h1{margin:0 0 8px;font-size:31px;line-height:1;font-weight:760;letter-spacing:.2px}
    p{margin:0;color:#537085;font-size:16px;line-height:1.45}
    .accent{width:72px;height:6px;margin-top:18px;border-radius:99px;background:#ffb514}
  `,
  html: `<img class="logo" src="${logoUrl}" alt="">
    <div><h1>Brevess</h1><p>论文阅读助手<br>Evidence-aware reading</p><div class="accent"></div></div>`
});

await capture('large-tile-1400x560.png', 1400, 560, {
  css: `
    body{position:relative;display:flex;align-items:center;padding:70px 100px;background:#f5f7f8;color:#0b3658}
    body:after{content:"";position:absolute;right:-70px;bottom:-130px;width:520px;height:520px;border-radius:50%;background:#e7f1f7}
    .logo{position:relative;z-index:1;width:250px;height:250px;object-fit:contain;filter:drop-shadow(0 18px 30px rgba(11,71,120,.18))}
    .copy{position:relative;z-index:1;margin-left:74px}
    .kicker{margin:0 0 14px;color:#2774a6;font-size:22px;font-weight:700;letter-spacing:2px}
    h1{margin:0;font-size:58px;line-height:1.08;font-weight:760}
    .sub{margin:18px 0 28px;color:#537085;font-size:25px}
    .pills{display:flex;gap:12px}
    .pill{padding:10px 16px;border:1px solid #bfd3df;border-radius:999px;background:#fff;font-size:18px;font-weight:650}
    .pill.accent{border-color:#ffb514;background:#fff8df}
  `,
  html: `<img class="logo" src="${logoUrl}" alt="">
    <div class="copy"><p class="kicker">BREVITY · EVIDENCE · ESSENCE</p>
    <h1>Brevess</h1>
    <p class="sub">导航论文、定位证据、解读图表、追问全文</p>
    <div class="pills"><span class="pill">论文导航</span><span class="pill accent">证据高亮</span>
    <span class="pill">Figure / Panel</span><span class="pill">全文问答</span></div></div>`
});

await browser.close();
process.stdout.write(`${output}\n`);
