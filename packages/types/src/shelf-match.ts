import type { VisualMatch } from "./visual-match";

/** Most spines `POST /mobile/shelf-match` reads from one photo of a shelf. */
export const SHELF_MATCH_MAX_SPINES = 40;
/** Most recognised lines it reads from one spine. */
export const SHELF_MATCH_MAX_LINES = 6;
/** Longest single recognised line it accepts. */
export const SHELF_MATCH_MAX_LINE_LENGTH = 200;
/** Longest spine id it accepts. The id is the client's own and comes back unchanged. */
export const SHELF_MATCH_MAX_ID_LENGTH = 16;
/** Most books one spine's answer names, such as an ebook and its audiobook. */
export const SHELF_MATCH_MAX_RESULTS = 4;

/** One book spine in the photo: the text recognised on it, in reading order. */
export interface ShelfSpine {
  /** The client's id for the spine, unique within the request. */
  id: string;
  lines: string[];
}

export interface ShelfMatchRequest {
  spines: ShelfSpine[];
}

export interface ShelfSpineMatch {
  /** The id of the spine this answers. */
  id: string;
  /** Books in the reader's libraries the spine shows, best first. Empty when none matched. */
  matches: VisualMatch[];
  /**
   * An author the library knows, named on the spine, so a client can prefill a book request when
   * the book itself is not in the library. Null when no line names a known author.
   */
  author: string | null;
}

export interface ShelfMatchResponse {
  /** One entry per spine, in the request's order. */
  results: ShelfSpineMatch[];
}
