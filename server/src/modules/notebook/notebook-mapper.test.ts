import {
  toNotebookBookLabel,
  toNotebookBookmark,
  toNotebookHighlight,
  toNotebookJournal,
  toNotebookReview,
  type NotebookHighlightRow,
  type NotebookLabelRow,
} from './notebook-mapper';

const created = new Date('2026-01-10T00:00:00.000Z');
const updated = new Date('2026-01-12T08:30:00.000Z');

function highlightRow(overrides: Partial<NotebookHighlightRow> = {}): NotebookHighlightRow {
  return {
    id: 4,
    bookId: 9,
    text: 'A passage',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: 'One',
    origin: 'kobo',
    sourceCreatedAt: null,
    createdAt: created,
    updatedAt: updated,
    deletedAt: null,
    starredAt: null,
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    cfiStatus: 'repaired',
    ...overrides,
  };
}

describe('toNotebookHighlight', () => {
  it('maps the hub fields and dates it by when it was highlighted', () => {
    const backdated = new Date('2025-12-31T23:59:59.000Z');
    expect(toNotebookHighlight(highlightRow({ sourceCreatedAt: backdated, starredAt: updated }))).toEqual({
      kind: 'highlight',
      id: 4,
      bookId: 9,
      clientId: null,
      createdAt: '2025-12-31T23:59:59.000Z',
      updatedAt: '2026-01-12T08:30:00.000Z',
      text: 'A passage',
      color: '#FACC15',
      style: 'highlight',
      note: null,
      chapterTitle: 'One',
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      positionStatus: 'repaired',
      origin: 'kobo',
      starredAt: '2026-01-12T08:30:00.000Z',
    });
  });

  it('reports no position status without a CFI row and leaves deletedAt out of active listings', () => {
    const item = toNotebookHighlight(highlightRow({ cfi: null, cfiStatus: null }));
    expect(item.positionStatus).toBeNull();
    expect(item.cfi).toBeNull();
    expect(item).not.toHaveProperty('deletedAt');
  });

  it('reads a CFI without a status as exact', () => {
    expect(toNotebookHighlight(highlightRow({ cfiStatus: null })).positionStatus).toBe('exact');
  });

  it('carries deletedAt for the trash', () => {
    expect(toNotebookHighlight(highlightRow({ deletedAt: updated }), { withDeletedAt: true }).deletedAt).toBe('2026-01-12T08:30:00.000Z');
  });
});

describe('toNotebookJournal', () => {
  it('maps the journal entry fields', () => {
    const row = {
      id: 3,
      clientId: '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13',
      bookId: 9,
      body: 'Thought',
      quote: null,
      chapterTitle: null,
      positionPercent: 12.5,
      cfi: null,
      positionSeconds: null,
      createdAt: created,
      updatedAt: updated,
      deletedAt: null,
    };
    expect(toNotebookJournal(row)).toEqual({
      kind: 'journal',
      id: 3,
      bookId: 9,
      clientId: row.clientId,
      createdAt: created.toISOString(),
      updatedAt: updated.toISOString(),
      body: 'Thought',
      quote: null,
      chapterTitle: null,
      positionPercent: 12.5,
      cfi: null,
      positionSeconds: null,
    });
    expect(toNotebookJournal({ ...row, deletedAt: updated }, { withDeletedAt: true }).deletedAt).toBe(updated.toISOString());
  });
});

describe('toNotebookBookmark', () => {
  it('maps an audiobook bookmark with its time', () => {
    expect(
      toNotebookBookmark({
        id: 8,
        clientId: '8a1c3b0e-0f43-4d61-9d7a-3b6f5a2c9e10',
        bookId: 2,
        title: 'Chapter 3',
        note: null,
        cfi: null,
        positionSeconds: 1234.5,
        origin: 'web',
        createdAt: created,
        updatedAt: updated,
        deletedAt: null,
      }),
    ).toEqual({
      kind: 'bookmark',
      id: 8,
      bookId: 2,
      clientId: '8a1c3b0e-0f43-4d61-9d7a-3b6f5a2c9e10',
      createdAt: created.toISOString(),
      updatedAt: updated.toISOString(),
      title: 'Chapter 3',
      note: null,
      cfi: null,
      positionSeconds: 1234.5,
      origin: 'web',
    });
  });
});

describe('toNotebookReview', () => {
  it('uses the book id as its id and the edit time as both dates', () => {
    expect(toNotebookReview({ bookId: 5, note: 'Loved it', updatedAt: updated, rating: 4 })).toEqual({
      kind: 'review',
      id: 5,
      bookId: 5,
      clientId: null,
      createdAt: updated.toISOString(),
      updatedAt: updated.toISOString(),
      body: 'Loved it',
      rating: 4,
    });
    expect(toNotebookReview({ bookId: 5, note: 'x', updatedAt: updated, rating: null }).rating).toBeNull();
  });
});

describe('toNotebookBookLabel', () => {
  const row: NotebookLabelRow = {
    id: 5,
    title: 'Dune',
    author: 'Frank Herbert, Brian Herbert',
    coverSource: 'extracted',
    coverAspectRatio: '1/1',
    updatedAt: updated,
    readFileId: 77,
    readFileFormat: 'EPUB',
    hasAudio: true,
  };

  it('maps the label with the given cover version', () => {
    expect(toNotebookBookLabel(row, 'audio:x:-')).toEqual({
      id: 5,
      title: 'Dune',
      author: 'Frank Herbert, Brian Herbert',
      hasCover: true,
      coverVersion: 'audio:x:-',
      coverAspectRatio: '1/1',
      readFileId: 77,
      readFileFormat: 'epub',
      hasAudio: true,
    });
  });

  it('falls back to the portrait ratio and reports a book with nothing to read', () => {
    expect(
      toNotebookBookLabel(
        { ...row, coverSource: null, coverAspectRatio: 'odd', readFileId: null, readFileFormat: null, hasAudio: false },
        'legacy:x',
      ),
    ).toMatchObject({ hasCover: false, coverAspectRatio: '2/3', readFileId: null, readFileFormat: null, hasAudio: false });
  });
});
