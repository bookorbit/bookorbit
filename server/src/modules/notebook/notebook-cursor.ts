import { BadRequestException } from '@nestjs/common';

import { NOTEBOOK_ENTRY_KINDS, type NotebookSort } from '@bookorbit/types';

/** Which listing a cursor pages: an entry sort, the books list, or the trash. */
export type NotebookCursorScope = NotebookSort | 'books' | 'trash';

/**
 * A keyset position. `key` is the sort timestamp exactly as the database rendered it, to the
 * microsecond, so the next page compares against the stored value and not a rounded copy of it.
 */
export interface NotebookCursor {
  scope: NotebookCursorScope;
  key: string;
  rank: number;
  id: number;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const SORT_KEY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const PG_INT_MAX = 2_147_483_647;

function invalid(): BadRequestException {
  return new BadRequestException('Invalid cursor');
}

export function encodeNotebookCursor(cursor: NotebookCursor): string {
  return Buffer.from(JSON.stringify({ s: cursor.scope, t: cursor.key, k: cursor.rank, i: cursor.id }), 'utf8').toString('base64url');
}

export function decodeNotebookCursor(raw: string, scope: NotebookCursorScope): NotebookCursor {
  if (!BASE64URL_RE.test(raw)) throw invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalid();
  const { s, t, k, i } = parsed as Record<string, unknown>;
  if (typeof s !== 'string' || typeof t !== 'string' || typeof k !== 'number' || typeof i !== 'number') throw invalid();
  if (s !== scope) throw new BadRequestException('Cursor belongs to a different listing or sort');
  if (!SORT_KEY_RE.test(t) || Number.isNaN(Date.parse(t.slice(0, 23) + 'Z'))) throw invalid();
  if (!Number.isInteger(k) || k < 0 || k >= NOTEBOOK_ENTRY_KINDS.length) throw invalid();
  if (!Number.isInteger(i) || i < 1 || i > PG_INT_MAX) throw invalid();
  return { scope: s, key: t, rank: k, id: i };
}
