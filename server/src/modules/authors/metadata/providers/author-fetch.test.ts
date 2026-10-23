import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ProviderCallRecord, runWithProviderCallRecord } from '../../../../common/provider-cache/provider-call-context';
import { authorProviderFetch, authorRequestSignal } from './author-fetch';

describe('authorProviderFetch', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the response and records its status', async () => {
    const response = { status: 200, ok: true };
    global.fetch = vi.fn().mockResolvedValue(response) as never;
    const record = new ProviderCallRecord();

    const result = await runWithProviderCallRecord(record, () => authorProviderFetch('https://example.test/a', { method: 'GET' }));

    expect(result).toBe(response);
    expect(global.fetch).toHaveBeenCalledWith('https://example.test/a', { method: 'GET' });
    expect(record.mainRequests).toBe(1);
    expect(record.unsuccessfulRequests()).toEqual([]);
  });

  it('records a failed status as unsuccessful without throwing', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 503, ok: false }) as never;
    const record = new ProviderCallRecord();

    await runWithProviderCallRecord(record, () => authorProviderFetch('https://example.test/a'));

    expect(record.unsuccessfulRequests()).toEqual([{ kind: 'status', status: 503 }]);
  });

  it('records a transport error and rethrows it', async () => {
    const error = new TypeError('fetch failed');
    global.fetch = vi.fn().mockRejectedValue(error) as never;
    const record = new ProviderCallRecord();

    await expect(runWithProviderCallRecord(record, () => authorProviderFetch('https://example.test/a'))).rejects.toBe(error);
    expect(record.unsuccessfulRequests()).toEqual([{ kind: 'error', errorClass: 'TypeError' }]);
  });

  it('records an abort as aborted', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')) as never;
    const record = new ProviderCallRecord();

    await expect(runWithProviderCallRecord(record, () => authorProviderFetch('https://example.test/a'))).rejects.toThrow('aborted');
    expect(record.unsuccessfulRequests()).toEqual([{ kind: 'aborted' }]);
  });

  it('keeps only the final outcome of a retried request', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ status: 503, ok: false }).mockResolvedValueOnce({ status: 200, ok: true }) as never;
    const record = new ProviderCallRecord();

    await runWithProviderCallRecord(record, async () => {
      await authorProviderFetch('https://example.test/a');
      await authorProviderFetch('https://example.test/a');
    });

    expect(record.mainRequests).toBe(1);
    expect(record.outboundRequests).toBe(2);
    expect(record.unsuccessfulRequests()).toEqual([]);
  });

  it('works outside a call record', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200, ok: true }) as never;

    await expect(authorProviderFetch('https://example.test/a')).resolves.toEqual({ status: 200, ok: true });
  });
});

describe('authorRequestSignal', () => {
  it('aborts when the caller aborts before the timeout', () => {
    const controller = new AbortController();
    const signal = authorRequestSignal(60_000, controller.signal);

    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('falls back to the timeout alone without a caller signal', async () => {
    const signal = authorRequestSignal(5);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signal.aborted).toBe(true);
  });
});

describe('author provider network guard', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
    });
  }

  it('routes every provider request through authorProviderFetch', () => {
    const offenders = sourceFiles(__dirname)
      .filter((path) => !path.endsWith('author-fetch.ts'))
      .filter((path) => /(?<![\w$.])fetch\s*\(|globalThis\s*\.\s*fetch\s*\(/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(__dirname, path));

    expect(offenders).toEqual([]);
  });
});
