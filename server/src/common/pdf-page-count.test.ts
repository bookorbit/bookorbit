vi.mock('fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('pdf-lib', () => ({ PDFDocument: { load: vi.fn() } }));

import { readFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';

import { getPdfPageCount } from './pdf-page-count';

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockLoad = PDFDocument.load as MockedFunction<typeof PDFDocument.load>;

describe('getPdfPageCount', () => {
  it('reads the file and returns the page count from pdf-lib', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.4'));
    mockLoad.mockResolvedValue({ getPageCount: () => 42 } as never);

    await expect(getPdfPageCount('/books/a.pdf')).resolves.toBe(42);
    expect(mockLoad).toHaveBeenCalledWith(Buffer.from('%PDF-1.4'), { updateMetadata: false });
  });
});
