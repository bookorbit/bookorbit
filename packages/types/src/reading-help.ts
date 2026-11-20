/**
 * Reading help: the server's AI writes the short answers the apps otherwise write with an on-device
 * model. `POST /mobile/reading-help` takes passages the app chose from text before the reader's page
 * and streams the answer back as server-sent events. The server holds the instructions; a request
 * carries only the fields below.
 */

/**
 * What an answer is for:
 * - `term`: who or what a selected name or term is, from passages that mention it.
 * - `description`: the same question for an entry in the app's lists of people, places and terms.
 * - `recap-note`: a few sentences on one piece of text the reader has read.
 * - `recap-stop`: where the reader stopped, from the last stretch read word for word.
 */
export const READING_HELP_KINDS = ["term", "description", "recap-note", "recap-stop"] as const;
export type ReadingHelpKind = (typeof READING_HELP_KINDS)[number];

/** For `term`: the whole book so far, or the chapter on screen. */
export const READING_HELP_SCOPES = ["book", "chapter"] as const;
export type ReadingHelpScope = (typeof READING_HELP_SCOPES)[number];

/** Most passages one request carries. `recap-note` and `recap-stop` carry exactly one. */
export const READING_HELP_MAX_PASSAGES = 24;
/** Longest single passage, in characters. */
export const READING_HELP_MAX_PASSAGE_LENGTH = 12_000;
/** Longest all passages together, in characters. */
export const READING_HELP_MAX_TOTAL_LENGTH = 64_000;
/** Longest `term`, in characters. */
export const READING_HELP_MAX_TERM_LENGTH = 120;
/** Tokens of passages a request may carry, as `app-info` reports it. */
export const READING_HELP_PASSAGE_TOKENS = 8_000;

export interface ReadingHelpRequest {
  kind: ReadingHelpKind;
  /** The book file the passages come from. The reader must be able to open it. */
  fileId: number;
  /** BCP 47 code of the language to answer in, such as "de" or "pt-BR". English when unknown. */
  language: string;
  /** Answer with the Careful model ("Ask more carefully"). Absent means the Fast model. */
  careful?: boolean;
  /** For `term` and `description`: the name or term asked about. */
  term?: string;
  /** For `term`: which stretch the passages come from. Absent means `book`. */
  scope?: ReadingHelpScope;
  /** In reading order. Text only, as it appears in the book. */
  passages: string[];
}

/**
 * The stream's events, each one `data:` line of JSON. `delta` carries the next piece of the answer;
 * `done` ends a stream that worked and carries the whole answer; `error` ends one that failed after
 * it started. A client ignores an event `type` it does not know.
 */
export type ReadingHelpEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      text: string;
      /** Served from the answer cache, without asking the model. */
      cached: boolean;
      careful: boolean;
    }
  | { type: "error"; errorCode: ReadingHelpErrorCode; message: string };

/**
 * `errorCode` values of `POST /mobile/reading-help`, either in a JSON error body before the stream
 * starts or in an `error` event after it. A client treats any other code as `READING_HELP_PROVIDER`.
 */
export const READING_HELP_ERROR_CODES = [
  /** 403: the admin turned reading help off, or the Fast slot has no model. */
  "READING_HELP_OFF",
  /** 409: Careful was asked for, but the Careful slot has no model. */
  "READING_HELP_CAREFUL_OFF",
  /** 403: this month's AI budget is used up. */
  "READING_HELP_BUDGET",
  /** 429: this reader has used this month's share of reading help. */
  "READING_HELP_READER_CAP",
  /** 504: the provider took longer than the answer waits. */
  "READING_HELP_TIMEOUT",
  /** 422: the model declined the passages. */
  "READING_HELP_REFUSED",
  /** 422: the passages do not fit the model; ask again with fewer. */
  "READING_HELP_TOO_LONG",
  /** 502: the provider failed or sent an answer that could not be read. */
  "READING_HELP_PROVIDER",
] as const;
export type ReadingHelpErrorCode = (typeof READING_HELP_ERROR_CODES)[number];

/** In `app-info`: whether reading help can answer now. */
export interface ReadingHelpAppInfo {
  enabled: boolean;
  /** Whether the Careful slot has a model, so "Ask more carefully" can be offered. */
  careful: boolean;
  /** Tokens of passages one request may carry. */
  passageTokens: number;
}
