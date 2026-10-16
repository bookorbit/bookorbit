import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import { DjvuProcess } from './djvu-process';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

describe('DjVu process resource controls', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'djvu-process-test-'));
    vi.resetAllMocks();
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  function child() {
    const process = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => process.emit('close', null));
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValue(process as unknown as ReturnType<typeof spawn>);
    return process;
  }
  function runner() {
    return new DjvuProcess({ maxConcurrent: 2, timeoutMs: 100, maxSourceBytes: 1024, cacheBytes: 1024 });
  }

  it('kills a decoder exceeding the deadline', async () => {
    vi.useFakeTimers();
    const process = child();
    const result = runner().run('ddjvu', ['source.djvu'], directory);
    const rejected = expect(result).rejects.toMatchObject({ status: 422 });
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(process.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('kills a decoder producing excessive output', async () => {
    const process = child();
    const result = runner().run('djvused', ['source.djvu'], directory);
    process.stdout.write(Buffer.alloc(1024 * 1024 + 1));
    await expect(result).rejects.toMatchObject({ status: 422 });
    expect(process.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('maps missing executable errors without exposing command paths', async () => {
    const process = child();
    const result = runner().run('ddjvu', ['source.djvu'], directory);
    process.emit('error', new Error('ENOENT'));
    await expect(result).rejects.toMatchObject({ status: 503 });
  });

  it('stops active decoders on shutdown and rejects new work', async () => {
    const process = child();
    const decoder = runner();
    const result = decoder.run('ddjvu', ['source.djvu'], directory);
    decoder.onModuleDestroy();
    await expect(result).rejects.toMatchObject({ status: 422 });
    await expect(decoder.run('ddjvu', [], directory)).rejects.toMatchObject({ status: 503 });
    expect(process.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('reports a decoder prlimit cannot execute as unavailable and bounds CPU by the configured timeout', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      const decoder = child();
      const result = new DjvuProcess({ maxConcurrent: 2, timeoutMs: 45_000, maxSourceBytes: 1024, cacheBytes: 1024 }).run(
        'ddjvu',
        ['source.djvu'],
        directory,
      );
      decoder.emit('close', 127);
      await expect(result).rejects.toMatchObject({ status: 503 });
      expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('prlimit');
      expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain('--cpu=45');
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('passes document paths as arguments without shell execution', async () => {
    const process = child();
    const path = join(directory, 'book;touch marker.djvu');
    await writeFile(path, 'fixture');
    const result = runner().run('djvused', [path, '-e', 'n'], directory);
    process.stdout.end('1\n');
    process.emit('close', 0);
    expect(await result).toBe('1\n');
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain(path);
    expect(vi.mocked(spawn).mock.calls[0]?.[2]).not.toHaveProperty('shell');
  });

  it('preserves multilingual OCR when UTF-8 characters span process output chunks', async () => {
    const process = child();
    const result = runner().run('djvused', ['source.djvu'], directory);
    const text = Buffer.from('日本語の本');
    process.stdout.write(text.subarray(0, 2));
    process.stdout.write(text.subarray(2));
    process.emit('close', 0);
    expect(await result).toBe('日本語の本');
  });
});
