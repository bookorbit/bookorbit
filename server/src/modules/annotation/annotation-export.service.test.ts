import { describe, expect, it } from 'vitest';

import { AnnotationExportService } from './annotation-export.service';
import type { HubAnnotationRow } from './annotation.repository';

function makeRow(overrides: Partial<HubAnnotationRow> = {}): HubAnnotationRow {
  return {
    id: 1,
    userId: 7,
    bookId: 20,
    text: 'The quick brown fox',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: 'Chapter 1',
    origin: 'web',
    version: 1,
    deletedAt: null,
    deviceCreatedAt: null,
    deviceUpdatedAt: null,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    updatedAt: new Date('2026-06-01T10:00:00Z'),
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)',
    cfiStatus: 'exact',
    cfiExtras: null,
    bookTitle: 'Test Book',
    jumpFileId: 10,
    pageno: null,
    ...overrides,
  } as HubAnnotationRow;
}

describe('AnnotationExportService', () => {
  const service = new AnnotationExportService();

  it('renders markdown grouped by book and chapter with quotes and notes', () => {
    const rows = [
      makeRow(),
      makeRow({ id: 2, text: 'Second highlight', note: 'my note', chapterTitle: 'Chapter 2' }),
      makeRow({ id: 3, bookTitle: 'Another Book', chapterTitle: null, text: 'Other book text', origin: 'koreader' }),
    ];

    const result = service.export(rows, 'md', 'library');

    expect(result.contentType).toContain('markdown');
    expect(result.filename).toMatch(/^library-annotations-\d{4}-\d{2}-\d{2}\.md$/);
    expect(result.content).toContain('## Test Book');
    expect(result.content).toContain('### Chapter 1');
    expect(result.content).toContain('> The quick brown fox');
    expect(result.content).toContain('Note: my note');
    expect(result.content).toContain('## Another Book');
    expect(result.content).toContain('koreader');
  });

  it('escapes CSV fields containing quotes, commas and newlines', () => {
    const rows = [makeRow({ text: 'He said "hi", twice\nand left', note: 'plain' })];

    const result = service.export(rows, 'csv', 'book-20');

    expect(result.contentType).toContain('csv');
    expect(result.content).toContain('"He said ""hi"", twice\nand left"');
    expect(result.content.split('\r\n')[0]).toBe('book,chapter,text,note,color,style,origin,createdAt');
  });

  it('renders JSON with stable fields', () => {
    const result = service.export([makeRow()], 'json', 'library');

    const parsed = JSON.parse(result.content) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: 1,
      bookTitle: 'Test Book',
      text: 'The quick brown fox',
      origin: 'web',
      cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)',
    });
  });
});
