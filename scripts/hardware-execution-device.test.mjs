import assert from 'node:assert/strict';
import test from 'node:test';
import { hardwareExecutionDevice } from './release-qualification-policy.mjs';

function evidence(profile, device, backend, devices = []) {
  const family = String(device).split(':')[0];
  return [
    { runtime_profile: { installed: profile }, packages: { torch: { [`${family}_devices`]: devices } } },
    { execution: { measurement: { device, backend } } },
  ];
}

test('a CPU run on a CUDA host cannot qualify the NVIDIA profile', () => {
  const args = evidence('nvidia-cuda', 'cpu', 'cpu');
  args[0].packages.torch.cuda_devices = [{ index: 0, name: 'NVIDIA GPU', backend: 'cuda' }];
  assert.throws(() => hardwareExecutionDevice(...args), /does not match/);
});

test('record the executed accelerator index, preserving captured metadata', () => {
  const devices = [
    { index: 0, name: 'Unused GPU', backend: 'cuda' },
    { index: 1, name: 'Executed GPU', backend: 'cuda', total_memory: 1234 },
  ];
  const args = evidence('nvidia-cuda', 'cuda:1', 'cuda', devices);
  const before = structuredClone(args);
  assert.equal(hardwareExecutionDevice(...args), devices[1]);
  assert.deepEqual(args, before);
});

for (const [profile, device, backend] of [
  ['amd-rocm-linux', 'cuda:0', 'rocm'],
  ['amd-instinct-rocm-linux', 'cuda:0', 'rocm'],
  ['amd-pytorch-windows', 'cuda:0', 'rocm'],
  ['intel-xpu', 'xpu:0', 'xpu'],
  ['apple-mps', 'mps', 'mps'],
]) {
  test(`${profile} uses the actual measured backend`, () => {
    const physical = { index: 0, name: 'Physical accelerator', backend };
    assert.equal(hardwareExecutionDevice(...evidence(profile, device, backend, [physical])), physical);
  });
}

test('CPU qualification has CPU identity even if a host exposes a GPU', () => {
  const args = evidence('cpu', 'cpu:0', 'cpu');
  args[0].packages.torch.cuda_devices = [{ index: 0, name: 'Unused GPU', backend: 'cuda' }];
  assert.equal(hardwareExecutionDevice(...args).name, 'cpu');
});

for (const [label, args] of [
  ['missing measurement', [{ runtime_profile: { installed: 'nvidia-cuda' } }, {}]],
  ['ROCm cannot establish NVIDIA', evidence('nvidia-cuda', 'cuda:0', 'rocm')],
  ['CUDA cannot establish ROCm', evidence('amd-rocm-linux', 'cuda:0', 'cuda')],
  ['missing executed index', evidence('nvidia-cuda', 'cuda:1', 'cuda', [{ index: 0, name: 'Other', backend: 'cuda' }])],
  [
    'contradictory physical backend',
    evidence('nvidia-cuda', 'cuda:0', 'cuda', [{ index: 0, name: 'Other', backend: 'rocm' }]),
  ],
  ['unknown profile', evidence('guessed-gpu', 'cuda:0', 'cuda')],
  ['malformed index', evidence('nvidia-cuda', 'cuda:-1', 'cuda')],
  ['nonzero CPU index', evidence('cpu', 'cpu:1', 'cpu')],
]) {
  test(`reject ${label}`, () => assert.throws(() => hardwareExecutionDevice(...args)));
}
