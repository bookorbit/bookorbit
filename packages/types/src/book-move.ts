import type { BookSelectionPayload } from "./book-selection";
import type { OrganizationMode } from "./library";

/** How a destination collision is resolved for a book. */
export type BookMoveCollisionPolicy = "keep_both" | "merge" | "skip";

export const BOOK_MOVE_COLLISION_POLICIES: readonly BookMoveCollisionPolicy[] = ["keep_both", "merge", "skip"] as const;

/**
 * Job-level policy. "suggested" resolves per collision using each one's own
 * suggestedPolicy, so identical copies merge while name-only clashes keep both.
 * It is resolved on the server because the preview only carries a bounded sample
 * of collisions, and the rest still need the same treatment.
 */
export type BookMoveJobCollisionPolicy = BookMoveCollisionPolicy | "suggested";

export const BOOK_MOVE_JOB_COLLISION_POLICIES: readonly BookMoveJobCollisionPolicy[] = ["suggested", "keep_both", "merge", "skip"] as const;

/** Why a selected book cannot be moved to the chosen destination. */
export type BookMoveIneligibleReason =
  | "book_not_present"
  | "no_content_file"
  | "multi_file_target_per_file"
  | "no_source_access"
  | "pattern_unresolved"
  | "path_too_long"
  | "path_outside_target_root";

/** What kind of conflict the destination already has. */
export type BookMoveCollisionKind = "folder_path" | "file_path" | "hash_duplicate";

/**
 * How the book's on-disk layout changes because the source and target libraries
 * organize books differently. Null when both libraries use the same mode.
 */
export type BookMoveLayoutChange = "wrap_into_folder" | "dissolve_folder";

export interface BookMovePreviewReadyItem {
  bookId: number;
  title: string;
  currentPath: string;
  targetPath: string;
  layoutChange: BookMoveLayoutChange | null;
}

export interface BookMovePreviewCollisionItem {
  bookId: number;
  title: string;
  kind: BookMoveCollisionKind;
  currentPath: string;
  targetPath: string;
  /** The book already occupying the destination, when known. */
  existingBookId: number | null;
  suggestedPolicy: BookMoveCollisionPolicy;
  /** Destination path used when the collision is resolved with "keep_both". */
  keepBothPath: string;
}

export interface BookMovePreviewIneligibleItem {
  bookId: number;
  title: string;
  reason: BookMoveIneligibleReason;
  /** Extra context for reasons that carry a count, such as file counts. */
  detail?: string;
}

export interface BookMoveAccessLoser {
  userId: number;
  username: string;
  bookCount: number;
}

export interface BookMoveKoboImpact {
  userId: number;
  username: string;
  deviceCount: number;
  bookCount: number;
}

export interface BookMoveFormatMismatch {
  bookId: number;
  title: string;
  format: string;
}

export interface BookMoveLayoutSummary {
  change: BookMoveLayoutChange;
  bookCount: number;
}

export interface BookMoveWarnings {
  /** Users who can see these books today but have no access to the target library. */
  accessLosers: BookMoveAccessLoser[];
  /** Users whose Kobo devices will drop these books on the next sync. */
  koboImpact: BookMoveKoboImpact[];
  /** Set when source and target libraries organize books differently. */
  layout: BookMoveLayoutSummary | null;
  /** Books whose format is not in the target library's allowed formats. */
  formatMismatches: BookMoveFormatMismatch[];
  /** True when any file would move across filesystems (copy + verify + delete). */
  crossDevice: boolean;
}

export interface BookMovePreviewRequest {
  selection: BookSelectionPayload;
  targetLibraryId: number;
  targetFolderId: number;
}

export interface BookMovePreviewResult {
  targetLibraryId: number;
  targetFolderId: number;
  targetOrganizationMode: OrganizationMode;
  totalSelected: number;

  readyCount: number;
  /** Bounded sample for display; readyCount carries the true total. */
  ready: BookMovePreviewReadyItem[];

  alreadyInTargetCount: number;

  collisionCount: number;
  collisions: BookMovePreviewCollisionItem[];
  collisionsTruncated: boolean;

  ineligibleCount: number;
  ineligible: BookMovePreviewIneligibleItem[];
  ineligibleTruncated: boolean;

  warnings: BookMoveWarnings;
  /** True when the client should show the full review step before moving. */
  requiresReview: boolean;
}

export interface BookMoveCollisionOverride {
  bookId: number;
  policy: BookMoveCollisionPolicy;
}

export interface BookMoveExecuteRequest {
  selection: BookSelectionPayload;
  targetLibraryId: number;
  targetFolderId: number;
  collisionPolicy: BookMoveJobCollisionPolicy;
  overrides?: BookMoveCollisionOverride[];
}

export type BookMoveBookStatus = "success" | "merged" | "failed" | "skipped";

export interface BookMoveSummary {
  processed: number;
  succeeded: number;
  merged: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
}

export type BookMoveProgressEvent =
  | { bookId: number; status: BookMoveBookStatus; reason?: string }
  | ({ done: true } & BookMoveSummary);

export const BOOK_MOVE_PREVIEW_SAMPLE_LIMIT = 50;
export const BOOK_MOVE_DETAIL_LIMIT = 200;
