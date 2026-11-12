import type { BookFileTextRow } from '../../db/schema';

/** The formats a story guide reads, as `book_files.format` names them. */
export const STORY_TEXT_FORMATS: readonly string[] = ['epub', 'kepub', 'mobi', 'azw3', 'azw'];

export function isStoryTextFormat(format: string | null | undefined): boolean {
  return !!format && STORY_TEXT_FORMATS.includes(format.toLowerCase());
}

export interface StoryTextFile {
  id: number;
  bookId: number;
  absolutePath: string;
  sizeBytes: number | null;
  mtime: Date | null;
  format: string | null;
}

/** Moves a guide from a file's old text key to its new one when the extraction rules change. */
export interface StoryTextKeyMoves {
  move(fromKey: string, toKey: string): Promise<boolean>;
}

export const STORY_TEXT_KEY_MOVES = Symbol('STORY_TEXT_KEY_MOVES');

/** Why a file's cached text cannot be built from, if it cannot. */
export type StoryTextRefusal = 'unreadable' | 'too-large' | 'language' | 'too-short' | 'too-long';

export type StoryTextRow = BookFileTextRow;
