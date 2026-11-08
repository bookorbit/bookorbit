import type { BookCard } from "./book";

/** Most recognised lines `POST /mobile/visual-match` reads from one photo. */
export const VISUAL_MATCH_MAX_LINES = 24;
/** Longest single recognised line it accepts. */
export const VISUAL_MATCH_MAX_LINE_LENGTH = 200;
/** Most books one answer names. */
export const VISUAL_MATCH_MAX_RESULTS = 4;

export interface VisualMatchRequest {
  /** Text recognised on a photographed cover or spine, one entry per line, in reading order. */
  lines: string[];
  /** An ISBN-10 or ISBN-13 read from a barcode in the same photo. */
  isbn?: string | null;
}

/** How a match was found: the barcode, or the cover's words. A client treats any other value as `text`. */
export type VisualMatchSource = "isbn" | "text";

export interface VisualMatch {
  book: BookCard;
  /** How sure the matcher is, from 0 to 1. */
  confidence: number;
  matchedBy: VisualMatchSource;
  /** The reader's highlights in this book, trashed ones and strikethroughs aside. */
  highlightCount: number;
}

export interface VisualMatchResponse {
  /** Books in the reader's libraries the photo shows, best first. Empty when none matched. */
  matches: VisualMatch[];
  /**
   * An author the library knows, named in the lines, so a client can prefill a book request
   * when the book itself is not in the library. Null when no line names a known author.
   */
  author: string | null;
}
