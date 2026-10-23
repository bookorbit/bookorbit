import { EventEmitter } from 'events';

import type { PdfParsed } from './pdf-parser';
import type { PdfParseWorkerFactory, PdfParseWorkerData } from './pdf-parse-worker-runner';
import { parsePdfFileInWorker } from './pdf-parse-worker-runner';

describe('parsePdfFileInWorker', () => {
  const workerData: PdfParseWorkerData = {
    absolutePath: '/books/large.pdf',
    extractCover: true,
  };

  function makeWorkerHarness() {
    const worker = new EventEmitter();
    const createWorker = vi.fn<PdfParseWorkerFactory>().mockReturnValue(worker as never);
    return { worker, createWorker };
  }

  function makeParsed(overrides: Partial<PdfParsed> = {}): PdfParsed {
    return {
      title: 'Worker Title',
      subtitle: null,
      authors: [],
      description: null,
      publisher: null,
      publishedYear: null,
      language: null,
      genres: [],
      tags: [],
      isbn10: null,
      isbn13: null,
      seriesName: null,
      seriesIndex: null,
      rating: null,
      pageCount: null,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      hardcoverEditionId: null,
      openLibraryId: null,
      ranobedbId: null,
      koboId: null,
      lubimyczytacId: null,
      aladinId: null,
      mangabakaId: null,
      mangabakaSeriesId: null,
      itunesId: null,
      coverBuffer: null,
      ...overrides,
    };
  }

  it('resolves with the worker result message', async () => {
    const { worker, createWorker } = makeWorkerHarness();
    const result = { parsed: makeParsed(), warnings: [] };

    const promise = parsePdfFileInWorker(workerData, createWorker);
    worker.emit('message', { type: 'result', result });

    await expect(promise).resolves.toEqual(result);
    expect(createWorker).toHaveBeenCalledWith(workerData);
  });

  it('normalizes cloned cover bytes back to Buffer', async () => {
    const { worker, createWorker } = makeWorkerHarness();
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff]);

    const promise = parsePdfFileInWorker(workerData, createWorker);
    worker.emit('message', { type: 'result', result: { parsed: makeParsed({ coverBuffer: coverBytes as never }), warnings: [] } });

    const result = await promise;
    expect(Buffer.isBuffer(result.parsed?.coverBuffer)).toBe(true);
    expect(result.parsed?.coverBuffer).toEqual(Buffer.from(coverBytes));
  });

  it('rejects with worker error messages and preserves the error class', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = parsePdfFileInWorker(workerData, createWorker);
    worker.emit('message', { type: 'error', errorClass: 'BadPdfError', errorMessage: 'bad pdf' });

    await expect(promise).rejects.toMatchObject({ name: 'BadPdfError', message: 'bad pdf' });
  });

  it('rejects invalid worker messages', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = parsePdfFileInWorker(workerData, createWorker);
    worker.emit('message', { nope: true });

    await expect(promise).rejects.toThrow('PDF parse worker returned an invalid response');
  });

  it('rejects when the worker emits an error event', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = parsePdfFileInWorker(workerData, createWorker);
    worker.emit('error', new Error('thread crashed'));

    await expect(promise).rejects.toThrow('thread crashed');
  });

  it('rejects when the worker exits non-zero before returning a result', async () => {
    const { worker, createWorker } = makeWorkerHarness();

    const promise = parsePdfFileInWorker(workerData, createWorker);
    worker.emit('exit', 1);

    await expect(promise).rejects.toThrow('PDF parse worker exited with code 1');
  });
});
