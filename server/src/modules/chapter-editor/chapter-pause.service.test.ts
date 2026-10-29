const mocks = vi.hoisted(() => ({ run: vi.fn() }));

// The real execFile carries a custom promisified form resolving to { stdout, stderr }, which is what the service awaits.
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.run }) };
});

import {
  AudioToolMissingError,
  buildArgs,
  buildPeakArgs,
  ChapterPauseService,
  computePeaks,
  parsePauses,
  type PauseSegment,
} from './chapter-pause.service';

const FFMPEG = '/opt/tools/ffmpeg';
const DETECT = 'silencedetect @ 0x714c24720';

function startLine(seconds: string): string {
  return `[${DETECT}] silence_start: ${seconds}`;
}

function endLine(seconds: string, duration = '0.5'): string {
  return `[${DETECT}] silence_end: ${seconds} | silence_duration: ${duration}`;
}

function segment(absolutePath: string, offsetMs: number, durationMs: number): PauseSegment {
  return { absolutePath, offsetMs, durationMs };
}

const PART_1 = segment('/library/book/part1.mp3', 57_000, 3_000);
const PART_2 = segment('/library/book/part2.m4a', 0, 7_000);

describe('parsePauses', () => {
  it('pairs each silence_start with the silence_end after it, rounding to the millisecond', () => {
    const stderr = [startLine('1.959'), endLine('5.5475', '3.5885'), startLine('7.2346'), endLine('7.9004', '0.6658')].join('\n');

    expect(parsePauses(stderr, 10_000)).toEqual([
      { startMs: 1_959, endMs: 5_548 },
      { startMs: 7_235, endMs: 7_900 },
    ]);
  });

  it('runs a pause still open when the window ends to the end of the window', () => {
    expect(parsePauses([startLine('1'), endLine('2'), startLine('8.5')].join('\n'), 10_000)).toEqual([
      { startMs: 1_000, endMs: 2_000 },
      { startMs: 8_500, endMs: 10_000 },
    ]);
  });

  it('starts a pause at 0 when the window opens in silence', () => {
    expect(parsePauses(endLine('0.8', '0.8'), 10_000)).toEqual([{ startMs: 0, endMs: 800 }]);
  });

  it('clamps an end past the window to the window', () => {
    expect(parsePauses([startLine('9'), endLine('10.4', '1.4')].join('\n'), 10_000)).toEqual([{ startMs: 9_000, endMs: 10_000 }]);
  });

  it('clamps a negative start to 0', () => {
    expect(parsePauses([startLine('-0.0213'), endLine('1.5')].join('\n'), 10_000)).toEqual([{ startMs: 0, endMs: 1_500 }]);
  });

  it('drops a pause that ends where it starts, and one still open at the very end of the window', () => {
    expect(parsePauses([startLine('3'), endLine('3', '0'), startLine('10')].join('\n'), 10_000)).toEqual([]);
  });

  it('ignores every line that is not a silence boundary', () => {
    const stderr = [
      "Input #0, mp3, from 'file:/library/book/part1.mp3':",
      '  Duration: 00:01:00.00, start: 0.025057, bitrate: 128 kb/s',
      '  silencedetect:default -> Stream #0:0 (pcm_s16le)',
      startLine('1'),
      'size=N/A time=00:00:05.00 bitrate=N/A speed= 120x',
      '',
      endLine('2'),
      '[out#0/null @ 0x600] video:0KiB audio:0KiB',
    ].join('\n');

    expect(parsePauses(stderr, 10_000)).toEqual([{ startMs: 1_000, endMs: 2_000 }]);
  });

  it('reports at most 200 pauses in one window', () => {
    const lines = Array.from({ length: 250 }, (_, index) => [startLine(`${index}.1`), endLine(`${index}.6`)]).flat();
    lines.push(startLine('260'));

    const pauses = parsePauses(lines.join('\n'), 300_000);

    expect(pauses).toHaveLength(200);
    expect(pauses.at(-1)).toEqual({ startMs: 199_100, endMs: 199_600 });
  });
});

