import type { BookMediaKind } from "./book";

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
  /** The group's main book: a collapsed card shows it, and opening the card opens it. */
  isLead: boolean;
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

/** Socket `book:links-changed`, sent to each affected library's room. */
export type BookLinksChangedEvent = {
  libraryId: number;
  bookIds: number[];
};
