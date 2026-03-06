import { readFile, rename, unlink, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { PDFDocument, PDFName } from 'pdf-lib';

import { PdfFormatWriter } from './pdf-format-writer';
import { buildXmp } from './pdf-xmp-builder';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
  };
});

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomUUID: jest.fn(),
  };
});

jest.mock('pdf-lib', () => ({
  PDFDocument: {
    load: jest.fn(),
  },
  PDFName: {
    of: jest.fn((value: string) => `PDFName:${value}`),
  },
}));

jest.mock('./pdf-xmp-builder', () => ({
  buildXmp: jest.fn(),
}));

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockRename = rename as jest.MockedFunction<typeof rename>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockRandomUuid = randomUUID as jest.MockedFunction<typeof randomUUID>;
const mockPdfLoad = PDFDocument.load as jest.MockedFunction<typeof PDFDocument.load>;
const mockPdfNameOf = PDFName.of as jest.MockedFunction<typeof PDFName.of>;
const mockBuildXmp = buildXmp as jest.MockedFunction<typeof buildXmp>;

describe('PdfFormatWriter', () => {
  function makePdfDoc() {
    const stream = jest.fn().mockReturnValue('stream-ref');
    const register = jest.fn().mockReturnValue('registered-stream');
    const set = jest.fn();

    const doc = {
      setTitle: jest.fn(),
      setAuthor: jest.fn(),
      setSubject: jest.fn(),
      setProducer: jest.fn(),
      setCreationDate: jest.fn(),
      setCreator: jest.fn(),
      setKeywords: jest.fn(),
      save: jest.fn().mockResolvedValue(Buffer.from('new-pdf')),
      context: { stream, register },
      catalog: { set },
    };

    return doc;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue(Buffer.from('pdf-bytes') as never);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockRandomUuid.mockReturnValue('abc-uuid');
    mockBuildXmp.mockReturnValue('<xmp />');
  });

  it('returns dry-run result without touching filesystem/pdf-lib', async () => {
    const writer = new PdfFormatWriter();

    const result = await writer.write('/a.pdf', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: true });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('dry-run');
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockPdfLoad).not.toHaveBeenCalled();
  });

  it('writes PDF metadata + XMP and atomically replaces file', async () => {
    const pdfDoc = makePdfDoc();
    mockPdfLoad.mockResolvedValue(pdfDoc as never);

    const writer = new PdfFormatWriter();

    const payload = {
      title: 'Dune',
      authors: [{ name: 'Frank Herbert', sortName: null }],
      description: 'Sci-fi classic',
      publisher: 'Ace',
      publishedYear: 1965,
      genres: ['Sci-Fi'],
      tags: ['Classic'],
    };

    const result = await writer.write('/books/dune.pdf', payload, {
      fieldMask: new Set(['title', 'authors', 'description', 'publisher', 'publishedYear', 'genres', 'tags']),
      dryRun: false,
    });

    expect(mockPdfLoad).toHaveBeenCalledWith(Buffer.from('pdf-bytes'), { ignoreEncryption: true });
    expect(pdfDoc.setTitle).toHaveBeenCalledWith('Dune');
    expect(pdfDoc.setAuthor).toHaveBeenCalledWith('Frank Herbert');
    expect(pdfDoc.setSubject).toHaveBeenCalledWith('Sci-fi classic');
    expect(pdfDoc.setProducer).toHaveBeenCalledWith('Ace');
    expect(pdfDoc.setCreationDate).toHaveBeenCalledWith(new Date(1965, 0, 1));
    expect(pdfDoc.setCreator).toHaveBeenCalledWith('projectx');
    expect(pdfDoc.setKeywords).toHaveBeenCalledWith(['Sci-Fi', 'Classic']);

    expect(mockBuildXmp).toHaveBeenCalled();
    expect(pdfDoc.context.stream).toHaveBeenCalledWith(Buffer.from('<xmp />', 'utf-8'), {
      Type: 'Metadata',
      Subtype: 'XML',
    });
    expect(mockPdfNameOf).toHaveBeenCalledWith('Metadata');
    expect(pdfDoc.catalog.set).toHaveBeenCalledWith('PDFName:Metadata', 'registered-stream');

    expect(mockWriteFile).toHaveBeenCalledWith('/books/.tmp-abc-uuid.pdf', Buffer.from('new-pdf'));
    expect(mockRename).toHaveBeenCalledWith('/books/.tmp-abc-uuid.pdf', '/books/dune.pdf');
    expect(result.status).toBe('success');
  });

  it('deletes temp file when rename fails', async () => {
    const pdfDoc = makePdfDoc();
    mockPdfLoad.mockResolvedValue(pdfDoc as never);
    mockRename.mockRejectedValue(new Error('permission denied'));

    const writer = new PdfFormatWriter();

    await expect(
      writer.write('/books/dune.pdf', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: false }),
    ).rejects.toThrow('permission denied');

    expect(mockUnlink).toHaveBeenCalledWith('/books/.tmp-abc-uuid.pdf');
  });
});
