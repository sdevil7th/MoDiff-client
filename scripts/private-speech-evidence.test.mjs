import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyPrivateSpeechConsumer } from './private-speech-evidence.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceName = 'sample-source.wav';
const status = { schemaVersion: 1, truncated: false };
const ctc = {
  type: 'HuggingFaceCTCSpeechRecognitionModel',
  repo: 'facebook/wav2vec2-base-960h',
  pin: '22aad52d435eb6dbaf354bdad9b0da84ce7d6156',
  loader: 'LoadCTCSpeechRecognitionModel',
  method: 'AutoModelForCTC',
  consumer: 'TranscribeCTCAudio',
  timestamps: 'word',
};
const whisper = {
  type: 'HuggingFaceSpeechRecognitionModel',
  repo: 'openai/whisper-tiny',
  pin: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
  loader: 'LoadSpeechRecognitionModel',
  method: 'AutoModelForSpeechSeq2Seq',
  consumer: 'TranscribeAudio',
  timestamps: 'segment',
};

function capture(route) {
  const wavBytes = Buffer.from(
    '524946462800000057415645666d74201000000001000100803e0000007d000002001000646174610400000000c00040',
    'hex',
  );
  const floats = Buffer.from('000000bf0000003f', 'hex');
  const identity = {
    kind: 'audio',
    shape: [2, 1],
    sampleRate: 16000,
    dtype: 'float32-le',
    byteSize: 8,
    sha256: sha256(floats),
  };
  const files = {
    file: [{ sourceValue: sourceName, byteSize: wavBytes.length, sha256: sha256(wavBytes), converted: false }],
  };
  const media = { schemaVersion: 1, source: 'native-builtin-media-v1', status: 'complete', controls: {} };
  const mediaSource = { ...media, inputs: {}, outputs: { audio: [identity] }, files };
  const mediaConsumer = { ...media, inputs: { audio: [structuredClone(identity)] }, outputs: {}, files: {} };
  const literal = (value) => ({ value, source: 'literal' });
  const active = (value, actual = value) => ({ disposition: 'consumed', inputValue: value, ...literal(actual) });
  const controls = {
    timestamps: active(route.timestamps, route === whisper ? true : 'word'),
    chunk_length_seconds: active(30),
    stride_length_seconds: active(5),
    ...(route === whisper
      ? {
          task: active('transcribe'),
          language: { disposition: 'inactive', inputValue: '', ...literal(''), reason: 'feature-disabled' },
        }
      : {}),
  };
  const model = {
    model_id: route.repo,
    pipeline_class: route.method,
    revision: route.pin,
    device: 'cuda:0',
    dtype: 'float32',
  };
  const pipeline = 'modules.HuggingFaceSpeech';
  const wire = (sourceId, sourceKey) => ({ display: 'input', sourceId, sourceKey });
  const graphNode = (module, action, params) => ({ module, action, params });
  const paramsFrom = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));
  const nodes = {
    'node-01': graphNode('modules.Audio', 'Load', { file: { display: 'filebrowser', value: '' } }),
    'node-02': graphNode(
      pipeline,
      route.loader,
      paramsFrom({ ...model, model_id: { source: 'hub', value: route.repo } }),
    ),
    'node-03': graphNode(pipeline, route.consumer, {
      ...paramsFrom(Object.fromEntries(Object.entries(controls).map(([key, row]) => [key, row.inputValue]))),
      audio: wire('node-01', 'audio'),
      model: wire('node-02', 'model'),
    }),
    'node-04': graphNode('modules.Primitive', 'DataViewer', { value: wire('node-03', 'transcript') }),
  };
  const expectedApi = { sid: 'test', nodes, paths: [Object.keys(nodes)] };
  const submitted = structuredClone(expectedApi);
  submitted.nodes['node-01'].params.file.value = [sourceName];
  const nodeReceipts = Object.entries(nodes).map(([nodeId, { module, action }]) => ({
    nodeId,
    module,
    action,
    fields: {},
    omittedFields: {},
  }));
  nodeReceipts[0].mediaEvidence = mediaSource;
  nodeReceipts[1].fields = Object.fromEntries(Object.entries(model).map(([key, value]) => [key, literal(value)]));
  nodeReceipts[2].fieldAccounting = {
    schemaVersion: 1,
    complete: true,
    fields: controls,
    inputProjections: {},
    outputProjections: {},
    omittedFields: {},
    unaccountedFields: [],
  };
  nodeReceipts[2].mediaEvidence = mediaConsumer;
  const output = {
    taskId: 'speech-task',
    nodeId: 'node-04',
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: 'speech-task',
      attemptIndex: 0,
      nodeId: 'node-04',
      truncated: false,
      uncapturedNodeIds: [],
      nodes: nodeReceipts,
      fieldAccountingStatus: { ...status },
      mediaEvidenceStatus: { ...status },
    },
  };
  return { workflowId: route.type + ':speech_to_text', expectedApi, submitted, output, sourceName, wavBytes };
}

