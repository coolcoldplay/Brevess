import { projectFile } from './project-paths.cjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\((https:\/\/[^)]+|mailto:[^)]+)\)/g, '<a href="$2">$1</a>');
// Small renderer for this policy's headings, paragraphs and lists.
const blocks = fs.readFileSync(projectFile('docs/privacy-policy.md'),'utf8').trim().split(/\n\s*\n/);
const body = blocks.map(block => {
  const heading = block.match(/^(#{1,2}) (.*)$/s);
  if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
  if (block.startsWith('- ')) return `<ul>${block.split('\n- ').map(x=>`<li>${inline(x.replace(/^- /,''))}</li>`).join('')}</ul>`;
  return `<p>${inline(block)}</p>`;
}).join('\n');
const html = `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Brevess Chrome and Edge privacy policy"><title>Brevess Privacy Policy / 隐私政策</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f7f9;color:#243442;font:16px/1.75 system-ui,-apple-system,sans-serif}main{max-width:940px;margin:32px auto;padding:36px 48px;background:white;border:1px solid #d9e2e8;border-radius:16px}h1{color:#104f7d;font-size:30px;line-height:1.3;border-bottom:4px solid #f7b51b;padding-bottom:24px}h2{margin-top:36px;color:#104f7d;font-size:21px}a{color:#104f7d;overflow-wrap:anywhere}li{margin:10px 0}code{font-size:.9em;background:#edf3f7;padding:2px 4px;overflow-wrap:anywhere}footer{border-top:1px solid #d9e2e8;padding-top:20px;margin-top:32px;color:#5d6c79}@media(max-width:640px){main{margin:0;padding:24px 20px;border:0;border-radius:0}h1{font-size:26px}}
</style></head><body><main>${body}<footer>Brevess · Brevity · Evidence · Essence</footer></main></body></html>\n`;
fs.writeFileSync(projectFile('docs/privacy-policy.html'),html);
console.log('Rendered docs/privacy-policy.html from docs/privacy-policy.md');
