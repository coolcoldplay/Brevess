const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createPdfFigureNativeClient
} = require('../core/pdf-figure-native-client.js');
const {
  CodexBridgeHost,
  PdfFigureTaskStore,
  matchPdffigures2Images,
  degeneratePdffigures2Figure
} = require('../native-host/host.js');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fakeRuntime(responder) {
  const messageListeners = [];
  const disconnectListeners = [];
  const sent = [];
  const context = {
    sent,
    emit(message) {
      messageListeners.forEach(listener => listener(message));
    }
  };
  const port = {
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    postMessage(message) {
      sent.push(message);
      queueMicrotask(() => responder?.(message, context));
    },
    disconnect() { disconnectListeners.forEach(listener => listener()); }
  };
  return {
    runtime: {
      lastError: null,
      connectNative(name) {
        assert.equal(name, 'com.sci_reader.codex_bridge');
        return port;
      }
    },
    ...context
  };
}

test('PDF Figure native health is independent from Local Codex authentication', async () => {
  const fake = fakeRuntime((message, context) => {
    if (message.type !== 'pdf.figure.health') return;
    context.emit({
      type: 'pdf.figure.health.result',
      requestId: message.requestId,
      available: true,
      extractorVersion: '0.1.0-test',
      javaVersion: '1.8-test'
    });
  });
  const client = createPdfFigureNativeClient(fake.runtime);
  const result = await client.health();

  assert.equal(result.available, true);
  assert.equal(result.extractorVersion, '0.1.0-test');
  assert.deepEqual(fake.sent.map(message => message.type), ['pdf.figure.health']);
});

test('PDFFigures2 metadata is matched to whole Figure images without trusting local render URLs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdffigures2-match-'));
  const figure1 = path.join(root, 'image-paper-Figure1-1.png');
  const figureS2 = path.join(root, 'image-paper-FigureS2-1.png');
  const table1 = path.join(root, 'image-paper-Table1-1.png');
  fs.writeFileSync(figureS2, 's2');
  fs.writeFileSync(table1, 'table');
  fs.writeFileSync(figure1, 'one');

  const matched = matchPdffigures2Images([
    { figType: 'Figure', name: '1', renderURL: 'Z:\\broken\\Figure1.png' },
    { figType: 'Figure', name: 'S2', renderURL: '' },
    { figType: 'Table', name: '1', renderURL: '' }
  ], [table1, figureS2, figure1]);

  assert.equal(matched[0].imagePath, figure1);
  assert.equal(matched[1].imagePath, figureS2);
  assert.equal(matched[2].imagePath, table1);
});

test('unmatched native metadata is not silently paired with another Figure image', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdffigures2-unmatched-'));
  const figure1 = path.join(root, 'image-paper-Figure1-1.png');
  fs.writeFileSync(figure1, 'one');

  const matched = matchPdffigures2Images([
    { figType: 'Figure', name: '2', renderURL: '' }
  ], [figure1]);

  assert.equal(matched[0].imagePath, '');
});

test('tiny and footer-only PDFFigures2 crops are rejected for PDFBox recovery', () => {
  assert.equal(degeneratePdffigures2Figure({
    regionBoundary: { x1: 35, y1: 683, x2: 396, y2: 723 },
    imageText: ['Nat Neurosci. Author manuscript; available in PMC']
  }), true);
  assert.equal(degeneratePdffigures2Figure({
    regionBoundary: { x1: 30, y1: 60, x2: 570, y2: 620 },
    imageText: ['A', 'B', 'C']
  }), false);
});

