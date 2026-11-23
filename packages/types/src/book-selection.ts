import type { GroupRule, SortSpec } from "./query";

export type BookSelectionQuery = {
  libraryId?: number;
  filter?: GroupRule;
  q?: string;
  sort?: SortSpec[];
  /** The listing folds linked editions: act on the edition each card shows. Servers without `book-editions` refuse it. */
  collapseLinked?: boolean;
};

export type BookSelectionPayload = { bookIds: number[]; query?: never } | { query: BookSelectionQuery; bookIds?: never };
