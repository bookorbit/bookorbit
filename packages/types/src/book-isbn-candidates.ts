/**
 * The edition a book names beside a printed ISBN, such as "eBook ISBN" or "(hardcover)". Read from
 * free text, so it is a hint for a person choosing between ISBNs, never a fact to act on.
 */
export type BookIsbnEditionHint = "ebook" | "hardcover" | "paperback" | "print" | "audio";

/** One ISBN printed in a book's text, with both forms when the ISBN has both. */
export interface BookIsbnCandidate {
  isbn13: string;
  /** Null for a 979 ISBN, which has no ISBN-10 form. */
  isbn10: string | null;
  edition: BookIsbnEditionHint | null;
  /** The words around the ISBN as the book prints them, so a person can tell editions apart. */
  context: string;
}

/** `GET /books/:id/isbn-candidates`: the ISBNs printed in the front and back pages of the primary file. */
export interface BookIsbnCandidates {
  /** False when the file's text cannot be read: a format without readable text, DRM, or an unreadable file. */
  readable: boolean;
  candidates: BookIsbnCandidate[];
}
