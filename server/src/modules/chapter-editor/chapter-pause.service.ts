import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { BOOK_CHAPTERS_ERROR_CODES, type ChapterPause } from '@bookorbit/types';

import { audioToolsConfig } from '../../config/config';

const execFile = promisify(execFileCallback);

/** Room tone in a mastered audiobook sits far below this; speech, even a soft syllable, does not. */
const NOISE_FLOOR_DB = -35;
/** Shorter gaps are the breaths between words, not pauses anyone would put a chapter in. */
const MIN_PAUSE_SECONDS = 0.35;
/** ffmpeg decodes one 60 s window in about 0.1 s; this only stops a stuck process. */
const RUN_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_RUNS = 2;
const MAX_WAITING_RUNS = 32;
const WAIT_TIMEOUT_MS = 10_000;
const MAX_STDERR_BYTES = 4 * 1024 * 1024;
const MAX_PAUSES_PER_WINDOW = 200;
/** Enough to draw a speech envelope; a 60 s window is under a megabyte of samples. */
const PEAK_SAMPLE_RATE = 8_000;

/** A stretch of one file, in the order the window plays them. */
export interface PauseSegment {
  absolutePath: string;
  offsetMs: number;
  durationMs: number;
}

export class AudioToolMissingError extends Error {
  constructor() {
    super('ffmpeg was not found');
    this.name = 'AudioToolMissingError';
  }
}

/**
 * Finds pauses in short windows of a book's audio with ffmpeg's `silencedetect`. A window that
 * crosses a file boundary is decoded as one stream, so a pause split across two files is found
 * whole. Runs are capped process-wide: every editor shares the same two decoders.
 */
@Injectable()
export class ChapterPauseService {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(@Inject(audioToolsConfig.KEY) private readonly config: ConfigType<typeof audioToolsConfig>) {}

  /** Pauses relative to the start of the window, in ms. Throws when the audio cannot be decoded. */
  async findPauses(segments: readonly PauseSegment[], signal?: AbortSignal): Promise<ChapterPause[]> {
    const playable = segments.filter((segment) => segment.durationMs > 0);
    if (playable.length === 0) return [];
    await this.acquire(signal);
    try {
      signal?.throwIfAborted();
      const { stderr } = await execFile(this.config.ffmpegPath, buildArgs(playable), {
        signal,
        timeout: RUN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_STDERR_BYTES,
        windowsHide: true,
      });
      return parsePauses(
        stderr,
        playable.reduce((sum, segment) => sum + segment.durationMs, 0),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AudioToolMissingError();
      throw error;
    } finally {
      this.release();
    }
  }

  /**
   * The loudest sample in each of `buckets` equal slices of the window, from 0 to 1. Audio the
   * window expects but the files do not have, past the end of the book, reads as silence.
   */
  async readPeaks(segments: readonly PauseSegment[], buckets: number, signal?: AbortSignal): Promise<number[]> {
    const playable = segments.filter((segment) => segment.durationMs > 0);
    const windowMs = playable.reduce((sum, segment) => sum + segment.durationMs, 0);
    if (playable.length === 0) return new Array<number>(buckets).fill(0);
    const expectedSamples = Math.round((windowMs * PEAK_SAMPLE_RATE) / 1000);
    await this.acquire(signal);
    try {
      signal?.throwIfAborted();
      const { stdout } = await execFile(this.config.ffmpegPath, buildPeakArgs(playable), {
        encoding: 'buffer',
        signal,
        timeout: RUN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: expectedSamples * 2 + 64 * 1024,
        windowsHide: true,
      });
      return computePeaks(stdout, expectedSamples, buckets);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AudioToolMissingError();
      throw error;
    } finally {
      this.release();
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < MAX_CONCURRENT_RUNS) {
      this.active += 1;
      return;
    }
    if (this.waiting.length >= MAX_WAITING_RUNS) throw this.busy();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      const take = () => {
        cleanup();
        resolve();
      };
      const cancel = (reason: unknown) => {
        const index = this.waiting.indexOf(take);
        if (index >= 0) this.waiting.splice(index, 1);
        cleanup();
        reject(reason instanceof Error ? reason : new Error('Analysis cancelled'));
      };
      const abort = () => cancel(signal?.reason ?? new Error('Analysis cancelled'));
      const timer = setTimeout(() => cancel(this.busy()), WAIT_TIMEOUT_MS);
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(take);
    });
  }

  private busy(): ServiceUnavailableException {
    return new ServiceUnavailableException({ message: 'Audio analysis capacity is busy', errorCode: BOOK_CHAPTERS_ERROR_CODES.analysisUnavailable });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * The inputs and the filter graph that turn a window's file segments into one mono stream ending
 * in `tail`. Stored lengths are whole seconds, so a file can end before the timeline says it does;
 * padding it to that length keeps every later file where the editor and the player put it.
 */
function windowGraph(segments: readonly PauseSegment[], sampleRate: number, sampleFormat: string, tail: string): { inputs: string[]; graph: string } {
  const inputs = segments.flatMap((segment) => [
    '-ss',
    seconds(segment.offsetMs),
    '-t',
    seconds(segment.durationMs),
    '-i',
    `file:${segment.absolutePath}`,
  ]);
  const prepared = segments.map((segment, index) => {
    const pad = index < segments.length - 1 ? `,apad=whole_dur=${seconds(segment.durationMs)}` : '';
    return `[${index}:a]aresample=${sampleRate},aformat=sample_fmts=${sampleFormat}:channel_layouts=mono${pad}[a${index}]`;
  });
  const joined = segments.length > 1 ? `${segments.map((_, index) => `[a${index}]`).join('')}concat=n=${segments.length}:v=0:a=1,` : '[a0]';
  return { inputs, graph: `${prepared.join(';')};${joined}${tail}[out]` };
}

/** Mono at 16 kHz is plenty to hear silence, and resampling lets files of any format concatenate. */
export function buildArgs(segments: readonly PauseSegment[]): string[] {
  const { inputs, graph } = windowGraph(segments, 16_000, 'flt', `silencedetect=n=${NOISE_FLOOR_DB}dB:d=${MIN_PAUSE_SECONDS}`);
  return ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'info', ...inputs, '-filter_complex', graph, '-map', '[out]', '-f', 'null', '-'];
}