test('PDF bytes upload in bounded ordered chunks before extraction starts', async () => {
  const pdfBytes = Buffer.alloc(700 * 1024, 7);
  pdfBytes.set(Buffer.from('%PDF-'), 0);
  let chunkOffset = 0;
  const fake = fakeRuntime((message, context) => {
    if (message.type === 'pdf.figure.extract.begin') {
      context.emit({
        type: 'pdf.figure.upload.ready',
        requestId: message.requestId,
        taskId: message.taskId,
        nextOffset: 0
      });
    } else if (message.type === 'pdf.figure.extract.chunk') {
      const bytes = Buffer.from(message.data, 'base64');
      assert.equal(message.offset, chunkOffset);
      chunkOffset += bytes.length;
      context.emit({
        type: 'pdf.figure.upload.ack',
        requestId: message.requestId,
        taskId: message.taskId,
        nextOffset: chunkOffset
      });
    } else if (message.type === 'pdf.figure.extract.commit') {
      context.emit({
        type: 'pdf.figure.extract.progress',
        requestId: message.requestId,
        taskId: message.taskId,
        phase: 'extracting',
        progress: 60
      });
      context.emit({
        type: 'pdf.figure.extract.result',
        requestId: message.requestId,
        taskId: message.taskId,
        figures: [{ imageId: 'image-1', byteLength: 4, sha256: sha256(Buffer.from('test')) }]
      });
    }
  });
  const client = createPdfFigureNativeClient(fake.runtime, { uploadChunkBytes: 512 * 1024 });
  const events = [];
  for await (const event of client.extract({
    pdfBytes,
    documentFingerprint: sha256(pdfBytes),
    fileName: 'paper.pdf',
    kind: 'main'
  })) events.push(event);

  assert.equal(chunkOffset, pdfBytes.length);
  assert.deepEqual(
    fake.sent.map(message => message.type),
    [
      'pdf.figure.extract.begin',
      'pdf.figure.extract.chunk',
      'pdf.figure.extract.chunk',
      'pdf.figure.extract.commit'
    ]
  );
  assert.deepEqual(events.map(event => event.type), [
    'upload_progress', 'upload_progress', 'progress', 'result'
  ]);
  assert.equal(events.at(-1).figures[0].imageId, 'image-1');
});

test('native Figure image chunks are reassembled and SHA-256 verified', async () => {
  const image = Buffer.alloc(900 * 1024, 11);
  const fake = fakeRuntime((message, context) => {
    if (message.type !== 'pdf.figure.image.read') return;
    const slice = image.subarray(message.offset, message.offset + message.length);
    context.emit({
      type: 'pdf.figure.image.chunk',
      requestId: message.requestId,
      taskId: message.taskId,
      imageId: message.imageId,
      offset: message.offset,
      nextOffset: message.offset + slice.length,
      eof: message.offset + slice.length >= image.length,
      data: slice.toString('base64')
    });
  });
  const client = createPdfFigureNativeClient(fake.runtime, { imageChunkBytes: 384 * 1024 });
  const restored = await client.readImage({
    taskId: 'task-image',
    imageId: 'figure-1',
    byteLength: image.length,
    sha256: sha256(image),
    mimeType: 'image/png'
  });

  assert.equal(Buffer.compare(Buffer.from(restored.bytes), image), 0);
  assert.equal(restored.mimeType, 'image/png');
  assert.equal(fake.sent.length, 3);
});

