import type { JsonSchema } from './ai-client.types';

/** What a photo shows: one book's cover, or a shelf of spines and covers. */
export type AiVisionKind = 'cover' | 'shelf';

/** A book the model read in a photo. The box is in fractions of the photo, origin top left. */
export interface AiVisionBook {
  title: string;
  author: string | null;
  box: { x: number; y: number; width: number; height: number } | null;
}

/** The most books one photo yields; a full shelf rarely shows more. */
export const AI_VISION_MAX_BOOKS = 40;
/** Long enough for a full shelf from a reasoning model; a reply cut short is retried with double. */
export const AI_VISION_MAX_OUTPUT_TOKENS = 6000;

const MAX_TITLE_CHARS = 300;
const MAX_AUTHOR_CHARS = 200;

export const AI_VISION_SYSTEM = `You read the books in a photo for a personal library app. List each book whose title you can read on its spine or cover. Copy the title and the author as printed, correcting only obvious misreadings; leave out series numbers, publisher names and taglines. Give the author as null when none is visible. Never guess a book you cannot read.

For each book give its box as [left, top, right, bottom], each from 0 to 1000 across the photo's width and height, measured from the top-left corner. Give the box as null when unsure.`;

export function aiVisionUser(kind: AiVisionKind): string {
  return kind === 'cover'
    ? 'This photo shows the front cover of a book. List that book first, then any other book clearly readable in the photo.'
    : 'This photo shows books on a shelf or in a pile. List them in order: left to right, top shelf first.';
}

export const AI_VISION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: ['string', 'null'] },
          box: { type: ['array', 'null'], items: { type: 'number' } },
        },
        required: ['title', 'author', 'box'],
        additionalProperties: false,
      },
    },
  },
  required: ['books'],
  additionalProperties: false,
};

/** The books in a reply, cleaned: blank titles dropped, text trimmed and capped, boxes checked. */
export function parseVisionBooks(json: unknown): AiVisionBook[] {
  const list = (json as { books?: unknown } | null | undefined)?.books;
  if (!Array.isArray(list)) return [];
  const books: AiVisionBook[] = [];
  for (const entry of list) {
    if (books.length >= AI_VISION_MAX_BOOKS) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const { title, author, box } = entry as Record<string, unknown>;
    const cleanTitle = typeof title === 'string' ? clean(title, MAX_TITLE_CHARS) : '';
    if (!cleanTitle) continue;
    const cleanAuthor = typeof author === 'string' ? clean(author, MAX_AUTHOR_CHARS) : '';
    books.push({ title: cleanTitle, author: cleanAuthor || null, box: boxOf(box) });
  }
  return books;
}

function clean(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A [left, top, right, bottom] box on the 0 to 1000 scale, as fractions; null when it is not one. */
function boxOf(value: unknown): AiVisionBook['box'] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [left, top, right, bottom] = (value as number[]).map((n) => Math.min(Math.max(n, 0), 1000) / 1000);
  if (right <= left || bottom <= top) return null;
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
}
