import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let mediaViewer;
let outputUtils;
let templateAssets;
let previewFrame;
let audioField;
let videoField;
let mediaDownload;
let mediaCapabilities;
let mediaImport;
let imageArtifacts;
let imageComparison;
let runtimeOptimizations;
let server;

before(async () => {
  globalThis.window = {
    location: {
      origin: 'http://127.0.0.1:5191',
    },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  mediaViewer = await server.ssrLoadModule('/src/utils/mediaViewer.ts');
  outputUtils = await server.ssrLoadModule('/src/studio/outputUtils.ts');
  templateAssets = await server.ssrLoadModule('/src/studio/templateAssets.ts');
  previewFrame = await server.ssrLoadModule('/src/ui/PreviewFrame.tsx');
  audioField = await server.ssrLoadModule('/src/fields/UIAudioField.tsx');
  videoField = await server.ssrLoadModule('/src/fields/UIVideoField.tsx');
  mediaDownload = await server.ssrLoadModule('/src/utils/mediaDownload.ts');
  mediaCapabilities = await server.ssrLoadModule('/src/studio/mediaCapabilities.ts');
  mediaImport = await server.ssrLoadModule('/src/studio/mediaImport.ts');
  imageArtifacts = await server.ssrLoadModule('/src/utils/imageArtifacts.ts');
  imageComparison = await server.ssrLoadModule('/src/studio/imageComparison.ts');
  runtimeOptimizations = await server.ssrLoadModule('/src/studio/runtimeOptimizations.ts');
});

after(async () => {
  await server?.close();
});

test('media viewer URL sanitizer accepts media URLs and rejects executable or mismatched data URLs', () => {
  const baseUrl = 'http://127.0.0.1:8088';
  assert.equal(
    mediaViewer.sanitizeMediaViewerUrl('/cache/video/output', 'video', baseUrl),
    'http://127.0.0.1:8088/cache/video/output',
  );
  assert.equal(
    mediaViewer.sanitizeMediaViewerUrl('https://media.example/render.mp4', 'video', baseUrl),
    'https://media.example/render.mp4',
  );
  assert.equal(
    mediaViewer.sanitizeMediaViewerUrl('data:video/mp4;base64,AAAA', 'video', baseUrl),
    'data:video/mp4;base64,AAAA',
  );
  assert.equal(mediaViewer.sanitizeMediaViewerUrl('javascript:alert(1)', 'video', baseUrl), null);
  assert.equal(mediaViewer.sanitizeMediaViewerUrl('data:text/html,<script>1</script>', 'video', baseUrl), null);
  assert.equal(mediaViewer.sanitizeMediaViewerUrl('data:image/svg+xml,<svg/>', 'image', baseUrl), null);
  assert.equal(mediaViewer.sanitizeMediaViewerUrl('blob:http://127.0.0.1:8088/untrusted', 'video', baseUrl), null);
  assert.equal(mediaViewer.sanitizeMediaViewerUrl('file:///tmp/render.mp4', 'video', baseUrl), null);
});

test('media viewer item filtering drops invalid media before clamping the selected index', () => {
  const items = mediaViewer.sanitizeMediaViewerItems(
    [
      { id: 'bad', kind: 'video', label: 'Bad', url: 'javascript:alert(1)' },
      { id: 'video', kind: 'video', label: 'Video', url: '/file?file=render.mp4' },
      { id: 'text', kind: 'text', label: 'Text', text: '' },
      { id: 'missing-text', kind: 'text', label: 'Missing text' },
    ],
    'http://127.0.0.1:8088',
  );

  assert.deepEqual(
    items.map((item) => item.id),
    ['video', 'text'],
  );
  assert.equal(items[0].url, 'http://127.0.0.1:8088/file?file=render.mp4');
  assert.equal(mediaViewer.clampMediaViewerIndex(9, items.length), 1);
  assert.equal(mediaViewer.clampMediaViewerIndex(-4, items.length), 0);
  assert.equal(mediaViewer.clampMediaViewerIndex(Number.NaN, items.length), 0);
});

test('image artifacts reject executable, SVG data, file, and blob URL schemes', () => {
  const normalized = imageArtifacts.normalizeImageArtifacts({
    value: [
      '/cache/image/output',
      'https://media.example/render.webp',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'data:image/svg+xml,<svg onload="alert(1)"/>',
      'file:///tmp/render.png',
      'blob:http://127.0.0.1:5191/untrusted',
    ],
    dataType: 'url',
    mimeType: 'image/webp',
  });

  assert.deepEqual(
    normalized.map((item) => item.url),
    ['http://127.0.0.1:5191/cache/image/output', 'https://media.example/render.webp', 'data:image/png;base64,AAAA'],
  );
});

test('graph image comparison sources reject unsafe schemes before reaching image elements', () => {
  assert.equal(imageComparison.resolveGraphImageSourceUrl('javascript:alert(1)'), null);
  assert.equal(imageComparison.resolveGraphImageSourceUrl('data:image/svg+xml,<svg onload="alert(1)"/>'), null);
  assert.equal(
    imageComparison.resolveGraphImageSourceUrl('/cache/image/output'),
    'http://127.0.0.1:5191/cache/image/output',
  );
});

test('video field URL compaction removes invalid holes and arrow navigation respects media controls', () => {
  assert.deepEqual(
    mediaViewer.compactResolvedMediaUrls([null, '', '/one.mp4', 42, '/two.mp4'], (value) => `safe:${value}`),
    ['safe:/one.mp4', 'safe:/two.mp4'],
  );

  const mediaTarget = {
    closest: (selector) => (selector.includes('video') && selector.includes('[role="slider"]') ? {} : null),
  };
  assert.equal(mediaViewer.shouldIgnoreMediaViewerArrowTarget(mediaTarget), true);
  assert.equal(mediaViewer.shouldIgnoreMediaViewerArrowTarget({ closest: () => null }), false);
  assert.equal(mediaViewer.shouldIgnoreMediaViewerArrowTarget(null), false);
});

test('template defaults preview from the configured asset source after upload or refresh', () => {
  const bundledPath = '/workspace/MoDiff-client/public/template-gallery/runtime-inputs/assets/example.webp';
  const imagePath = '/template-gallery/runtime-inputs/assets/example.webp';
  const videoPath = '/template-gallery/runtime-inputs/assets/example.mp4';
  const expectedImageUrl = templateAssets.resolveTemplateAssetUrl(imagePath);
  const expectedVideoUrl = templateAssets.resolveTemplateAssetUrl(videoPath);
  assert.equal(outputUtils.bundledPublicAssetUrl(bundledPath), expectedImageUrl);
  assert.equal(outputUtils.resolveStudioImageUrl(bundledPath), expectedImageUrl);
  assert.equal(outputUtils.resolveStudioVideoUrl(videoPath), expectedVideoUrl);
  assert.equal(outputUtils.bundledPublicAssetUrl('/workspace/MoDiff/data/images/user.webp'), null);
});

test('embedded media frames opt out of graph drag, pan, and wheel capture', () => {
  const markup = renderToStaticMarkup(
    createElement(previewFrame.PreviewMediaFrame, { kind: 'audio' }, createElement('audio', { controls: true })),
  );
  assert.match(markup, /class="[^"]*nodrag[^"]*"/);
  assert.match(markup, /class="[^"]*nopan[^"]*"/);
  assert.match(markup, /class="[^"]*nowheel[^"]*"/);
});

test('cached audio previews are buffered into a seekable browser source', () => {
  assert.equal(mediaDownload.requiresSeekableAudioBuffer('/cache/node/audio/0?t=123'), true);
  assert.equal(mediaDownload.requiresSeekableAudioBuffer('http://127.0.0.1:8088/cache/node/audio/0?t=123'), true);
  assert.equal(mediaDownload.requiresSeekableAudioBuffer('/file?file=render.wav'), false);
  assert.equal(mediaDownload.requiresSeekableAudioBuffer('/template-gallery/render.wav'), false);
});

test('node audio controls retain a usable width and expose MoDiff-owned actions', () => {
  const markup = renderToStaticMarkup(
    createElement(audioField.default, {
      nodeId: 'audio-export',
      fieldKey: 'preview',
      value: '/file?file=render.wav',
      fieldOptions: {},
    }),
  );

  assert.match(markup, /class="[^"]*min-w-80[^"]*"/);
  assert.match(markup, /<audio[^>]*controlsList="nodownload noplaybackrate noremoteplayback"/);
  assert.match(markup, /aria-label="Audio actions"[^>]*class="[^"]*rounded-full[^"]*"/);
});

test('video previews expose a round MoDiff actions menu and suppress the browser original-file action', () => {
  const markup = renderToStaticMarkup(
    createElement(videoField.default, {
      nodeId: 'video-export',
      fieldKey: 'preview',
      value: '/file?file=render.mp4',
      fieldOptions: {},
    }),
  );

  assert.match(markup, /aria-label="Video actions"[^>]*class="[^"]*rounded-full[^"]*"/);
  assert.match(markup, /<video[^>]*controlsList="nodownload noremoteplayback"/);
  assert.doesNotMatch(markup, /invisible[^\"]*group-hover\/video:visible/);
});

test('audio download names preserve exported filenames and reject cache route fragments', () => {
  assert.equal(
    mediaDownload.mediaDownloadName('/file?file=%2Fdata%2Faudio%2Fmix-44k.wav', 'fallback.wav'),
    'mix-44k.wav',
  );
  assert.equal(mediaDownload.mediaDownloadName('/cache/audio-export/preview/0', 'fallback.wav'), 'fallback.wav');
});

test('media imports accept popular extension fallbacks when the browser omits MIME metadata', () => {
  assert.equal(mediaImport.inferImportedMediaKind({ name: 'mix.FLAC', type: '' }, ['audio']), 'audio');
  assert.equal(mediaImport.inferImportedMediaKind({ name: 'camera.MOV', type: '' }, ['video']), 'video');
  assert.equal(mediaImport.inferImportedMediaKind({ name: 'poster.AVIF', type: '' }, ['image']), 'image');
  assert.equal(mediaImport.inferImportedMediaKind({ name: 'notes.pdf', type: '' }, ['image']), null);
  const accept = mediaImport.mediaAcceptString(['audio', 'video']);
  assert.match(accept, /audio\/\*/);
  assert.match(accept, /\.flac/);
  assert.match(accept, /video\/\*/);
  assert.match(accept, /\.mkv/);
});

test('audio-only inputs accept MP4 audio containers without misclassifying mixed pickers', () => {
  assert.equal(mediaImport.inferImportedMediaKind({ name: 'voice-note.mp4', type: '' }, ['audio']), 'audio');
  assert.equal(mediaImport.inferImportedMediaKind({ name: 'camera.mp4', type: '' }, ['audio', 'video']), 'video');
});

test('converted downloads are offered only for backend-managed sources', () => {
  assert.equal(mediaCapabilities.canTranscodeMediaSource('http://127.0.0.1:5191/file?file=render.wav'), true);
  assert.equal(mediaCapabilities.canTranscodeMediaSource('/cache/node/audio/0'), true);
  assert.equal(mediaCapabilities.canTranscodeMediaSource('/template-gallery/render.wav'), false);
  assert.equal(mediaCapabilities.canTranscodeMediaSource('https://media.example/render.wav'), false);
});

test('media capability contracts reject malformed nested formats', () => {
  const descriptor = {
    value: 'wav',
    label: 'Wave audio',
    extension: '.wav',
    mimeType: 'audio/wav',
    sampleRates: [44100, 48000],
  };
  const payload = {
    version: 1,
    media: {
      image: {
        importExtensions: ['.png'],
        exportFormats: [{ ...descriptor, value: 'png', extension: '.png', mimeType: 'image/png' }],
      },
      video: {
        importExtensions: ['.mp4'],
        exportFormats: [{ ...descriptor, value: 'mp4', extension: '.mp4', mimeType: 'video/mp4' }],
      },
      audio: { importExtensions: ['.wav'], exportFormats: [descriptor] },
    },
  };
  assert.equal(mediaCapabilities.parseMediaCapabilities(payload).media.audio.exportFormats[0].value, 'wav');
  assert.throws(
    () =>
      mediaCapabilities.parseMediaCapabilities({
        ...payload,
        media: { ...payload.media, audio: { ...payload.media.audio, exportFormats: [null] } },
      }),
    /invalid media export format/i,
  );
  assert.throws(
    () => mediaCapabilities.parseMediaCapabilities({ ...payload, media: { image: payload.media.image } }),
    /video media capabilities/i,
  );
});

test('media export opens the native picker with its Window receiver before fetching bytes', async () => {
  const events = [];
  let written;
  const previousFetch = globalThis.fetch;
  globalThis.window.showSaveFilePicker = function () {
    assert.equal(this, globalThis.window);
    events.push('picker');
    return Promise.resolve({
      createWritable: async () => ({
        write: async (blob) => {
          events.push('write');
          written = await blob.text();
        },
        close: async () => events.push('close'),
      }),
    });
  };
  globalThis.fetch = async () => {
    events.push('fetch');
    return new Response('rendered-media', { status: 200 });
  };
  try {
    assert.equal(
      await mediaCapabilities.exportMedia('/file?file=render.wav', '../unsafe:name.wav', 'audio', null, {
        format: 'original',
      }),
      true,
    );
    assert.deepEqual(events, ['picker', 'fetch', 'write', 'close']);
    assert.equal(written, 'rendered-media');
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.window.showSaveFilePicker;
  }
});

test('cancelling the native picker does not start a media request', async () => {
  let fetched = false;
  const previousFetch = globalThis.fetch;
  globalThis.window.showSaveFilePicker = () => Promise.reject(new DOMException('Cancelled', 'AbortError'));
  globalThis.fetch = async () => {
    fetched = true;
    return new Response('unexpected');
  };
  try {
    assert.equal(
      await mediaCapabilities.exportMedia('/file?file=render.wav', 'render.wav', 'audio', null, {
        format: 'original',
      }),
      false,
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.window.showSaveFilePicker;
  }
});

test('runtime optimization contracts fail closed and documentation URLs allow only HTTP(S)', () => {
  const catalog = {
    schemaVersion: 1,
    state: { activeEnvironmentId: null, previousEnvironmentId: null, enabledCapabilities: [] },
    capabilities: [
      {
        id: 'regional_compile',
        label: 'Regional compile',
        kind: 'runtime',
        summary: 'Compile repeated regions.',
        documentation: 'https://huggingface.co/docs/diffusers/',
        compatible: true,
        disabledReason: null,
        installed: true,
        installedVersion: null,
        enabled: false,
        canInstall: false,
        canEnable: true,
        automaticEligible: true,
      },
    ],
    environments: [],
    qualification: { receiptCount: 0, qualifiedCount: 0, observedCount: 0 },
  };
  assert.equal(runtimeOptimizations.parseOptimizationCatalog(catalog).capabilities.length, 1);
  assert.throws(
    () => runtimeOptimizations.parseOptimizationCatalog({ ...catalog, capabilities: [null] }),
    /invalid optimization capability/i,
  );
  assert.equal(runtimeOptimizations.safeOptimizationDocumentationUrl('javascript:alert(1)'), null);
  assert.match(
    runtimeOptimizations.safeOptimizationDocumentationUrl('https://huggingface.co/docs/diffusers/'),
    /^https:/,
  );
});
