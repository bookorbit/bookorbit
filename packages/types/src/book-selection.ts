import type { GroupRule, SortSpec } from "./query";

export type BookSelectionQuery = {
  libraryId?: number;
  filter?: GroupRule;
  q?: string;
  sort?: SortSpec[];
};

export type BookSelectionPayload = { bookIds: number[]; query?: never } | { query: BookSelectionQuery; bookIds?: never };

export interface MoveBookOutcome {
  bookId: number;
  status: "moved" | "skipped" | "failed";
  reason?: string;
}

export interface MoveBooksResponse {
  results: MoveBookOutcome[];
}
