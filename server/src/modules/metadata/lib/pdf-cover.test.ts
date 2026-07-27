import type { MockedFunction } from 'vitest';

vi.mock('fs/promises', () => ({
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { extractPdfCover } from './pdf-cover';

const mockExecFile = execFile as MockedFunction<typeof execFile>;
const mockMkdtemp = mkdtemp as MockedFunction<typeof mkdtemp>;
const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockRm = rm as MockedFunction<typeof rm>;

describe('extractPdfCover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdtemp.mockResolvedValue('/tmp/pdf-cover-abc');
  });

  it('extracts first-page jpeg bytes and always cleans up temp directory', async () => {
    const coverBytes = Buffer.from('cover-bytes');
    mockExecFile.mockImplementation((file, args, optionsOrCallback, maybeCallback) => {
      expect(file).toBe('pdftoppm');
      expect(args).toEqual(['-jpeg', '-singlefile', '-r', '150', '-f', '1', '-l', '1', '/books/test.pdf', '/tmp/pdf-cover-abc/cover']);
      const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback?.(null, '', '');
      return {} as never;
    });
    mockReadFile.mockResolvedValue(coverBytes);

    await expect(extractPdfCover('/books/test.pdf')).resolves.toEqual(coverBytes);
    expect(mockReadFile).toHaveBeenCalledWith('/tmp/pdf-cover-abc/cover.jpg');
    expect(mockRm).toHaveBeenCalledWith('/tmp/pdf-cover-abc', { recursive: true, force: true });
  });

  it('invokes pdftoppm with a bounded timeout and maxBuffer', async () => {
    mockExecFile.mockImplementation((_file, _args, optionsOrCallback, maybeCallback) => {
      const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback?.(null, '', '');
      return {} as never;
    });
    mockReadFile.mockResolvedValue(Buffer.from('cover-bytes'));

    await extractPdfCover('/books/test.pdf');

    expect(mockExecFile).toHaveBeenCalledWith('pdftoppm', expect.any(Array), { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 }, expect.any(Function));
  });

  it('cleans up temp directory even when pdftoppm fails', async () => {
    mockExecFile.mockImplementation((_file, _args, optionsOrCallback, maybeCallback) => {
      const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback?.(new Error('pdftoppm missing'), '', '');
      return {} as never;
    });

    await expect(extractPdfCover('/books/test.pdf')).rejects.toThrow('pdftoppm missing');
    expect(mockRm).toHaveBeenCalledWith('/tmp/pdf-cover-abc', { recursive: true, force: true });
  });
});
