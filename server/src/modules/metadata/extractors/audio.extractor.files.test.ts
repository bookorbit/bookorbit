import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ffprobe always fails here, so every answer below comes from the in-process reader.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: vi.fn((...args: unknown[]) => (args.at(-1) as (error: Error) => void)(new Error('ffprobe is not available in this test'))),
  };
});

import { probeAudioFile } from './audio.extractor';

const SAMPLE_RATE = 44_100;
const SAMPLES_PER_FRAME = 1_152;

/**
 * MPEG-1 Layer III at 32 kbit/s, 44.1 kHz, mono, with no Xing header, so the length can only come
 * from the file size. Frames are 104 or 105 bytes, padded the way an encoder keeps the bitrate exact.
 */
function constantBitrateFrames(frameCount: number): Buffer {
  const frames: Buffer[] = [];
  let remainder = 0;
  for (let index = 0; index < frameCount; index++) {
    remainder += (144 * 32_000) % SAMPLE_RATE;
    const padded = remainder >= SAMPLE_RATE;
    if (padded) remainder -= SAMPLE_RATE;
    const frame = Buffer.alloc(104 + (padded ? 1 : 0));
    frame.set([0xff, 0xfb, 0x10 | (padded ? 0x02 : 0x00), 0xc0]);
    frames.push(frame);
  }
  return Buffer.concat(frames);
}

function id3Frame(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function chapterFrame(elementId: string, startMs: number, endMs: number, title?: string): Buffer {
  const times = Buffer.alloc(16);
  times.writeUInt32BE(startMs, 0);
  times.writeUInt32BE(endMs, 4);
  times.writeUInt32BE(0xffffffff, 8);
  times.writeUInt32BE(0xffffffff, 12);
  const subframes = title === undefined ? Buffer.alloc(0) : id3Frame('TIT2', Buffer.concat([Buffer.from([0]), Buffer.from(title, 'latin1')]));
  return id3Frame('CHAP', Buffer.concat([Buffer.from(`${elementId}\0`, 'latin1'), times, subframes]));
}

/** An ID3v2.3 tag around the given frames; the tag size is stored as a syncsafe integer. */
function id3Tag(frames: Buffer[]): Buffer {
  const body = Buffer.concat(frames);
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  header[6] = (body.length >> 21) & 0x7f;
  header[7] = (body.length >> 14) & 0x7f;
  header[8] = (body.length >> 7) & 0x7f;
  header[9] = body.length & 0x7f;
  return Buffer.concat([header, body]);
}

describe('probeAudioFile with the built-in reader, on real file bytes', () => {
  let dir: string;
  const frameCount = 4_594;
  const exactMs = Math.round(((frameCount * SAMPLES_PER_FRAME) / SAMPLE_RATE) * 1000);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookorbit-audio-reader-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Unpatched, music-metadata divides by one frame's size, which at 44.1 kHz is a byte off the
  // average and puts this file 0.57 s out. patches/music-metadata@*.patch divides by the bitrate.
  it('measures a constant-bitrate MP3 with no frame count to the millisecond', async () => {
    const path = join(dir, 'constant-bitrate.mp3');
    await writeFile(path, constantBitrateFrames(frameCount));

    const probe = await probeAudioFile(path, 'builtin');

    expect(probe).not.toBeNull();
    expect(Math.abs(probe!.durationMs! - exactMs)).toBeLessThanOrEqual(2);
    expect(probe!.durationSeconds).toBe(120);
  });

  it('reads ID3v2 chapters in seconds and names an untitled one after its element ID, as ffprobe does', async () => {
    const path = join(dir, 'chaptered.mp3');
    const tag = id3Tag([chapterFrame('ch0', 0, 61_500, 'Opening'), chapterFrame('ch1', 61_500, 120_000)]);
    await writeFile(path, Buffer.concat([tag, constantBitrateFrames(frameCount)]));

    const probe = await probeAudioFile(path, 'builtin');

    expect(probe?.chapters).toEqual([
      { title: 'Opening', startMs: 0 },
      { title: 'ch1', startMs: 61_500 },
    ]);
    expect(Math.abs(probe!.durationMs! - exactMs)).toBeLessThanOrEqual(2);
  });
});
