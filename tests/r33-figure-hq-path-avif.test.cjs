'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source.js');
const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');
// Complete opaque single-item AVIF, generated locally with the existing
// @napi-rs/canvas 0.1.100. Embedded so tests do not depend on ignored output files.
const original = Buffer.from('AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUEAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAGIAAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAUAAAADwAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgSAAAAAAABNjb2xybmNseAACAAIAAoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAGptZGF0EgAKBjgh5/3sEjJWE0ADzxBhQNf/L/fQRXkEOrzkh/8+1gTTb5BHP8BJOo+VBbhEy3LZKxyakaiwoGD4vgsU9Yu8KjncIU/4YvP1YzLmP1STNXbpcYWhJCWk53wbun1ADMA=', 'base64');
const plain = value => JSON.parse(JSON.stringify(value));
function parser() {
  const c = vm.createContext({ Uint8Array, DataView, Math, Number,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520, FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192, FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000 });
  for (const name of ['figureImageError', 'admitFigureImageDimensions', 'readFigureAvifDimensions']) vm.runInContext(functionSource(source, name), c);
  return bytes => c.readFigureAvifDimensions(new Uint8Array(bytes));
}
const changed = mutate => { const bytes = Buffer.from(original); mutate(bytes); return bytes; };

test('R33 bounded AVIF preflight identifies the primary still AV1 image before browser decoding', () => {
  assert.deepEqual(plain(parser()(original)), { width: 320, height: 240 });
});

for (const [name, mutate] of [
  ['oversize primary width', b => b.writeUInt32BE(8193, 196)],
  ['oversize primary pixel area', b => { b.writeUInt32BE(5001, 196); b.writeUInt32BE(8000, 200); }]
]) test(`R33 AVIF ${name} fails the unchanged source limits before decoding`, () => {
  assert.throws(() => parser()(changed(mutate)), { code: 'FIGURE_IMAGE_TOO_LARGE' });
});

for (const [name, mutate] of [
  ['sequence brand', b => b.write('avis', 8, 'ascii')],
  ['wrong primary item', b => b.writeUInt16BE(2, 96)],
  ['unbound primary ispe', b => { b[270] = 2; b[271] = 3; b[272] = 4; b[273] = 4; }],
  ['property index outside ipco', b => { b[270] = 99; }],
  ['mdat extent outside file', b => b.writeUInt32BE(20971520, 124)],
  ['ispe versus AV1 size mismatch', b => b.writeUInt32BE(319, 196)],
  ['truncated box length', b => b.writeUInt32BE(999999, 32)],
  ['bad AV1 OBU size', b => { b[285] = 127; }],
  ['forbidden OBU bit', b => { b[284] |= 128; }],
  ['non-AV1 primary item', b => b.write('grid', 158, 'ascii')]
]) test(`R33 AVIF preflight rejects ${name} without using browser dimensions as proof`, () => {
  assert.throws(() => parser()(changed(mutate)), { code: 'FIGURE_IMAGE_INVALID' });
});

test('R33 AV1 sequence max dimensions cannot hide an allocation bomb behind a small ispe', () => {
  const bytes = Buffer.from(original), bits = [];
  const put = (value, width) => { for (let n = width - 1; n >= 0; n--) bits.push((value >>> n) & 1); };
  put(1, 3); put(1, 1); put(1, 1); put(0, 5); // matching profile, still/reduced header, level
  put(13, 4); put(7, 4); put(8192, 14); put(239, 8);
  bytes.fill(0, 286, 292);
  bits.forEach((bit, index) => { bytes[286 + (index >> 3)] |= bit << (7 - (index & 7)); });
  assert.throws(() => parser()(bytes), { code: 'FIGURE_IMAGE_TOO_LARGE' });
});

test('R33 AVIF preflight rejects source bytes over the existing 20 MiB cap', () => {
  assert.throws(() => parser()(new Uint8Array(20971521)), { code: 'FIGURE_IMAGE_TOO_LARGE' });
});

test('R33 AVIF provider payloads remain outside the JPEG/PNG/WebP model contract', () => {
  const c = vm.createContext({ FIGURE_IMAGE_MAX_BYTES: 1572864 });
  for (const name of ['figureImageError', 'validateFigureProviderImage']) vm.runInContext(functionSource(source, name), c);
  assert.throws(() => c.validateFigureProviderImage({ mediaType: 'image/avif', dataUrl: 'data:image/avif;base64,' + original.toString('base64') }),
    { code: 'FIGURE_IMAGE_INVALID' });
});
