import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { loadArticle } from '../verify-live-figure-extension.mjs';

const legacyPanels = {1: Array.from({length:26}, (_,i)=>String.fromCharCode(65+i)),
  2: Array.from({length:11}, (_,i)=>String.fromCharCode(65+i))};
function fail(code) { throw Object.assign(new Error(code), {code}); }
function publicUrl(value, code) {
  let url;
  try { url = new URL(value); } catch { fail(code); }
  if (url.protocol !== 'https:' || url.username || url.password) fail(code);
  url.hash = '';
  return url.href;
}
function jsonFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('invalid input');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
// Comparison against a read-only DOM observation, not a cryptographic attestation.
export function captionFingerprint(text) {
  let hash = 2166136261;
  for (let i=0; i<text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash,16777619);
  }
  return (hash >>> 0).toString(16).padStart(8,'0');
}
export function mechanismSourcePlan(raw) {
  const code = 'LIVE_MECHANISM_SOURCE_MANIFEST_INVALID';
  if (!raw || raw.schemaVersion !== 1 || typeof raw.title !== 'string' ||
      !raw.title.trim() || !Array.isArray(raw.figures) ||
      !raw.figures.length || raw.figures.length > 64) fail(code);
  const url = publicUrl(raw.url,code);
  const sources = new Set(), labels = new Set();
  const figures = raw.figures.map(f => {
    if (!f || typeof f.sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(f.sourceId) ||
        !/^Figure (?:S)?[1-9][0-9]{0,2}$/.test(f.label) ||
        typeof f.title !== 'string' || !f.title.trim() ||
        !/^[a-f0-9]{8}$/.test(f.captionFingerprint) ||
        !Number.isSafeInteger(f.captionLength) || f.captionLength < 1 ||
        !Array.isArray(f.expectedPanels) || !f.expectedPanels.length ||
        f.expectedPanels.length > 52 || f.expectedPanels.some(p=>!/^([A-Z]{1,2})$/.test(p)) ||
        new Set(f.expectedPanels).size !== f.expectedPanels.length ||
        sources.has(f.sourceId) || labels.has(f.label)) fail(code);
    sources.add(f.sourceId); labels.add(f.label);
    return {...f, expectedPanels:[...f.expectedPanels]};
  });
  const expectedPanelTotal = figures.reduce((sum,f)=>sum+f.expectedPanels.length,0);
  if (raw.expectedPanelTotal !== expectedPanelTotal) fail(code);
  return {url,title:raw.title,figures,expectedPanelTotal};
}
export function matchMechanismFigureCards(cards, figures) {
  if (cards.length !== figures.length) fail('LIVE_MECHANISM_FIGURE_CARD_COUNT_INVALID');
  const result = {}, used = new Set();
  for (const f of figures) {
    const matches = cards.filter(c => String(c.label).match(/\bFigure\s+(S?\d+)\b/i)?.[0]
      .replace(/\s+/g,' ').toLowerCase() === f.label.toLowerCase());
    if (matches.length !== 1 || !matches[0].id || used.has(matches[0].id)) {
      fail('LIVE_MECHANISM_FIGURE_CARD_ID_INVALID');
    }
    used.add(matches[0].id);
    result[f.sourceId] = matches[0].id;
  }
  return result;
}
function figurePayload(body) {
  const payloads=[];
  function visit(value,depth=0) {
    if (depth>12) return;
    if (typeof value==='string' && value.length<3000000 && value.includes('figure_id')) {
      try {
        const parsed=JSON.parse(value);
        if (parsed && typeof parsed.figure_id==='string') payloads.push(parsed);
      } catch {}
    } else if (Array.isArray(value)) value.forEach(v=>visit(v,depth+1));
    else if (value && typeof value==='object') Object.values(value).forEach(v=>visit(v,depth+1));
  }
  visit(body);
  if (payloads.length!==1) fail('LIVE_MECHANISM_FIGURE_REPLAY_SOURCE_MISMATCH');
  return payloads[0];
}
export function assertFigureReplaySource(entries, article) {
  const labels = new Set(article.figures.map(f=>f.label));
  const seen = new Set();
  for (const entry of entries) {
    const payload = figurePayload(entry.requestBody);
    if (payload.article_title !== article.title.slice(0,500) ||
        !labels.has(payload.figure_label)) fail('LIVE_MECHANISM_FIGURE_REPLAY_SOURCE_MISMATCH');
    seen.add(payload.figure_label);
  }
  if (seen.size!==labels.size) fail('LIVE_MECHANISM_FIGURE_REPLAY_SOURCE_MISMATCH');
}
export function assertFigureReplaySemanticMatch(actual, saved) {
  // Keep source text, captions, all prior Panel evidence and schemas strict. No identity drift exemption.
  if (!isDeepStrictEqual(figurePayload(actual),figurePayload(saved))) {
    fail('LIVE_MECHANISM_FIGURE_REPLAY_SOURCE_MISMATCH');
  }
}
export function loadMechanismArticle(articlePath, manifestPath = '') {
  if (!manifestPath) {
    const article = loadArticle(articlePath);
    return {...article, sourceMode:'legacy-two-figure-reconstructed-regression',
      expectedPanelTotal:37, figures:article.figures.map(f=>({...f,
        label:'Figure '+f.number, expectedPanels:legacyPanels[f.number]}))};
  }
  let plan;
  try { plan = mechanismSourcePlan(jsonFile(manifestPath)); }
  catch { fail('LIVE_MECHANISM_SOURCE_MANIFEST_INVALID'); }
  const code = 'LIVE_MECHANISM_ARTICLE_SOURCE_MISMATCH';
  try {
    const raw = jsonFile(articlePath);
    if (publicUrl(raw.url,code) !== plan.url || raw.title !== plan.title ||
        !Array.isArray(raw.paragraphs) || !raw.paragraphs.length ||
        !Array.isArray(raw.figures) || raw.figures.length !== plan.figures.length) fail(code);
    const paragraphs = raw.paragraphs.map(p=>{
      if (!p || typeof p.id !== 'string' || !p.id.trim() ||
          typeof p.text !== 'string' || !p.text.trim()) fail(code);
      return {id:p.id,section:String(p.section||'Article'),text:p.text};
    });
    const directory = fs.realpathSync(path.dirname(path.resolve(articlePath)));
    const figures = plan.figures.map(f=>{
      const candidates = raw.figures.filter(item => (item?.sourceId || item?.id) === f.sourceId);
      if (candidates.length !== 1) fail(code);
      const item = candidates[0];
      if (item.title !== f.title || typeof item.caption !== 'string' ||
          item.caption.length !== f.captionLength ||
          captionFingerprint(item.caption) !== f.captionFingerprint ||
          typeof item.imageFile !== 'string' || !item.imageFile) fail(code);
      const publicImageUrl = publicUrl(item.image || item.imageUrl,code);
      const candidatePath = path.resolve(directory,item.imageFile);
      const relative = path.relative(directory,candidatePath);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail(code);
      const localImagePath = fs.realpathSync(candidatePath);
      const realRelative = path.relative(directory,localImagePath);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) fail(code);
      const stat=fs.statSync(localImagePath);
      if (!stat.isFile() || stat.size < 10000 || stat.size > 12*1024*1024) fail(code);
      return {...f,number:Number(f.label.match(/\d+$/)[0]),caption:item.caption,
        publicImageUrl,localImagePath,imageBytes:fs.readFileSync(localImagePath)};
    });
    return {absolutePath:path.resolve(articlePath),title:plan.title,url:plan.url,paragraphs,
      figures,expectedPanelTotal:plan.expectedPanelTotal,sourceMode:'observed-source-bound-reconstructed-input'};
  } catch { fail(code); }
}