describe('buildArgs', () => {
  const FILTER = /^\[0:a\]aresample=16000,aformat=sample_fmts=flt:channel_layouts=mono\[a0\];\[a0\]silencedetect=n=-\d+dB:d=[\d.]+\[out\]$/;

  it('reads one stretch of one file, in seconds to the millisecond, without a concat', () => {
    const args = buildArgs([segment('/library/book/-part1.mp3', 61_234, 2_500)]);

    expect(args.slice(0, args.indexOf('-filter_complex'))).toEqual([
      '-hide_banner',
      '-nostdin',
      '-nostats',
      '-loglevel',
      'info',
      '-ss',
      '61.234',
      '-t',
      '2.500',
      '-i',
      'file:/library/book/-part1.mp3',
    ]);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toMatch(FILTER);
    expect(graph).not.toContain('concat');
  });

  it('joins two files into one stream, in the order given', () => {
    const args = buildArgs([PART_1, PART_2]);

    expect(args.filter((arg) => arg.startsWith('file:'))).toEqual(['file:/library/book/part1.mp3', 'file:/library/book/part2.m4a']);
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-filter_complex'))).toEqual([
      '-ss',
      '57.000',
      '-t',
      '3.000',
      '-i',
      'file:/library/book/part1.mp3',
      '-ss',
      '0.000',
      '-t',
      '7.000',
      '-i',
      'file:/library/book/part2.m4a',
    ]);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    // The first file is padded to its timeline length so a short file cannot pull the next one earlier.
    expect(graph).toContain('[0:a]aresample=16000,aformat=sample_fmts=flt:channel_layouts=mono,apad=whole_dur=3.000[a0];');
    expect(graph).toContain('[1:a]aresample=16000,aformat=sample_fmts=flt:channel_layouts=mono[a1];');
    expect(graph).toMatch(/;\[a0\]\[a1\]concat=n=2:v=0:a=1,silencedetect=n=-\d+dB:d=[\d.]+\[out\]$/);
  });

  it('sends the detector output nowhere, so only its log lines come back', () => {
    expect(buildArgs([PART_1]).slice(-5)).toEqual(['-map', '[out]', '-f', 'null', '-']);
    expect(buildArgs([PART_1, PART_2]).slice(-5)).toEqual(['-map', '[out]', '-f', 'null', '-']);
  });
});

