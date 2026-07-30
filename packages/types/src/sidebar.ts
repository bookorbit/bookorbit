export const SIDEBAR_SECTION_IDS = ["libraries", "smartScopes", "collections"] as const;
export type SidebarSectionId = (typeof SIDEBAR_SECTION_IDS)[number];

/** How many rows a sidebar entity section renders before the See-all link takes over. */
export const SIDEBAR_CAP_OPTIONS = [5, 8, 12, 20, "all"] as const;
export type SidebarCap = (typeof SIDEBAR_CAP_OPTIONS)[number];

export const SIDEBAR_DEFAULT_CAP: Extract<SidebarCap, number> = 8;

export interface SidebarSectionState {
  open: boolean;
  cap: SidebarCap;
}

export interface SidebarConfig {
  sections: Record<SidebarSectionId, SidebarSectionState>;
}

/** Totals behind the sidebar Browse badges, served as one cached payload so the shell needs a single request. */
export interface BrowseCounts {
  authors: number;
  series: number;
  annotations: number;
}
