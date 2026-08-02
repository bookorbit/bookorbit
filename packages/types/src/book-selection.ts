import type { GroupRule, SortSpec } from "./query";

export type BookSelectionQuery = {
  libraryId?: number;
  filter?: GroupRule;
  q?: string;
  sort?: SortSpec[];
};

export type BookSelectionPayload = { bookIds: number[]; query?: never } | { query: BookSelectionQuery; bookIds?: never };

export const MOVE_BOOK_OUTCOME_REASONS = [
  "book_not_found",
  "no_source_access",
  "source_access_check_failed",
  "book_processing",
  "book_missing",
  "already_in_target",
  "format_not_allowed",
  "target_path_taken",
  "target_path_exists",
  "path_escapes_target",
  "database_update_failed",
  "file_move_failed",
  "file_move_failed_rollback_incomplete",
] as const;

export type MoveBookOutcomeReason = (typeof MOVE_BOOK_OUTCOME_REASONS)[number];

export interface MoveBookOutcome {
  bookId: number;
  status: "moved" | "skipped" | "failed";
  reason?: MoveBookOutcomeReason;
}

export interface MoveBooksResponse {
  results: MoveBookOutcome[];
}
