import { EventEmitter } from 'events';
import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import type { WriteResult } from '@bookorbit/types';
import type { PdfWorkerFactory, PdfWriteRequest, PdfWriteWorkerData } from './pdf-worker-runner';
import { PDF_WORKER_TIMEOUT_MS, writePdfMetadataInWorker } from './pdf-worker-runner';

describe('writePdfMetadataInWorker', () => {
  const workerData: PdfWriteRequest = {
    filePath: '/books/large.pdf',
    payload: { title: 'Dune' },
    fieldMask: ['title'],
  };

  function makeWorkerHarness() {
    const worker = Object.assign(new EventEmitter(), {
      terminate: vi.fn(() => {
        worker.emit('exit', 1);
        return Promise.resolve(1);
      }),
    });
    const createWorker = vi.fn<PdfWorkerFactory>().mockReturnValue(worker as never);
    const workerTempPath = (): string => (createWorker.mock.calls[0]![0] as PdfWriteWorkerData).tempPath;
    return { worker, createWorker, workerTempPath };
  }

  async function exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false,
    );
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the worker result message', async () => {
    const { worker, createWorker } = makeWorkerHarness();
    const result: WriteResult = { status: 'success', fieldsWritten: ['title'], durationMs: 50 };

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('message', { type: 'result', result });

    await expect(promise).resolves.toEqual(result);
    expect(createWorker).toHaveBeenCalledWith({ ...workerData, tempPath: expect.stringMatching(/^\/books\/\.tmp-[0-9a-f-]+\.pdf$/) });
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('rejects with worker error messages and preserves the error class', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('message', { type: 'error', errorClass: 'BadPdfError', errorMessage: 'bad pdf' });

    await expect(promise).rejects.toMatchObject({ name: 'BadPdfError', message: 'bad pdf' });
  });

  it('rejects invalid worker messages', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('message', { nope: true });

    await expect(promise).rejects.toThrow('PDF write worker returned an invalid response');
  });

  it('rejects when the worker emits an error event', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('error', new Error('thread crashed'));

    await expect(promise).rejects.toThrow('thread crashed');
  });

  it('rejects when the worker exits non-zero before returning a result', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('exit', 1);

    await expect(promise).rejects.toThrow('PDF write worker exited with code 1');
  });

  it('ignores exit events after a result has settled the worker', async () => {
    const { worker, createWorker } = makeWorkerHarness();
    const result: WriteResult = { status: 'skipped', fieldsWritten: [], durationMs: 12, reason: 'encrypted-pdf' };

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('message', { type: 'result', result });
    worker.emit('exit', 1);

    await expect(promise).resolves.toEqual(result);
  });

  it('rejects when the worker exits cleanly without sending a result', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('exit', 0);

    await expect(promise).rejects.toThrow('PDF write worker exited without a result');
  });

  it('terminates a worker that never answers and rejects with a timeout', async () => {
    vi.useFakeTimers();
    const { worker, createWorker } = makeWorkerHarness();

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    const assertion = expect(promise).rejects.toMatchObject({ name: 'TimeoutError', message: 'PDF write timed out after 300s' });
    await vi.advanceTimersByTimeAsync(PDF_WORKER_TIMEOUT_MS);

    await assertion;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('clears the timeout once the worker settles', async () => {
    vi.useFakeTimers();
    const { worker, createWorker } = makeWorkerHarness();
    const result: WriteResult = { status: 'success', fieldsWritten: ['title'], durationMs: 5 };

    const promise = writePdfMetadataInWorker(workerData, createWorker);
    worker.emit('message', { type: 'result', result });
    await expect(promise).resolves.toEqual(result);

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(PDF_WORKER_TIMEOUT_MS);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  describe('partial temp files', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'pdf-runner-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('removes the temp file left by a worker it terminated on timeout', async () => {
      const { createWorker, workerTempPath } = makeWorkerHarness();

      const promise = writePdfMetadataInWorker({ ...workerData, filePath: join(dir, 'large.pdf') }, createWorker, 20);
      expect(dirname(workerTempPath())).toBe(dir);
      await writeFile(workerTempPath(), 'partial');

      await expect(promise).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(await exists(workerTempPath())).toBe(false);
    });

    it('removes the temp file when the worker crashes', async () => {
      const { worker, createWorker, workerTempPath } = makeWorkerHarness();

      const promise = writePdfMetadataInWorker({ ...workerData, filePath: join(dir, 'large.pdf') }, createWorker);
      await writeFile(workerTempPath(), 'partial');
      worker.emit('exit', 134);

      await expect(promise).rejects.toThrow('PDF write worker exited with code 134');
      expect(await exists(workerTempPath())).toBe(false);
    });
  });
});
