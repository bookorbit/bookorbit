import type { MediaType } from "./media";
import type { PodcastScopeRules } from "./podcast";
import type { GroupRule, SortSpec } from "./query";

/** Book scopes carry a rule tree; podcast scopes carry the flat episode rules. `mediaType` says which. */
export type SmartScopeFilter = GroupRule | PodcastScopeRules | null;

export interface SmartScope {
  id: number;
  userId: number;
  mediaType: MediaType;
  /** Set only on podcast scopes, which evaluate episodes inside one library. */
  libraryId: number | null;
  name: string;
  icon: string | null;
  filter: SmartScopeFilter;
  defaultSort: SortSpec[];
  isPublic: boolean;
  /** The owner's own preference. Only the owner's devices follow it. Books only; Kobo has no podcasts. */
  syncToKobo: boolean;
  /** Whether this scope reaches the requesting user's Kobo: the owner's flag for the owner, an explicit opt-in for everyone else. */
  koboSyncEnabled: boolean;
  isOwner: boolean;
  displayOrder: number;
  /** Matching books, on book scopes. Null when the filter failed to validate. */
  bookCount?: number | null;
  /** Matching episodes, on podcast scopes. Null when the rules failed to validate. */
  episodeCount?: number | null;
  createdAt: string;
  updatedAt: string;
}

export function isPodcastScope(scope: Pick<SmartScope, "mediaType">): boolean {
  return scope.mediaType === "podcasts";
}

/** Narrows the filter union to episode rules, so callers never treat a book rule tree as one. */
export function podcastScopeRules(scope: Pick<SmartScope, "mediaType" | "filter">): PodcastScopeRules | null {
  if (scope.mediaType !== "podcasts") return null;
  return (scope.filter as PodcastScopeRules | null) ?? null;
}

/** The count that belongs to a scope's medium, so callers do not have to branch. */
export function smartScopeItemCount(scope: Pick<SmartScope, "mediaType" | "bookCount" | "episodeCount">): number | null {
  const count = scope.mediaType === "podcasts" ? scope.episodeCount : scope.bookCount;
  return typeof count === "number" ? count : null;
}

export interface CreateSmartScopePayload {
  name: string;
  icon: string;
  /** Defaults to books when omitted, so existing book-scope callers need no change. */
  mediaType?: MediaType;
  /** Required for podcast scopes, rejected for book scopes. */
  libraryId?: number;
  filter?: SmartScopeFilter;
  defaultSort: SortSpec[];
  isPublic?: boolean;
  syncToKobo?: boolean;
}