test('native host extracts a PDF, exposes no local paths, and releases leased images', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-figures-'));
  const sent = [];
  const inputPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1024, 3)]);
  const renderedImage = Buffer.from('whole-figure-png');
  const runner = {
    async health() {
      return { available: true, extractorVersion: 'fake-1', javaVersion: 'fake-java' };
    },
    async extract({ pdfPath, outputDirectory, signal, onProgress }) {
      assert.equal(signal.aborted, false);
      assert.equal(fs.readFileSync(pdfPath).equals(inputPdf), true);
      onProgress({ phase: 'rendering', progress: 70 });
      const imagePath = path.join(outputDirectory, 'figure-1.png');
      fs.writeFileSync(imagePath, renderedImage);
      return {
        extractorVersion: 'fake-1',
        figures: [{
          figType: 'Figure', name: '1', page: 0,
          caption: 'Figure 1. Whole Figure.',
          regionBoundary: { x1: 72, y1: 100, x2: 540, y2: 400 },
          imagePath
        }]
      };
    }
  };
  const store = new PdfFigureTaskStore({ root, runner, leaseMs: 60000 });
  const inertServer = {
    onNotification() { return () => {}; },
    close() {}
  };
  const host = new CodexBridgeHost({
    server: inertServer,
    pdfFigureStore: store,
    send(message) { sent.push(message); }
  });

  await host.handle({
    type: 'pdf.figure.extract.begin', requestId: 'begin-1', taskId: 'task-1',
    fileName: 'paper.pdf', kind: 'main', totalBytes: inputPdf.length,
    documentFingerprint: sha256(inputPdf)
  });
  await host.handle({
    type: 'pdf.figure.extract.chunk', requestId: 'chunk-1', taskId: 'task-1',
    offset: 0, data: inputPdf.toString('base64')
  });
  await host.handle({
    type: 'pdf.figure.extract.commit', requestId: 'commit-1', taskId: 'task-1'
  });

  const result = sent.find(message => message.type === 'pdf.figure.extract.result');
  assert.equal(result.figures.length, 1);
  assert.equal(result.figures[0].caption, 'Figure 1. Whole Figure.');
  assert.equal(result.figures[0].byteLength, renderedImage.length);
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal(fs.existsSync(store.taskDirectory('task-1')), true);
  assert.equal(fs.existsSync(path.join(store.taskDirectory('task-1'), 'input.pdf')), false);

  await host.handle({
    type: 'pdf.figure.image.read', requestId: 'read-1', taskId: 'task-1',
    imageId: result.figures[0].imageId, offset: 0, length: 512 * 1024
  });
  const imageChunk = sent.find(message => message.type === 'pdf.figure.image.chunk');
  assert.equal(Buffer.from(imageChunk.data, 'base64').equals(renderedImage), true);

  await host.handle({
    type: 'pdf.figure.extract.release', requestId: 'release-1', taskId: 'task-1'
  });
  assert.equal(fs.existsSync(store.taskDirectory('task-1')), false);
  host.close();
});

test('native host cancellation aborts extraction and removes the task directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-cancel-'));
  const sent = [];
  let extractionStarted;
  const started = new Promise(resolve => { extractionStarted = resolve; });
  const runner = {
    async extract({ signal }) {
      extractionStarted();
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(
          new Error('cancelled'), { code: 'PDF_FIGURE_CANCELLED' }
        )), { once: true });
      });
    }
  };
  const store = new PdfFigureTaskStore({ root, runner });
  const host = new CodexBridgeHost({
    server: { onNotification() { return () => {}; }, close() {} },
    pdfFigureStore: store,
    send(message) { sent.push(message); }
  });
  const pdf = Buffer.from('%PDF-cancel');
  await host.handle({
    type: 'pdf.figure.extract.begin', requestId: 'begin-cancel', taskId: 'cancel-1',
    totalBytes: pdf.length, documentFingerprint: sha256(pdf), fileName: 'cancel.pdf'
  });
  await host.handle({
    type: 'pdf.figure.extract.chunk', requestId: 'chunk-cancel', taskId: 'cancel-1',
    offset: 0, data: pdf.toString('base64')
  });
  const committing = host.handle({
    type: 'pdf.figure.extract.commit', requestId: 'commit-cancel', taskId: 'cancel-1'
  });
  await started;
  await host.handle({
    type: 'pdf.figure.extract.cancel', requestId: 'cancel-request', taskId: 'cancel-1'
  });
  await committing;

  assert.equal(fs.existsSync(store.taskDirectory('cancel-1')), false);
  assert.equal(sent.some(message => message.type === 'pdf.figure.extract.cancelled'), true);
  host.close();
});