export function buildPeakArgs(segments: readonly PauseSegment[]): string[] {
  const { inputs, graph } = windowGraph(segments, PEAK_SAMPLE_RATE, 's16', 'anull');
  return ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-f', 's16le', '-'];
}

/** Peak per bucket over little-endian 16-bit samples, as a fraction of full scale. */
export function computePeaks(pcm: Buffer, expectedSamples: number, buckets: number): number[] {
  const available = Math.floor(pcm.length / 2);
  const total = Math.max(expectedSamples, 1);
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor((bucket * total) / buckets);
    const to = Math.min(available, Math.max(from + 1, Math.floor(((bucket + 1) * total) / buckets)));
    let peak = 0;
    for (let index = from; index < to; index += 1) {
      const value = Math.abs(pcm.readInt16LE(index * 2));
      if (value > peak) peak = value;
    }
    peaks.push(Math.round((Math.min(peak, 32_767) / 32_767) * 1000) / 1000);
  }
  return peaks;
}

/** Pairs `silence_start` and `silence_end` lines; a pause still open when the window ends runs to its end. */
export function parsePauses(stderr: string, windowMs: number): ChapterPause[] {
  const pauses: ChapterPause[] = [];
  let openAt: number | null = null;
  for (const line of stderr.split('\n')) {
    if (pauses.length >= MAX_PAUSES_PER_WINDOW) break;
    const start = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (start) {
      openAt = Math.max(0, Math.round(Number(start[1]) * 1000));
      continue;
    }
    const end = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (end) {
      const endMs = Math.min(windowMs, Math.round(Number(end[1]) * 1000));
      if (endMs > (openAt ?? 0)) pauses.push({ startMs: openAt ?? 0, endMs });
      openAt = null;
    }
  }
  if (openAt !== null && openAt < windowMs && pauses.length < MAX_PAUSES_PER_WINDOW) pauses.push({ startMs: openAt, endMs: windowMs });
  return pauses;
}
