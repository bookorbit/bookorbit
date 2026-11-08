/**
 * A reader's corrections to the people, places and terms listed for a book, synced per account by
 * `GET`/`PUT /mobile/books/:bookId/story-edits`. The server stores each correction as given and
 * never reads `kind` or `data`.
 */

/** Longest `kind` a correction may carry. */
export const STORY_EDIT_KIND_MAX_LENGTH = 32;
/** Largest `data` object, measured as its UTF-8 JSON serialisation. */
export const STORY_EDIT_DATA_MAX_BYTES = 2048;
/** Most corrections one page returns, and the default page size. */
export const STORY_EDITS_PAGE_MAX = 200;
/** Most live (not deleted) corrections one reader may keep for one book. */
export const STORY_EDITS_PER_BOOK_MAX = 2000;

export interface StoryEdit {
  /** Client-generated UUID, unique per reader and book. */
  id: string;
  /** Opaque to the server, e.g. "merge", "hide", "note". */
  kind: string;
  /** Opaque JSON object, at most `STORY_EDIT_DATA_MAX_BYTES` serialised. */
  data: Record<string, unknown>;
  /** Reading progress from 0 to 1 when the correction was made. */
  position: number | null;
  /** ISO 8601, the client's time of the change. The later of two writes to one id wins. */
  updatedAt: string;
  /** A tombstone, kept so every device learns of the delete. */
  deleted: boolean;
}

export interface StoryEditsPage {
  /** Changes in the order the server stored them, tombstones included. */
  edits: StoryEdit[];
  /** Opaque; pass back as `since` to get only later changes. */
  cursor: string;
  hasMore: boolean;
}

export interface PutStoryEditRequest {
  kind: string;
  data: Record<string, unknown>;
  position?: number | null;
  updatedAt: string;
  deleted?: boolean;
}