describe('ChapterPauseService.findPauses', () => {
  function makeService() {
    return new ChapterPauseService({ ffmpegPath: FFMPEG } as never);
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  beforeEach(() => {
    mocks.run.mockReset();
    mocks.run.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('runs the configured ffmpeg over the playable segments and measures pauses against their total length', async () => {
    mocks.run.mockResolvedValue({ stdout: '', stderr: [startLine('2'), endLine('3'), startLine('6.5')].join('\n') });

    const pauses = await makeService().findPauses([segment('/library/book/part0.mp3', 0, 0), PART_1, PART_2]);

    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(
      FFMPEG,
      buildArgs([PART_1, PART_2]),
      expect.objectContaining({ timeout: expect.any(Number), killSignal: 'SIGKILL', maxBuffer: expect.any(Number) }),
    );
    expect(pauses).toEqual([
      { startMs: 2_000, endMs: 3_000 },
      { startMs: 6_500, endMs: 10_000 },
    ]);
  });

  it.each([
    { name: 'no segments', segments: [] },
    { name: 'only zero-length segments', segments: [segment('/library/book/part1.mp3', 5_000, 0)] },
  ])('returns no pauses for $name without starting ffmpeg', async ({ segments }) => {
    await expect(makeService().findPauses(segments)).resolves.toEqual([]);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('reports a missing ffmpeg as its own error', async () => {
    mocks.run.mockRejectedValue(Object.assign(new Error(`spawn ${FFMPEG} ENOENT`), { code: 'ENOENT' }));

    await expect(makeService().findPauses([PART_1])).rejects.toBeInstanceOf(AudioToolMissingError);
  });

  it('rethrows any other failure unchanged', async () => {
    const failure = Object.assign(new Error('Command failed: ffmpeg'), { code: 1, stderr: 'Invalid data found when processing input' });
    mocks.run.mockRejectedValue(failure);

    await expect(makeService().findPauses([PART_1])).rejects.toBe(failure);
  });

  it('bounds the waiting queue and removes cancelled requests before they consume a decoder', async () => {
    const pending: Array<() => void> = [];
    mocks.run.mockImplementation(() => new Promise((resolve) => pending.push(() => resolve({ stdout: '', stderr: '' }))));
    const service = makeService();
    const active = [service.findPauses([PART_1]), service.findPauses([PART_1])];
    await flush();
    const controllers = Array.from({ length: 32 }, () => new AbortController());
    const waiting = controllers.map((controller) => service.findPauses([PART_1], controller.signal));
    const settled = Promise.allSettled(waiting);
    await expect(service.readPeaks([PART_1], 10)).rejects.toMatchObject({ response: { errorCode: 'CHAPTERS_ANALYSIS_UNAVAILABLE' } });
    controllers.forEach((controller) => controller.abort());
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
    pending.forEach((finish) => finish());
    await Promise.all(active);
    expect(mocks.run).toHaveBeenCalledTimes(2);
    mocks.run.mockResolvedValue({ stdout: '', stderr: '' });
    await expect(service.findPauses([PART_1])).resolves.toEqual([]);
  });

  it('runs at most two decoders at once, handing a freed slot to the next waiting run', async () => {
    const runs: Array<{ resolve: (value: { stdout: string; stderr: string }) => void; reject: (error: unknown) => void }> = [];
    mocks.run.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          runs.push({ resolve, reject });
        }),
    );
    const service = makeService();

    const settled = Promise.allSettled([1, 2, 3, 4].map(() => service.findPauses([PART_1])));
    await flush();
    expect(runs).toHaveLength(2);

    runs[0]!.resolve({ stdout: '', stderr: '' });
    await flush();
    expect(runs).toHaveLength(3);

    runs[1]!.reject(Object.assign(new Error('Command failed: ffmpeg'), { code: 1 }));
    await flush();
    expect(runs).toHaveLength(4);

    runs[2]!.resolve({ stdout: '', stderr: '' });
    runs[3]!.resolve({ stdout: '', stderr: endLine('1') });
    const results = await settled;

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect(results[3]).toEqual({ status: 'fulfilled', value: [{ startMs: 0, endMs: 1_000 }] });

    const later = [service.findPauses([PART_1]), service.findPauses([PART_1])];
    await flush();
    expect(runs).toHaveLength(6);
    runs[4]!.resolve({ stdout: '', stderr: '' });
    runs[5]!.resolve({ stdout: '', stderr: '' });
    await expect(Promise.all(later)).resolves.toEqual([[], []]);
  });
});

function pcm(samples: readonly number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer;
}

describe('computePeaks', () => {
  it("scales each bucket's loudest sample, either sign, to a fraction of full scale with 3 decimals", () => {
    const samples = [1_000, -16_384, 0, 0, 32_767, -32_768, 12_345, -3_276];

    expect(computePeaks(pcm(samples), 8, 4)).toEqual([0.5, 0, 1, 0.377]);
  });

  it('cuts the buckets from the samples the window expects, so a loud sample lands in the slice it plays in', () => {
    const samples = new Array<number>(10).fill(0);
    samples[3] = 32_767;
    samples[9] = -16_384;

    // 10 samples over 3 buckets: [0, 3), [3, 6), [6, 10).
    expect(computePeaks(pcm(samples), 10, 3)).toEqual([0, 1, 0.5]);
  });

  it('reads samples the window expects but the decoder never produced as silence', () => {
    // The window expects 8 samples; ffmpeg stopped after 4 because the book ended early.
    expect(computePeaks(pcm([100, 200, 30_000, 400]), 8, 4)).toEqual([0.006, 0.916, 0, 0]);
  });

  it('ignores a trailing odd byte and anything decoded past the expected length', () => {
    const decoded = Buffer.concat([pcm([16_384, 0, 0, 32_767]), Buffer.from([0x7f])]);

    expect(computePeaks(decoded, 2, 2)).toEqual([0.5, 0]);
  });

  it('repeats a sample across buckets when there are more buckets than samples', () => {
    expect(computePeaks(pcm([32_767, 16_384]), 2, 4)).toEqual([1, 1, 0.5, 0.5]);
  });

  it('returns one zero per bucket for silence and for no audio at all', () => {
    expect(computePeaks(Buffer.alloc(1_600), 800, 10)).toEqual(new Array<number>(10).fill(0));
    expect(computePeaks(Buffer.alloc(0), 0, 5)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('buildPeakArgs', () => {
  it('decodes one stretch to 8 kHz signed 16-bit mono on stdout, logging only errors', () => {
    const args = buildPeakArgs([segment('/library/book/-part1.mp3', 61_234, 2_500)]);

    expect(args.slice(0, args.indexOf('-filter_complex'))).toEqual([
      '-hide_banner',
      '-nostdin',
      '-nostats',
      '-loglevel',
      'error',
      '-ss',
      '61.234',
      '-t',
      '2.500',
      '-i',
      'file:/library/book/-part1.mp3',
    ]);
    expect(args[args.indexOf('-filter_complex') + 1]).toBe('[0:a]aresample=8000,aformat=sample_fmts=s16:channel_layouts=mono[a0];[a0]anull[out]');
    expect(args.slice(-5)).toEqual(['-map', '[out]', '-f', 's16le', '-']);
  });

  it('pads every file but the last to its timeline length before joining them', () => {
    const PART_3 = segment('/library/book/part3.flac', 0, 1_500);

    const args = buildPeakArgs([PART_1, PART_2, PART_3]);

    expect(args.filter((arg) => arg.startsWith('file:'))).toEqual([
      'file:/library/book/part1.mp3',
      'file:/library/book/part2.m4a',
      'file:/library/book/part3.flac',
    ]);
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      [
        '[0:a]aresample=8000,aformat=sample_fmts=s16:channel_layouts=mono,apad=whole_dur=3.000[a0]',
        '[1:a]aresample=8000,aformat=sample_fmts=s16:channel_layouts=mono,apad=whole_dur=7.000[a1]',
        '[2:a]aresample=8000,aformat=sample_fmts=s16:channel_layouts=mono[a2]',
        '[a0][a1][a2]concat=n=3:v=0:a=1,anull[out]',
      ].join(';'),
    );
    expect(args.slice(-5)).toEqual(['-map', '[out]', '-f', 's16le', '-']);
  });

  it('builds the same inputs and joins as the pause detector, differing only in format and tail', () => {
    const peaks = buildPeakArgs([PART_1, PART_2]);
    const pauses = buildArgs([PART_1, PART_2]);
    const inputs = (args: string[]) => args.slice(args.indexOf('-ss'), args.indexOf('-filter_complex'));

    expect(inputs(peaks)).toEqual(inputs(pauses));
    expect(peaks[peaks.indexOf('-filter_complex') + 1]).toContain('[a0][a1]concat=n=2:v=0:a=1,anull[out]');
  });
});

describe('ChapterPauseService.readPeaks', () => {
  function makeService() {
    return new ChapterPauseService({ ffmpegPath: FFMPEG } as never);
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  beforeEach(() => {
    mocks.run.mockReset();
    mocks.run.mockResolvedValue({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
  });

  it('reads raw samples as a buffer, sized to the window, and buckets them over the playable segments', async () => {
    // 3 s + 7 s at 8 kHz: 80,000 samples, of which only the first 2 are loud.
    mocks.run.mockResolvedValue({ stdout: pcm([32_767, -16_384]), stderr: Buffer.alloc(0) });

    const peaks = await makeService().readPeaks([segment('/library/book/part0.mp3', 0, 0), PART_1, PART_2], 4);

    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(FFMPEG, buildPeakArgs([PART_1, PART_2]), {
      encoding: 'buffer',
      timeout: expect.any(Number),
      killSignal: 'SIGKILL',
      maxBuffer: 80_000 * 2 + 64 * 1024,
      windowsHide: true,
    });
    expect(peaks).toEqual([1, 0, 0, 0]);
  });

  it.each([
    { name: 'no segments', segments: [] },
    { name: 'only zero-length segments', segments: [segment('/library/book/part1.mp3', 5_000, 0)] },
  ])('returns silence for $name without starting ffmpeg', async ({ segments }) => {
    await expect(makeService().readPeaks(segments, 3)).resolves.toEqual([0, 0, 0]);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('reports a missing ffmpeg as its own error', async () => {
    mocks.run.mockRejectedValue(Object.assign(new Error(`spawn ${FFMPEG} ENOENT`), { code: 'ENOENT' }));

    await expect(makeService().readPeaks([PART_1], 20)).rejects.toBeInstanceOf(AudioToolMissingError);
  });

  it('rethrows any other failure unchanged, including output past the buffer cap', async () => {
    const failure = Object.assign(new RangeError('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    mocks.run.mockRejectedValue(failure);

    await expect(makeService().readPeaks([PART_1], 20)).rejects.toBe(failure);
  });

  it('shares the two decoders with pause detection, and frees its slot when it fails', async () => {
    const runs: Array<{ resolve: (value: { stdout: Buffer | string; stderr: Buffer | string }) => void; reject: (error: unknown) => void }> = [];
    mocks.run.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          runs.push({ resolve, reject });
        }),
    );
    const service = makeService();

    const pauses = service.findPauses([PART_1]);
    const firstPeaks = service.readPeaks([PART_1], 20);
    const queuedPeaks = service.readPeaks([PART_2], 20);
    const queuedPauses = service.findPauses([PART_2]);
    await flush();
    expect(runs).toHaveLength(2);

    runs[1]!.reject(new Error('Command failed: ffmpeg'));
    await expect(firstPeaks).rejects.toThrow('Command failed: ffmpeg');
    await flush();
    expect(runs).toHaveLength(3);
    expect(mocks.run.mock.calls[2]![1]).toEqual(buildPeakArgs([PART_2]));

    runs[0]!.resolve({ stdout: '', stderr: '' });
    await expect(pauses).resolves.toEqual([]);
    await flush();
    expect(runs).toHaveLength(4);
    expect(mocks.run.mock.calls[3]![1]).toEqual(buildArgs([PART_2]));

    runs[2]!.resolve({ stdout: pcm([16_384]), stderr: Buffer.alloc(0) });
    runs[3]!.resolve({ stdout: '', stderr: '' });
    await expect(queuedPeaks).resolves.toEqual([0.5, ...new Array<number>(19).fill(0)]);
    await expect(queuedPauses).resolves.toEqual([]);
  });
});
