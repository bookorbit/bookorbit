import { BadRequestException } from '@nestjs/common';

import { decodeNotebookCursor, encodeNotebookCursor, type NotebookCursor } from './notebook-cursor';

function rawCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('notebook cursor', () => {
  const cursor: NotebookCursor = { scope: 'newest', key: '2026-03-04T05:06:07.123456Z', rank: 2, id: 981 };

  it('round-trips every field, keeping the key to the microsecond', () => {
    const encoded = encodeNotebookCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeNotebookCursor(encoded, 'newest')).toEqual(cursor);
  });

  it.each(['oldest', 'edited', 'books', 'trash'] as const)('round-trips the %s scope', (scope) => {
    expect(decodeNotebookCursor(encodeNotebookCursor({ ...cursor, scope }), scope)).toEqual({ ...cursor, scope });
  });

  it('rejects a cursor issued for another sort', () => {
    const encoded = encodeNotebookCursor(cursor);
    expect(() => decodeNotebookCursor(encoded, 'oldest')).toThrow(BadRequestException);
    expect(() => decodeNotebookCursor(encoded, 'oldest')).toThrow('Cursor belongs to a different listing or sort');
    expect(() => decodeNotebookCursor(encoded, 'trash')).toThrow(BadRequestException);
  });

  it.each([
    ['not base64url', 'abc+/='],
    ['not JSON', Buffer.from('nope', 'utf8').toString('base64url')],
    ['an array', rawCursor([1, 2])],
    ['null', rawCursor(null)],
    ['a missing key', rawCursor({ s: 'newest', k: 0, i: 1 })],
    ['a numeric key', rawCursor({ s: 'newest', t: 1, k: 0, i: 1 })],
    ['a millisecond key', rawCursor({ s: 'newest', t: '2026-03-04T05:06:07.123Z', k: 0, i: 1 })],
    ['an impossible date', rawCursor({ s: 'newest', t: '2026-13-04T05:06:07.123456Z', k: 0, i: 1 })],
    ['SQL in the key', rawCursor({ s: 'newest', t: "2026-03-04'; drop table x; --", k: 0, i: 1 })],
    ['an unknown kind rank', rawCursor({ s: 'newest', t: cursor.key, k: 4, i: 1 })],
    ['a fractional rank', rawCursor({ s: 'newest', t: cursor.key, k: 0.5, i: 1 })],
    ['a zero id', rawCursor({ s: 'newest', t: cursor.key, k: 0, i: 0 })],
    ['an id past int4', rawCursor({ s: 'newest', t: cursor.key, k: 0, i: 2_147_483_648 })],
    ['a string id', rawCursor({ s: 'newest', t: cursor.key, k: 0, i: '5' })],
  ])('rejects %s', (_label, raw) => {
    expect(() => decodeNotebookCursor(raw, 'newest')).toThrow(BadRequestException);
  });
});
