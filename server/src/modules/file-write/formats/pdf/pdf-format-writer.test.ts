import { readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import type { MockedFunction } from 'vitest';
import { randomUUID } from 'crypto';
import { PDFDocument, PDFName } from 'pdf-lib';

import { PDF_WORKER_WRITE_THRESHOLD_BYTES, PdfFormatWriter } from './pdf-format-writer';
import { buildXmp } from './pdf-xmp-builder';
import { writePdfMetadataInWorker } from './pdf-worker-runner';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
  };
});

vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomUUID: vi.fn(),
  };
});

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn(),
  },
  PDFName: {
    of: vi.fn((value: string) => `PDFName:${value}`),
  },
}));

vi.mock('./pdf-xmp-builder', () => ({
  buildXmp: vi.fn(),
}));

vi.mock('./pdf-worker-runner', () => ({
  writePdfMetadataInWorker: vi.fn(),
}));

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockStat = stat as MockedFunction<typeof stat>;
const mockWriteFile = writeFile as MockedFunction<typeof writeFile>;
const mockRename = rename as MockedFunction<typeof rename>;
const mockUnlink = unlink as MockedFunction<typeof unlink>;
const mockRandomUuid = randomUUID as MockedFunction<typeof randomUUID>;
const mockPdfLoad = PDFDocument.load as MockedFunction<typeof PDFDocument.load>;
const mockPdfNameOf = PDFName.of as MockedFunction<typeof PDFName.of>;
const mockBuildXmp = buildXmp as MockedFunction<typeof buildXmp>;
const mockWritePdfMetadataInWorker = writePdfMetadataInWorker as MockedFunction<typeof writePdfMetadataInWorker>;

describe('PdfFormatWriter', () => {
  function makePdfDoc(overrides: { isEncrypted?: boolean } = {}) {
    const stream = vi.fn().mockReturnValue('stream-ref');
    const register = vi.fn().mockReturnValue('registered-stream');
    const set = vi.fn();

    const doc = {
      isEncrypted: overrides.isEncrypted ?? false,
      setTitle: vi.fn(),
      setAuthor: vi.fn(),
      setSubject: vi.fn(),
      setProducer: vi.fn(),
      setCreationDate: vi.fn(),
      setCreator: vi.fn(),
      setKeywords: vi.fn(),
      save: vi.fn().mockResolvedValue(Buffer.from('new-pdf')),
      context: { stream, register },
      catalog: { set },
    };

    return doc;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(Buffer.from('pdf-bytes') as never);
    mockStat.mockResolvedValue({ size: PDF_WORKER_WRITE_THRESHOLD_BYTES - 1 } as never);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockRandomUuid.mockReturnValue('abc-uuid');
    mockBuildXmp.mockReturnValue('<xmp />');
    mockWritePdfMetadataInWorker.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 200 });
  });

  it('returns dry-run result without touching filesystem/pdf-lib', async () => {
    const writer = new PdfFormatWriter();

    const result = await writer.write('/a.pdf', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: true });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('dry-run');
    expect(mockStat).not.toHaveBeenCalled();
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
    expect(pdfDoc.setCreationDate).toHaveBeenCalledWith(new Date('1965-01-01T00:00:00.000Z'));
    expect(pdfDoc.setCreator).toHaveBeenCalledWith('bookorbit');
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

  it('delegates large PDFs to a worker without loading or saving on the main thread', async () => {
    mockStat.mockResolvedValue({ size: PDF_WORKER_WRITE_THRESHOLD_BYTES } as never);

    const writer = new PdfFormatWriter();
    const payload = {
      title: 'Dune',
      authors: [{ name: 'Frank Herbert', sortName: null }],
      coverBytes: Buffer.from('cover'),
    };

    const result = await writer.write('/books/large.pdf', payload, {
      fieldMask: new Set(['title', 'authors', 'coverBytes']),
      dryRun: false,
    });

    expect(mockWritePdfMetadataInWorker).toHaveBeenCalledWith({
      filePath: '/books/large.pdf',
      payload,
      fieldMask: ['title', 'authors'],
    });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockPdfLoad).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'success', fieldsWritten: ['title'] });
    expect(typeof result.durationMs).toBe('number');
  });

  it('propagates worker failures for large PDFs', async () => {
    mockStat.mockResolvedValue({ size: PDF_WORKER_WRITE_THRESHOLD_BYTES + 1 } as never);
    mockWritePdfMetadataInWorker.mockRejectedValue(new Error('worker failed'));

    const writer = new PdfFormatWriter();

    await expect(writer.write('/books/large.pdf', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: false })).rejects.toThrow(
      'worker failed',
    );

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockPdfLoad).not.toHaveBeenCalled();
  });

  it('deletes temp file when rename fails', async () => {
    const pdfDoc = makePdfDoc();
    mockPdfLoad.mockResolvedValue(pdfDoc as never);
    mockRename.mockRejectedValue(new Error('permission denied'));

    const writer = new PdfFormatWriter();

    await expect(writer.write('/books/dune.pdf', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: false })).rejects.toThrow(
      'permission denied',
    );

    expect(mockUnlink).toHaveBeenCalledWith('/books/.tmp-abc-uuid.pdf');
  });

  it('skips encrypted PDFs without mutating or rewriting the file', async () => {
    const pdfDoc = makePdfDoc({ isEncrypted: true });
    mockPdfLoad.mockResolvedValue(pdfDoc as never);

    const writer = new PdfFormatWriter();

    const result = await writer.write('/books/secret.pdf', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: false });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('encrypted-pdf');
    expect(result.fieldsWritten).toEqual([]);
    expect(typeof result.durationMs).toBe('number');

    // The file must be left untouched: no metadata applied, nothing saved or replaced.
    expect(pdfDoc.setTitle).not.toHaveBeenCalled();
    expect(pdfDoc.save).not.toHaveBeenCalled();
    expect(mockBuildXmp).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('checks encryption before mutating, even when no writable fields are in the mask', async () => {
    const pdfDoc = makePdfDoc({ isEncrypted: true });
    mockPdfLoad.mockResolvedValue(pdfDoc as never);

    const writer = new PdfFormatWriter();

    const result = await writer.write('/books/secret.pdf', { title: 'Dune' }, { fieldMask: new Set([]), dryRun: false });

    expect(mockPdfLoad).toHaveBeenCalledWith(Buffer.from('pdf-bytes'), { ignoreEncryption: true });
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('encrypted-pdf');
    expect(pdfDoc.setCreator).not.toHaveBeenCalled();
    expect(pdfDoc.save).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
