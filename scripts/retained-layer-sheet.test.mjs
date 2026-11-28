import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./template-gallery-retained-layer-sheet.py', import.meta.url));
const fixtureCode = `from pathlib import Path
from PIL import Image,ImageDraw
import sys,json,hashlib
r=Path(sys.argv[1]);layers=[];items=[]
for i in range(3):
 image=Image.new('RGBA',(16,16),(20,30,40,255) if i==0 else (0,0,0,0))
 if i:ImageDraw.Draw(image).rectangle((i*3,i*3,i*3+4,i*3+4),fill=(40,130,60,255))
 image.save(r/f'layer-{i}.png');image.save(r/f'native-{i}.webp',format='WEBP',quality=100)
 items.append({'encodedSha256':'sha256:'+hashlib.sha256((r/f'native-{i}.webp').read_bytes()).hexdigest(),'decodedSha256':f'test-layer-{i}','width':16,'height':16})
 layers.append(image)
source=Image.new('RGBA',(16,16));
for layer in layers:source=Image.alpha_composite(source,layer)
source.save(r/'source.png');source_hash='sha256:bytes:'+hashlib.sha256((r/'source.png').read_bytes()).hexdigest()
p={'template':{'id':'test_layers','lockedSettings':{'layers':3,'dtype':'bfloat16','steps':30,'seed':1,'guidanceScale':4}},'graph':{'executionPlan':{'resourceMode':'auto','offloadMode':'model_cpu'}},'inputs':{'items':[{'contentHash':source_hash}]},'output':{'collectionHash':'test-collection','items':items}}
(r/'run.json').write_text(json.dumps(p))
`;

function fixture(run) {
  const python = process.env.MODIFF_BACKEND_PYTHON;
  assert(python, 'Set the declared ordinary CPU MODIFF_BACKEND_PYTHON for media checks.');
  const directory = mkdtempSync(join(tmpdir(), 'modiff-retained-layer-'));
  try {
    const made = spawnSync(python, ['-B', '-c', fixtureCode, directory], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(made.status, 0, made.stderr);
    run(directory, (suffix, extra = []) =>
      spawnSync(
        python,
        [
          '-B',
          script,
          '--source',
          join(directory, 'source.png'),
          '--layers',
          ...[0, 1, 2].map((i) => join(directory, `layer-${i}.png`)),
          '--run-provenance',
          join(directory, 'run.json'),
          '--output',
          join(directory, suffix + '.png'),
          '--derivative-provenance',
          join(directory, suffix + '.json'),
          ...extra,
        ],
        { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } },
      ),
    );
  } finally {
    assert.equal(dirname(realpathSync(directory)), realpathSync(tmpdir()));
    assert(resolve(directory).includes('modiff-retained-layer-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('retained sheet processor binds native byte encodings and preserves the three lossless layers', () =>
  fixture((directory, execute) => {
    const before = [0, 1, 2].map((i) => readFileSync(join(directory, `layer-${i}.png`)));
    const result = execute('sheet');
    assert.equal(result.status, 0, result.stderr);
    const metadata = JSON.parse(readFileSync(join(directory, 'sheet.json'), 'utf8'));
    assert.equal(metadata.losslessExports.items.length, 3);
    assert.equal(metadata.recomposition.maxMeanAbsoluteError, 0);
    assert.equal(metadata.processor.role, 'byte-identical-retained-sheet-reproduction');
    assert.equal(metadata.creationTimeReviewCaptionPreserved, true);
    for (const i of [0, 1, 2]) assert.deepEqual(readFileSync(join(directory, `layer-${i}.png`)), before[i]);
  }));

test('wrong native encoding or approved hash fails without writing an output or changing a source', () =>
  fixture((directory, execute) => {
    const path = join(directory, 'run.json'),
      original = readFileSync(path),
      run = JSON.parse(original);
    run.output.items[0].encodedSha256 = 'sha256:' + '0'.repeat(64);
    writeFileSync(path, JSON.stringify(run));
    let result = execute('wrong-native');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /native quality-100 WebP bytes/);
    assert(!existsSync(join(directory, 'wrong-native.png')));
    writeFileSync(path, original);
    result = execute('wrong-approved', ['--expected-approved-sha256', '0'.repeat(64)]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact approved sheet/);
    assert(!existsSync(join(directory, 'wrong-approved.png')));
  }));

test('retained sheet refuses to overwrite an existing reviewed file', () =>
  fixture((directory, execute) => {
    const path = join(directory, 'existing.png'),
      original = Buffer.from('preserved original');
    writeFileSync(path, original);
    const result = execute('existing');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /never overwritten/);
    assert.deepEqual(readFileSync(path), original);
  }));
