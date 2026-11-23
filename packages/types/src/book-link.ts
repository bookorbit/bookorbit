import { isAudioFormat, type BookCard, type BookMediaKind } from "./book";

/** At most this many books share one link group. */
export const BOOK_LINK_MAX_MEMBERS = 10;

/** The error code for joining a group that holds a book the user cannot see or edit. Names no member. */
export const LINK_GROUP_NOT_EDITABLE_ERROR_CODE = "LINK_GROUP_NOT_EDITABLE";

/** The error code for a link that would put more than {@link BOOK_LINK_MAX_MEMBERS} books in one group. */
export const LINK_GROUP_FULL_ERROR_CODE = "LINK_GROUP_FULL";

/** Another book shown as the same title: a separate record, often in another library. */
export type LinkedBookSummary = {
  bookId: number;
  libraryId: number;
  libraryName: string;
  title: string | null;
  /** Lowercase formats of its content files, primary first. */
  formats: string[];
  mediaKind: BookMediaKind;
  status: string;
  /** The group's main book: a collapsed card shows it when the viewer has read none of the group. */
  isLead: boolean;
  /** What sets this edition apart, as the user wrote it. The fields below are absent from servers without `book-editions`. */
  editionName?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  originalPublishedYear?: number | null;
  narrators?: string[];
  /** Changes when the cover does; a cache key for its thumbnail. */
  coverUpdatedAt?: string | null;
  /** The viewer's own progress in this edition, or null when they have not started it. */
  progress?: LinkedBookProgress | null;
  /** When the viewer last read or listened to this edition. */
  lastReadAt?: string | null;
};

export type LinkedBookProgress = {
  /** 0 to 100. */
  percentage: number;
  finished: boolean;
};

/** What a card knows about the books it is linked with. Only members the viewer can see. */
export type BookCardLinkInfo = {
  groupId: number;
  /** Other present members, never the card's own book. */
  books: Array<{ bookId: number; libraryId: number; formats: string[]; mediaKind: BookMediaKind }>;
  /** Members a collapsed card stands for, the card's own book included. */
  memberCount: number;
};

export type BookLinkRequest = {
  bookIds: number[];
};

export type BookLinkGroup = {
  groupId: number;
  leadBookId: number | null;
  /** Members the requester can see; a group may hold others. */
  books: LinkedBookSummary[];
};

export type BookLinkLeadRequest = {
  leadBookId: number;
};

/** Why a book is offered as another edition: a shared Hardcover or Open Library work id, or the same title and a shared author. */
export const EDITION_SUGGESTION_REASONS = ["same_work", "title_author"] as const;
export type EditionSuggestionReason = (typeof EDITION_SUGGESTION_REASONS)[number];

/**
 * A book that looks like another edition of the open one, found live from its metadata the way
 * Duplicate Books finds them: another format of the work (`other_format`), or another edition in
 * the same format whose ISBN, publisher, year or narrators differ (`other_edition`).
 */
export type BookEditionSuggestion = {
  book: BookCard;
  kind: "other_format" | "other_edition";
  reasons: EditionSuggestionReason[];
};

/** `GET /books/:id/edition-suggestions`. */
export type BookEditionSuggestions = {
  items: BookEditionSuggestion[];
};

/** Socket `book:links-changed`, sent to each affected library's room. */
export type BookLinksChangedEvent = {
  libraryId: number;
  bookIds: number[];
};

/** What the edition label and order read; a {@link LinkedBookSummary} fits, and so does the current book. */
export type EditionLabelSource = {
  bookId: number;
  libraryName: string;
  formats: string[];
  editionName?: string | null;
  narrators?: string[];
  publisher?: string | null;
  publishedYear?: number | null;
};

/** The middle dot that joins the parts of an edition label. */
export const EDITION_LABEL_SEPARATOR = " · ";

function isAudioOnly(formats: string[]): boolean {
  return formats.length > 0 && formats.every(isAudioFormat);
}

/** One edition's own label, before any library is added to tell it from a namesake. */
export function editionLabel(edition: EditionLabelSource): string {
  return editionLabelBase(edition);
}

function editionLabelBase(edition: EditionLabelSource): string {
  const name = edition.editionName?.trim();
  if (name) return name;
  const narrator = edition.narrators?.find((n) => n.trim())?.trim();
  if (narrator && isAudioOnly(edition.formats)) return narrator;
  const publisher = edition.publisher?.trim();
  const year = edition.publishedYear ?? null;
  if (publisher && year != null) return `${publisher}${EDITION_LABEL_SEPARATOR}${year}`;
  if (publisher) return publisher;
  if (year != null) return String(year);
  return edition.libraryName;
}

/**
 * Names each edition of a work: its edition name, else the narrator of an audio-only edition, else
 * publisher and year, else its library. Editions that would share a label get their library added.
 * Formats are left out on purpose: they are shown beside the label.
 */
export function editionLabels(editions: readonly EditionLabelSource[]): Map<number, string> {
  const bases = editions.map((e) => editionLabelBase(e));
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base.toLocaleLowerCase(), (counts.get(base.toLocaleLowerCase()) ?? 0) + 1);
  const labels = new Map<number, string>();
  editions.forEach((e, i) => {
    const base = bases[i];
    const collides = (counts.get(base.toLocaleLowerCase()) ?? 0) > 1 && base !== e.libraryName;
    labels.set(e.bookId, collides ? `${base}${EDITION_LABEL_SEPARATOR}${e.libraryName}` : base);
  });
  return labels;
}

/** What {@link sortEditions} reads. */
export type EditionOrderSource = {
  bookId: number;
  formats: string[];
  isLead: boolean;
  publishedYear?: number | null;
  lastReadAt?: string | null;
  progress?: { finished: boolean } | null;
};

/**
 * The order editions are listed in, the same on every edition's page: the main edition, then the
 * ones the viewer has read, most recent first, then ones marked finished without any reading to
 * date them, then ebooks before audiobooks, newest first.
 */
export function sortEditions<T extends EditionOrderSource>(editions: readonly T[]): T[] {
  const audioRank = (e: T) => (isAudioOnly(e.formats) ? 1 : 0);
  const readRank = (e: T) => (e.lastReadAt ? 0 : e.progress?.finished ? 1 : 2);
  return [...editions].sort((a, b) => {
    if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;
    if (readRank(a) !== readRank(b)) return readRank(a) - readRank(b);
    if (a.lastReadAt && b.lastReadAt) {
      const aRead = Date.parse(a.lastReadAt);
      const bRead = Date.parse(b.lastReadAt);
      if (aRead !== bRead) return bRead - aRead;
    }
    if (audioRank(a) !== audioRank(b)) return audioRank(a) - audioRank(b);
    const aYear = a.publishedYear ?? null;
    const bYear = b.publishedYear ?? null;
    if (aYear !== bYear) {
      if (aYear == null) return 1;
      if (bYear == null) return -1;
      return bYear - aYear;
    }
    return a.bookId - b.bookId;
  });
}

/** Show "First published" only when it says something the published year does not. */
export function showsFirstPublished(originalPublishedYear: number | null | undefined, publishedYear: number | null | undefined): boolean {
  if (originalPublishedYear == null) return false;
  return publishedYear == null || originalPublishedYear < publishedYear;
}
