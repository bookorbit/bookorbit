import { spawn } from 'child_process';

const FFMPEG_STALL_MIN_MS = 120_000;
/**
 * The slowest storage a write is waited out on. FFmpeg falls silent while the kernel flushes what
 * it wrote, which on a network share with ample page cache can be the whole file, and its last
 * report only arrives once that flush ends; NFS also holds written pages until a commit, stalling
 * writes in bursts. Either quiet spell lasts as long as the data takes to reach the server.
 */
const FLUSH_FLOOR_BYTES_PER_SECOND = 1024 * 1024;
const FFMPEG_KILL_GRACE_MS = 10_000;
const FFMPEG_STDERR_MAX_CHARS = 64 * 1024;
/**
 * FFmpeg 7 and later print a progress block every period even while the muxer is blocked on a
 * write, so only a change in these values counts. `out_time_us` stays N/A for a file with cover
 * art, which leaves the byte count as the signal that always moves.
 */
const PROGRESS_KEYS = new Set(['total_size', 'out_time_us']);

export class FfmpegStalledError extends Error {
  readonly killed = true;

  constructor(
    readonly stallWindowMs: number,
    readonly signal: NodeJS.Signals | null,
  ) {
    super(`ffmpeg made no progress for ${Math.round(stallWindowMs / 1000)}s and was stopped`);
    this.name = 'FfmpegStalledError';
  }
}

/**
 * Runs FFmpeg to completion, stopping it only once it stops making progress.
 *
 * A stream copy of a large audiobook onto a network share can run for minutes while moving
 * steadily, and a wall-clock limit failed those writes. A failed run rejects with the error shape
 * `execFile` gives, so callers reading `Command failed:` and `stderr` see no difference.
 */
export function runFfmpeg(binary: string, args: string[]): Promise<void> {
  const fullArgs = ['-progress', 'pipe:1', ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(binary, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const lastProgress = new Map<string, string>();
    let partialLine = '';
    let stderr = '';
    let stalled = false;
    let settled = false;
    let windowMs = stallWindowMs(0);
    let killTimer: NodeJS.Timeout | undefined;
    let stallTimer = setTimeout(stop, windowMs);

    function stop(): void {
      stalled = true;
      child.kill('SIGTERM');
      // A process blocked on a hard-mounted share can sit out SIGTERM until its write returns.
      killTimer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_KILL_GRACE_MS);
    }

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      clearTimeout(killTimer);
      if (error) reject(error);
      else resolve();
    }

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      const lines = (partialLine + chunk).split('\n');
      partialLine = lines.pop() ?? '';
      if (!advanced(lines, lastProgress) || stalled) return;
      clearTimeout(stallTimer);
      windowMs = stallWindowMs(Number(lastProgress.get('total_size')));
      stallTimer = setTimeout(stop, windowMs);
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < FFMPEG_STDERR_MAX_CHARS) stderr += chunk.slice(0, FFMPEG_STDERR_MAX_CHARS - stderr.length);
    });

    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => {
      if (stalled) finish(new FfmpegStalledError(windowMs, signal));
      else if (code === 0) finish();
      else finish(commandFailed([binary, ...fullArgs].join(' '), code, signal, stderr));
    });
  });
}

function stallWindowMs(bytesWritten: number): number {
  const flushMs = Number.isFinite(bytesWritten) ? Math.ceil(bytesWritten / FLUSH_FLOOR_BYTES_PER_SECOND) * 1000 : 0;
  return Math.max(FFMPEG_STALL_MIN_MS, flushMs);
}

function advanced(lines: string[], lastProgress: Map<string, string>): boolean {
  let moved = false;
  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    if (!PROGRESS_KEYS.has(key)) continue;
    const value = line.slice(separator + 1).trim();
    if (lastProgress.get(key) === value) continue;
    lastProgress.set(key, value);
    moved = true;
  }
  return moved;
}

function commandFailed(cmd: string, code: number | null, signal: NodeJS.Signals | null, stderr: string): Error {
  return Object.assign(new Error(`Command failed: ${cmd}\n${stderr}`), { code, signal, killed: false, cmd, stdout: '', stderr });
}
