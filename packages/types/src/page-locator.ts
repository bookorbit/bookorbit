/** Longest page text `POST /mobile/books/files/:fileId/locate-text` accepts. */
export const LOCATE_TEXT_MAX_LENGTH = 4000;

export interface LocateTextRequest {
  /** Text recognised on a photographed page, with lines separated by newlines. */
  text: string;
}

export interface LocateTextMatch {
  /** Spine index of the chapter that holds the match. */
  chapterIndex: number;
  /** Range CFI over the matched text. */
  cfi: string;
  /** Share of the page's word groups found at this place, from 0 to 1. */
  confidence: number;
  /** The start of the matched text, to show what was found. */
  excerpt: string;
}

export interface LocateTextResponse {
  /** Null when the page text does not appear in this file. */
  match: LocateTextMatch | null;
}
