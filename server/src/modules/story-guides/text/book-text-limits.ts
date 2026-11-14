/**
 * What the text worker will read of a book. A zip book (EPUB, KEPUB) is measured by what its spine
 * documents unpack to, as the zip directory declares it, so audio, images and fonts never count: a
 * read-along EPUB is mostly narration the worker never opens. A MOBI or AZW3 is measured by its size.
 */
export interface BookTextLimits {
  /** A book that is not a zip is refused past this size. */
  maxFileBytes: number;
  /** A zip with more entries than this is refused before its package is read. */
  maxEntries: number;
  /** The most one spine document may unpack to. */
  maxDocumentBytes: number;
  /** The most the spine documents may unpack to together. */
  maxTextBytes: number;
}

const MIB = 1024 * 1024;

/**
 * jsdom holds a parsed document in about 36 times its size of heap in the densest read-along markup
 * (a span around every word), so the largest document stays well inside the worker's heap.
 */
export const BOOK_TEXT_LIMITS: BookTextLimits = {
  maxFileBytes: 500 * MIB,
  maxEntries: 10_000,
  maxDocumentBytes: 16 * MIB,
  maxTextBytes: 128 * MIB,
};
