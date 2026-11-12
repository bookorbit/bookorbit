import type { MockedFunction } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'child_process';
import { readPdfIsbnHits } from './pdf-isbn-scan';

const mockExecFile = execFile as MockedFunction<typeof execFile>;

type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

function answerPages(textFor: (first: string, last: string) => string): string[][] {
  const calls: string[][] = [];
  mockExecFile.mockImplementation(((file: string, args: string[], _options: unknown, callback: ExecCallback) => {
    expect(file).toBe('pdftotext');
    calls.push(args);
    const first = args[args.indexOf('-f') + 1];
    const last = args[args.indexOf('-l') + 1];
    callback(null, { stdout: textFor(first, last), stderr: '' });
    return {} as never;
  }) as never);
  return calls;
}

describe('readPdfIsbnHits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the first ten and last five pages of a long PDF', async () => {
    const calls = answerPages((first) => (first === '1' ? 'Copyright. ISBN 978-0-306-40615-7' : 'Also available: ISBN 978-1-63576-626-4'));

    const hits = await readPdfIsbnHits('/books/book.pdf', 300);

    expect(calls).toEqual([
      ['-q', '-enc', 'UTF-8', '-f', '1', '-l', '10', '/books/book.pdf', '-'],
      ['-q', '-enc', 'UTF-8', '-f', '296', '-l', '300', '/books/book.pdf', '-'],
    ]);
    expect(hits?.map((hit) => hit.value)).toEqual(['9780306406157', '9781635766264']);
  });

  it('reads a short PDF in one pass', async () => {
    const calls = answerPages(() => 'ISBN 978-0-306-40615-7');
    await readPdfIsbnHits('/books/short.pdf', 12);
    expect(calls).toEqual([['-q', '-enc', 'UTF-8', '-f', '1', '-l', '12', '/books/short.pdf', '-']]);
  });

  it('reads the first ten pages when the page count is unknown', async () => {
    const calls = answerPages(() => '');
    expect(await readPdfIsbnHits('/books/unknown.pdf', null)).toEqual([]);
    expect(calls).toEqual([['-q', '-enc', 'UTF-8', '-f', '1', '-l', '10', '/books/unknown.pdf', '-']]);
  });

  it('bounds pdftotext with a timeout and an output cap', async () => {
    answerPages(() => '');
    await readPdfIsbnHits('/books/book.pdf', 5);
    expect(mockExecFile.mock.calls[0][2]).toEqual({ timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
  });

  it('returns null when pdftotext fails', async () => {
    mockExecFile.mockImplementation(((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(new Error('pdftotext missing'));
      return {} as never;
    }) as never);
    expect(await readPdfIsbnHits('/books/book.pdf', 5)).toBeNull();
  });
});