test('uses bound audio and effective native controls for both supported speech-to-text recipes', () => {
  for (const route of [whisper, ctc]) {
    const checked = verifyPrivateSpeechConsumer(capture(route));
    assert.equal(checked.route.repo, route.repo);
    assert.equal(checked.wave.duration, 2 / 16000);
    assert.equal(checked.input.sourceValue, sourceName);
  }
});

test('rejects legacy speech receipts and any incomplete native accounting', () => {
  for (const route of [whisper, ctc]) {
    const older = capture(route);
    const receipt = older.output.resolvedExecutionInputs;
    delete receipt.fieldAccountingStatus;
    delete receipt.nodes[2].fieldAccounting;
    delete receipt.nodes[2].mediaEvidence;
    assert.throws(() => verifyPrivateSpeechConsumer(older), /Complete native speech control accounting/u);
    receipt.fieldAccountingStatus = { ...status };
    assert.throws(() => verifyPrivateSpeechConsumer(older), /Native speech controls differ/u);
    receipt.fieldAccountingStatus.truncated = true;
    assert.throws(() => verifyPrivateSpeechConsumer(older), /Complete native speech control accounting/u);
  }
});

test('rejects changed audio, controls, graph wiring, model pin and output ownership', () => {
  const mutations = [
    [
      'consumer hash',
      (row, read) => {
        read.nodes[2].mediaEvidence.inputs.audio[0].sha256 = '0'.repeat(64);
      },
      /same decoded audio/u,
    ],
    [
      'consumer origin',
      (row, read) => {
        read.nodes[2].fieldAccounting.fields.timestamps.source = 'override';
      },
      /speech controls differ/u,
    ],
    [
      'timestamp argument',
      (row, read) => {
        read.nodes[2].fieldAccounting.fields.timestamps.value = 'segment';
      },
      /speech controls differ/u,
    ],
    [
      'language hint',
      (row, read) => {
        read.nodes[2].fieldAccounting.fields.language.value = 'French';
      },
      /speech controls differ/u,
    ],
    [
      'audio bytes',
      (row) => {
        row.wavBytes[45] ^= 1;
      },
      /Audio.Load WAV or decoded audio differs/u,
    ],
    [
      'audio filename',
      (row) => {
        row.sourceName = '../sample-source.wav';
      },
      /plain WAV file picker name/u,
    ],
    [
      'conversion',
      (row, read) => {
        read.nodes[0].mediaEvidence.files.file[0].converted = true;
      },
      /Audio.Load WAV or decoded audio differs/u,
    ],
    [
      'loader pin',
      (row, read) => {
        read.nodes[1].fields.revision.value = '0'.repeat(40);
      },
      /loader or model pin differs/u,
    ],
    [
      'output owner',
      (row, read) => {
        read.nodeId = 'node-02';
      },
      /speech evidence owner differs/u,
    ],
    [
      'node owners',
      (row, read) => {
        read.nodes[0].nodeId = 'node-03';
      },
      /node owners are incomplete or ambiguous/u,
    ],
    [
      'audio wire',
      (row) => {
        row.submitted.nodes['node-03'].params.audio.sourceKey = 'filename';
      },
      /graph differs outside/u,
    ],
    [
      'extra graph authority',
      (row) => {
        row.submitted.runtimePreparation = {};
      },
      /top-level execution authority/u,
    ],
    [
      'wrong route',
      (row) => {
        row.workflowId = whisper.type + ':speech_translation';
      },
      /Unsupported private speech/u,
    ],
  ];
  for (const [name, tamper, error] of mutations) {
    const row = capture(whisper);
    tamper(row, row.output.resolvedExecutionInputs);
    assert.throws(() => verifyPrivateSpeechConsumer(row), error, name);
  }
});
