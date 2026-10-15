import { EventEmitter } from 'events';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('child_process', () => ({ spawn: mocks.spawn }));

import { describeWriteFailure } from '../../write-failure-reason';
import { FfmpegStalledError, runFfmpeg } from './ffmpeg-runner';

const MIB = 1024 * 1024;

class FakeStream extends EventEmitter {
  setEncoding = vi.fn();
}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  kill = vi.fn<(signal?: NodeJS.Signals) => boolean>(() => true);

  /** One block of FFmpeg's `-progress` output, as FFmpeg 8 prints it for an M4B with cover art. */
  report(totalSize: number): void {
    this.stdout.emit('data', `frame=1\nbitrate=N/A\ntotal_size=${totalSize}\nout_time_us=N/A\nspeed=N/A\nprogress=continue\n`);
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }
}

describe('runFfmpeg', () => {
  let child: FakeChild;

  beforeEach(() => {
    vi.useFakeTimers();
    child = new FakeChild();
    mocks.spawn.mockReset().mockReturnValue(child);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks FFmpeg for progress reports ahead of the caller arguments', async () => {
    const run = runFfmpeg('/opt/bin/ffmpeg', ['-v', 'error', '-i', 'in.m4b', 'out.m4b']);
    child.exit(0);

    await expect(run).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledWith('/opt/bin/ffmpeg', ['-progress', 'pipe:1', '-v', 'error', '-i', 'in.m4b', 'out.m4b'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('lets a slow write run far past the stall window while its output keeps growing', async () => {
    const run = runFfmpeg('ffmpeg', []);
    for (let report = 1; report <= 10; report++) {
      vi.advanceTimersByTime(119_000);
      child.report(report * 1_000_000);
    }
    child.exit(0);

    await expect(run).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('stops FFmpeg once its output stops growing, though it keeps printing reports', async () => {
    const run = runFfmpeg('ffmpeg', []);
    child.report(5_000_000);
    for (let tick = 0; tick < 239; tick++) {
      vi.advanceTimersByTime(500);
      child.report(5_000_000);
    }
    expect(child.kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.exit(null, 'SIGTERM');

    const error = await run.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FfmpegStalledError);
    expect(error).toMatchObject({ killed: true, signal: 'SIGTERM', stallWindowMs: 120_000 });
  });

  it('waits out the silent flush of everything FFmpeg wrote into the page cache', async () => {
    const run = runFfmpeg('ffmpeg', []);
    child.report(900 * MIB);
    child.report(1_900 * MIB);

    // On NFS at 64 Mbit/s a 615 MB book was cached in 5s, then FFmpeg said nothing for 85s; 2 GB takes over 4 minutes.
    vi.advanceTimersByTime(260_000);
    child.stdout.emit('data', `total_size=${2_000 * MIB}\nout_time_us=N/A\nprogress=end\n`);
    child.exit(0);

    await expect(run).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('stops a run silent for longer than flushing what it wrote would take at 1 MiB/s', async () => {
    const run = runFfmpeg('ffmpeg', []);
    child.report(600 * MIB);

    vi.advanceTimersByTime(599_999);
    expect(child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.exit(null, 'SIGTERM');

    await expect(run).rejects.toMatchObject({ name: 'FfmpegStalledError', stallWindowMs: 600_000 });
  });

  it('stops FFmpeg that never reports at all, such as one stuck opening its input', async () => {
    const run = runFfmpeg('ffmpeg', []);

    vi.advanceTimersByTime(119_999);
    expect(child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.exit(255);

    await expect(run).rejects.toBeInstanceOf(FfmpegStalledError);
  });

  it('escalates to SIGKILL when FFmpeg sits out SIGTERM, and settles only once it has exited', async () => {
    const run = runFfmpeg('ffmpeg', []);
    let settled = false;
    void run.catch(() => undefined).finally(() => (settled = true));

    vi.advanceTimersByTime(120_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    vi.advanceTimersByTime(9_999);
    expect(child.kill).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    await Promise.resolve();
    expect(settled).toBe(false);

    child.exit(null, 'SIGKILL');

    await expect(run).rejects.toMatchObject({ name: 'FfmpegStalledError', signal: 'SIGKILL' });
  });

  it('keeps the command line, with its paths and metadata values, out of a stall failure reason', async () => {
    const run = runFfmpeg('ffmpeg', ['-i', '/books/a/book.m4b', '-metadata', 'title=Secret', '/books/a/.bookorbit-write-x.m4b']);
    vi.advanceTimersByTime(120_000);
    child.exit(null, 'SIGTERM');

    const error = await run.catch((caught: unknown) => caught);
    expect(describeWriteFailure(error, '/books/a/book.m4b')).toBe('ffmpeg made no progress for 120s and was stopped');
  });

  it('rejects a failed run with the error execFile gives, so the failure reason is still the tool output', async () => {
    const run = runFfmpeg('ffmpeg', ['-i', 'in.m4b', 'out.m4b']);
    child.stderr.emit('data', '[mp4 @ 0x7f8a] Could not find tag for codec\n');
    child.exit(1);

    const error = await run.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Command failed: ffmpeg -progress pipe:1 -i in.m4b out.m4b\n[mp4 @ 0x7f8a] Could not find tag for codec\n');
    expect(error).toMatchObject({ code: 1, signal: null, killed: false, stdout: '', stderr: '[mp4 @ 0x7f8a] Could not find tag for codec\n' });
    expect(describeWriteFailure(error, '/books/in.m4b')).toBe('Could not find tag for codec');
  });

  it('treats a signal it did not send as a failed run, not a stall', async () => {
    const run = runFfmpeg('ffmpeg', []);
    child.exit(null, 'SIGKILL');

    const error = await run.catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(FfmpegStalledError);
    expect(error).toMatchObject({ signal: 'SIGKILL', killed: false });
    expect((error as Error).message.startsWith('Command failed: ffmpeg')).toBe(true);
  });

  it('reads a progress value split across output chunks', async () => {
    const run = runFfmpeg('ffmpeg', []);
    child.report(1_000);
    vi.advanceTimersByTime(119_000);
    child.stdout.emit('data', 'total_si');
    child.stdout.emit('data', 'ze=2000\nprogress=continue\n');
    vi.advanceTimersByTime(119_000);
    child.exit(0);

    await expect(run).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('counts a moving output time as progress when the byte count is not reported', async () => {
    const run = runFfmpeg('ffmpeg', []);
    for (let report = 1; report <= 3; report++) {
      vi.advanceTimersByTime(119_000);
      child.stdout.emit('data', `total_size=N/A\nout_time_us=${report * 1_000_000}\nprogress=continue\n`);
    }
    child.exit(0);

    await expect(run).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('rejects with the spawn error when FFmpeg cannot be started, settling once', async () => {
    const run = runFfmpeg('ffmpeg', []);
    const enoent = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
    child.emit('error', enoent);
    child.exit(-2);

    await expect(run).rejects.toBe(enoent);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps the stderr it keeps without stopping a chatty FFmpeg', async () => {
    const run = runFfmpeg('ffmpeg', []);
    for (let chunk = 0; chunk < 200; chunk++) child.stderr.emit('data', 'x'.repeat(1024));
    child.exit(1);

    const error = await run.catch((caught: unknown) => caught);
    expect((error as { stderr: string }).stderr).toHaveLength(64 * 1024);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('clears its timers once FFmpeg exits', async () => {
    const run = runFfmpeg('ffmpeg', []);
    child.report(1);
    child.exit(0);
    await run;

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
