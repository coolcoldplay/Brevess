const test = require('node:test');
const assert = require('node:assert/strict');
const { createSelectionTtsController } = require('../extension/core/selection-tts.js');

const click = { isTrusted: true, type: 'click' };
function voice(name, lang = 'en-US', localService = true, isDefault = false) {
  return { name, lang, localService, default: isDefault, voiceURI: name };
}
function setup(t, voices, settings = {}, playback = u => u.onstart()) {
  const attempts = [], messages = [];
  const synth = { getVoices: () => voices, speak(u) { attempts.push(u); playback(u); }, cancel() {} };
  const controller = createSelectionTtsController({
    speechSynthesis: synth, SpeechSynthesisUtteranceCtor: class { constructor(text) { this.text = text; } },
    getLease: () => 'same', isCurrentLease: lease => lease === 'same',
    sendMessage: async m => {
      messages.push(m.type);
      if (m.type === 'TTS_GET_PUBLIC_SETTINGS') return { success: true, data: { mode: 'browser', ...settings } };
      return { success: false, error: { code: 'TTS_HTTP', details: { httpStatus: 503 } } };
    }
  });
  t.after(() => controller.destroy());
  const speak = (args = {}) => controller.speak({ text: 'Read this.', event: click, ...args });
  return { attempts, messages, controller, speak };
}

test('automatic selection skips character voices even if listed first, honors local language and rate', async t => {
  const h = setup(t, [voice('Albert', 'en-US', true, true), voice('Whisper'), voice('Google English', 'en-US', false),
    voice('Daniel', 'en-GB'), voice('Samantha'), voice('婷婷', 'zh-CN', true, true)], { speed: 1.25 });
  assert.equal(await h.speak(), true);
  assert.equal(h.attempts[0].voice.name, 'Samantha');
  assert.equal(h.attempts[0].rate, 1.25);
  h.attempts[0].onend();
  assert.equal(await h.speak({ text: '中文朗读' }), true);
  assert.equal(h.attempts[1].voice.name, '婷婷');
});
test('manual voice selection is authoritative and never silently switches on failure', async t => {
  const h = setup(t, [voice('Albert'), voice('Samantha')], { browser: { voiceEn: 'Albert' } },
    u => u.onerror({ error: 'voice-unavailable' }));
  assert.equal(await h.speak(), false);
  assert.deepEqual(h.attempts.map(u => u.voice.name), ['Albert']);
  assert.equal(h.controller.getState().errorCode, 'TTS_BROWSER_VOICE_UNAVAILABLE');
});
test('a failed automatic voice can recover before the first word, within the same language and service', async t => {
  const h = setup(t, [voice('Samantha'), voice('Daniel', 'en-GB'), voice('Google English', 'en-US', false)], {},
    u => u.voice.name === 'Samantha' ? u.onerror({ error: 'synthesis-failed' }) : u.onstart());
  assert.equal(await h.speak(), true);
  assert.deepEqual(h.attempts.map(u => u.voice.name), ['Samantha', 'Daniel']);
  h.attempts[1].onend();
  assert.equal(h.controller.getState().completedChunks, 1);
});
test('a local failure never retries with a network voice or reads with an unrelated language', async t => {
  const h = setup(t, [voice('Samantha'), voice('Cloud', 'en-US', false)], {}, u => u.onerror({ error: 'synthesis-failed' }));
  assert.equal(await h.speak(), false);
  assert.equal(h.attempts.length, 1);
  assert.equal(await h.speak({ text: '中文朗读' }), false);
  assert.equal(h.controller.getState().errorCode, 'TTS_BROWSER_LANGUAGE');
});
test('speech that already started is not replayed, and delayed autoplay cannot replace a manual read', async t => {
  const h = setup(t, [voice('Samantha'), voice('Daniel', 'en-GB')]);
  assert.equal(await h.speak(), true);
  assert.equal(await h.speak({ automatic: true }), false);
  assert.equal(h.controller.getState().status, 'playing');
  h.attempts[0].onerror({ error: 'audio-hardware' });
  assert.equal(h.controller.getState().errorCode, 'TTS_BROWSER_DEVICE');
  assert.equal(h.attempts.length, 1);
});
test('stopping while an automatic fallback is pending cancels the next attempt', async t => {
  let failed;
  const failure = new Promise(resolve => { failed = resolve; });
  const h = setup(t, [voice('Samantha'), voice('Daniel', 'en-GB')], {}, u => { u.onerror({ error: 'voice-unavailable' }); failed(); });
  const reading = h.speak();
  await failure;
  h.controller.stop();
  assert.equal(await reading, false);
  assert.equal(h.attempts.length, 1);
});
test('a service error offers local reading, which makes no synthesis request and never picks a remote voice', async t => {
  const h = setup(t, [voice('Cloud', 'en-US', false), voice('Samantha')], { mode: 'deepseek' });
  assert.equal(await h.speak(), false);
  assert.equal(h.controller.getState().canReadLocally, true);
  h.messages.length = 0;
  assert.equal(await h.speak({ localOnly: true }), true);
  assert.deepEqual(h.messages, ['TTS_GET_PUBLIC_SETTINGS']);
  assert.equal(h.attempts[0].voice.name, 'Samantha');
});
test('a pending auto-play preference check keeps the button idle so an immediate manual click starts reading', async t => {
  let returnPref;
  const selected = voice('Samantha');
  const pending = new Promise(resolve => { returnPref = resolve; });
  let count = 0;
  const controller = createSelectionTtsController({
    speechSynthesis: { getVoices: () => [selected], speak: u => u.onstart(), cancel() {} },
    SpeechSynthesisUtteranceCtor: class { constructor(text) { this.text = text; } },
    getLease: () => 'document', isCurrentLease: () => true,
    sendMessage: () => ++count === 1 ? pending : Promise.resolve({ success: true, data: { mode: 'browser' } })
  });
  t.after(() => controller.destroy());
  const automatic = controller.speak({ text: 'One sentence.', event: click, automatic: true });
  await Promise.resolve();
  assert.equal(controller.getState().status, 'idle');
  const manual = controller.speak({ text: 'One sentence.', event: click });
  returnPref({ success: true, data: { mode: 'browser', autoPlay: false } });
  assert.equal(await automatic, false);
  assert.equal(await manual, true);
  assert.equal(controller.getState().status, 'playing');
});
