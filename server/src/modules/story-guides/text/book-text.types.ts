export type BookTextKind = 'epub' | 'mobi';

/** One entry of foliate's `book.sections`, read the way the app's reader index reads it. */
export interface BookTextSection {
  /** Zero-based index in `book.sections`: for an EPUB, the spine including `linear="no"` items. */
  index: number;
  linear: boolean;
  /** The labels of the contents entries that point into this section, in contents order. */
  titles: string[];
  /** Every text node under the body, outside `script` and `style`, joined with nothing between. */
  text: string;
  /** UTF-16 offsets into `text` where each block starts. */
  blocks: number[];
  /** First 8 hex characters of the SHA-256 of the flattened text. */
  hash: string;
  /** Why the section could not be read; the section then has no text. */
  error: string | null;
}

export interface BookText {
  kind: BookTextKind;
  /** The book's language metadata as it stands, not yet normalised. */
  languages: string[];
  sections: BookTextSection[];
}

export type BookTextFailure = 'unreadable' | 'too-large';

export class BookTextError extends Error {
  constructor(
    readonly reason: BookTextFailure,
    message: string,
  ) {
    super(message);
    this.name = 'BookTextError';
  }
}
