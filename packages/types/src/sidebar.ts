export const SIDEBAR_SECTION_IDS = [
  "reading",
  "browse",
  "libraries",
  "podcasts",
  "smartScopes",
  "collections",
  "podcastScopes",
  "podcastCollections",
] as const;
export type SidebarSectionId = (typeof SIDEBAR_SECTION_IDS)[number];

/** Sections backed by a variable-length entity list, so only these carry a rows-shown cap. */
export const SIDEBAR_CAPPED_SECTION_IDS = [
  "libraries",
  "podcasts",
  "smartScopes",
  "collections",
  "podcastScopes",
  "podcastCollections",
] as const;
export type SidebarCappedSectionId = (typeof SIDEBAR_CAPPED_SECTION_IDS)[number];

/** How many rows a sidebar entity section renders before the See-all link takes over. */
export const SIDEBAR_CAP_OPTIONS = [5, 8, 12, 20, "all"] as const;
export type SidebarCap = (typeof SIDEBAR_CAP_OPTIONS)[number];

export const SIDEBAR_DEFAULT_CAP: Extract<SidebarCap, number> = 8;

export interface SidebarSectionState {
  open: boolean;
  cap?: SidebarCap;
}

export interface SidebarConfig {
  sections: Record<SidebarSectionId, SidebarSectionState>;
}

/**
 * Which sidebar rows and groups a user hid, and the order they arranged them in. Ids are nav entry
 * ids (`series`, `book-dock`) and group ids (`browse`, `libraries`); ids a client does not know are
 * ignored, and ids missing from an order fall back to their default position.
 */
export interface SidebarLayout {
  hidden: string[];
  /** Movable groups, top to bottom. The top group is pinned and never listed. */
  groupOrder: string[];
  /** Row order inside each nav group, keyed by group id. */
  rowOrder: Record<string, string[]>;
}

/** Totals behind the sidebar Browse badges, served as one cached payload so the shell needs a single request. */
export interface BrowseCounts {
  authors: number;
  series: number;
  annotations: number;
}
