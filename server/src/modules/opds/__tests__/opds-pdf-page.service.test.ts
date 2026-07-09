vi.mock('child_process', () => ({ execFile: vi.fn() }));
vi.mock('fs/promises', () => ({ mkdir: vi.fn(), rm: vi.fn(), stat: vi.fn() }));

import { execFile } from 'child_process';
import { mkdir, rm, stat } from 'fs/promises';

import { OpdsPdfPageService } from '../opds-pdf-page.service';

const mockExecFile = execFile as unknown as MockedFunction<(...args: unknown[]) => void>;
const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockRm = rm as MockedFunction<typeof rm>;
const mockStat = stat as MockedFunction<typeof stat>;

function makeService() {
  const config = { get: vi.fn().mockReturnValue('/data') };
  return new OpdsPdfPageService(config as never);
}

beforeEach(() => {
  mockExecFile.mockClear();
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, out: { stdout: string; stderr: string }) => void;
    cb(null, { stdout: '', stderr: '' });
  });
});

describe('OpdsPdfPageService', () => {
  it('returns the cached page path without invoking pdftoppm when it already exists', async () => {
    mockStat.mockResolvedValue({} as never);
    const service = makeService();

    const path = await service.ensurePage(1, '/books/a.pdf', 3);
    expect(path).toBe('/data/pse-cache/1/3.jpg');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('renders the page via pdftoppm (1-based page number) when not cached', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));
    const service = makeService();

    const path = await service.ensurePage(1, '/books/a.pdf', 0);
    expect(path).toBe('/data/pse-cache/1/0.jpg');
    expect(mockMkdir).toHaveBeenCalledWith('/data/pse-cache/1', { recursive: true });
    expect(mockExecFile).toHaveBeenCalledWith(
      'pdftoppm',
      ['-jpeg', '-singlefile', '-r', '150', '-f', '1', '-l', '1', '/books/a.pdf', '/data/pse-cache/1/0'],
      { timeout: 30_000 },
      expect.any(Function),
    );
  });

  it('dedupes concurrent requests for the same page into a single pdftoppm invocation', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));
    const service = makeService();

    const [first, second] = await Promise.all([service.ensurePage(1, '/books/a.pdf', 0), service.ensurePage(1, '/books/a.pdf', 0)]);

    expect(first).toBe('/data/pse-cache/1/0.jpg');
    expect(second).toBe('/data/pse-cache/1/0.jpg');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('does not dedupe requests for different pages of the same file', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));
    const service = makeService();

    await Promise.all([service.ensurePage(1, '/books/a.pdf', 0), service.ensurePage(1, '/books/a.pdf', 1)]);

    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('invalidate removes the file cache directory for the file', async () => {
    mockRm.mockResolvedValue(undefined);
    const service = makeService();

    await service.invalidate(9);
    expect(mockRm).toHaveBeenCalledWith('/data/pse-cache/9', { recursive: true, force: true });
  });
});
