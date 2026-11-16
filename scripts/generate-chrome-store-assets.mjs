import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.BREVESS_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root,'docs/chrome-store/assets');
fs.mkdirSync(output,{recursive:true});
fs.copyFileSync(path.join(root,'icons/icon128.png'),path.join(output,'icon-128.png'));
const logo = 'data:image/svg+xml;base64,'+fs.readFileSync(path.join(root,'icons/Brevess-logo.svg')).toString('base64');
const browser = await chromium.launch({channel:'chromium',headless:true});
try {
  const page = await browser.newPage();
  for (const [filename,width,height] of [['small-tile-440x280.png',440,280],['marquee-1400x560.png',1400,560]]) {
    const small = width===440;
    await page.setViewportSize({width,height});
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;width:${width}px;height:${height}px;background:#f4f4f1;color:#171717;font-family:Arial,Helvetica,sans-serif;overflow:hidden;position:relative;padding:${small?'30px 34px':'72px 94px'}}
      .accent{position:absolute;right:0;top:0;width:${small?'12px':'24px'};height:100%;background:#ffc000}
      .brand{display:flex;align-items:center;gap:${small?18:30}px}img{width:${small?78:136}px;height:${small?78:136}px;object-fit:contain}h1{font-size:${small?36:82}px;letter-spacing:${small?1:3}px;margin:0;line-height:1}
      .line{width:${small?50:84}px;height:${small?5:8}px;background:#ffc000;margin:${small?'22px 0 18px':'36px 0 30px'}}
      p{font-size:${small?22:48}px;line-height:1.25;margin:0;font-weight:500;letter-spacing:-.02em}
      small{display:block;margin-top:${small?15:22}px;font-size:${small?11:17}px;color:#60605a;letter-spacing:.12em}
    </style></head><body><div class="accent"></div><div class="brand"><img src="${logo}" alt="BREVESS"><h1>BREVESS</h1></div><div class="line"></div><p>Read papers.<br>Keep the evidence.</p><small>BREVITY · EVIDENCE · ESSENCE</small></body></html>`);
    await page.locator('img').evaluate(img=>img.decode());
    await page.screenshot({path:path.join(output,filename)});
  }
} finally {await browser.close();}
console.log(output);
