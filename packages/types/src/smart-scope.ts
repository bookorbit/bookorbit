import type { GroupRule, SortSpec } from "./query";

export type SmartScopeFilter = GroupRule | null;

export interface SmartScope {
  id: number;
  userId: number;
  name: string;
  icon: string | null;
  filter: SmartScopeFilter;
  defaultSort: SortSpec[];
  isPublic: boolean;
  /** The owner's own preference. Only the owner's devices follow it. */
  syncToKobo: boolean;
  /** Whether this scope reaches the requesting user's Kobo: the owner's flag for the owner, an explicit opt-in for everyone else. */
  koboSyncEnabled: boolean;
  isOwner: boolean;
  displayOrder: number;
  /** Matching books. Null when the filter failed to validate. */
  bookCount?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSmartScopePayload {
  name: string;
  icon: string;
  filter?: SmartScopeFilter;
  defaultSort: SortSpec[];
  isPublic?: boolean;
  syncToKobo?: boolean;
}
