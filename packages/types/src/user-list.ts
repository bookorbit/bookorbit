import type { ProvisioningMethod } from "./auth";

export const USER_LIST_STATES = ["admins", "active", "inactive", "attention"] as const;
export type UserListState = (typeof USER_LIST_STATES)[number];

export const USER_LIST_SORT_FIELDS = ["username", "name", "email", "createdAt", "lastActive"] as const;
export type UserListSortField = (typeof USER_LIST_SORT_FIELDS)[number];
export type UserListSortDirection = "asc" | "desc";

/**
 * Why an account is surfaced in the roster's attention band. Ordered by how urgent
 * the repair is, which is also the order the band renders them in.
 */
export const USER_ATTENTION_REASONS = ["locked", "defaultPassword", "neverSignedIn"] as const;
export type UserAttentionReason = (typeof USER_ATTENTION_REASONS)[number];

/** Counts across the whole user table, unaffected by the caller's current filter. */
export interface UserListSummary {
  total: number;
  admins: number;
  active: number;
  inactive: number;
  attention: number;
}

/** One row of the roster's attention band: the problem, and what the repair needs. */
export interface UserAttentionItem {
  id: number;
  username: string;
  name: string;
  avatarUrl: string | null;
  provisioningMethod: ProvisioningMethod;
  reason: UserAttentionReason;
  /** Present for `locked`; the client formats the remaining time from it. */
  lockedUntil: string | null;
  createdAt: string;
  /** Expiry of the newest unused password reset link, when one was ever issued. */
  resetLinkExpiresAt: string | null;
}

export interface UserAttentionResponse {
  items: UserAttentionItem[];
  /** Total flagged accounts, which may exceed `items.length`. */
  total: number;
}
