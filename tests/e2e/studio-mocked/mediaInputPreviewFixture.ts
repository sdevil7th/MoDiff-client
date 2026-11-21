import { execFileSync } from 'node:child_process';

/** Tiny locally encoded fixtures exercise intrinsic geometry without a GPU recorder or private media. */
export function videoPreviewFixture(python: string, width: number, height: number): Buffer {
  const ffmpeg = execFileSync(python, ['-c', 'from imageio_ffmpeg import get_ffmpeg_exe; print(get_ffmpeg_exe())'], {
    encoding: 'utf8',
    timeout: 10_000,
  }).trim();
  return execFileSync(
    ffmpeg,
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=navy:s=${width}x${height}:r=10`,
      '-frames:v',
      '2',
      '-c:v',
      'libvpx',
      '-threads',
      '1',
      '-deadline',
      'realtime',
      '-f',
      'webm',
      'pipe:1',
    ],
    { timeout: 10_000, maxBuffer: 1024 * 1024 },
  );
}

export function audioPreviewFixture(): Buffer {
  const samples = 4800;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(96000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}
