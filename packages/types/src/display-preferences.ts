export const CARD_OVERLAY_KEYS = ["progress-bar", "format", "rating", "read-status", "lock-status", "series-position"] as const;
export type CardOverlayKey = (typeof CARD_OVERLAY_KEYS)[number];

export const GRID_CARD_LABEL_FIELDS = ["hidden", "book-title", "series-title", "series-title-position", "author"] as const;
export type GridCardLabelField = (typeof GRID_CARD_LABEL_FIELDS)[number];

export const COVER_SIZE_SCOPES = ["per-view", "synced"] as const;
export type CoverSizeScope = (typeof COVER_SIZE_SCOPES)[number];

export const BOOK_VIEW_MODES = ["grid", "list", "table"] as const;
export type BookViewMode = (typeof BOOK_VIEW_MODES)[number];

export const AUTHOR_COVER_SHAPES = ["square", "circle"] as const;
export type AuthorCoverShape = (typeof AUTHOR_COVER_SHAPES)[number];

export const TABLE_DENSITIES = ["compact", "comfortable", "roomy"] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];

export const BOOK_SPINE_OVERLAYS = ["off", "subtle", "strong"] as const;
export type BookSpineOverlay = (typeof BOOK_SPINE_OVERLAYS)[number];

export const BOOK_SHADOW_STRENGTHS = ["default", "strong"] as const;
export type BookShadowStrength = (typeof BOOK_SHADOW_STRENGTHS)[number];

export const BOOK_COVER_DISPLAY_MODES = ["blurred-fit", "fill-crop", "natural-bottom"] as const;
export type BookCoverDisplayMode = (typeof BOOK_COVER_DISPLAY_MODES)[number];

export const SERIES_CARD_COVER_MODES = ["mosaic", "first-volume", "latest-volume", "first-unread"] as const;
export type SeriesCardCoverMode = (typeof SERIES_CARD_COVER_MODES)[number];

export const CARD_INFO_MODES = ["hover-overlay", "below-cover", "off"] as const;
export type CardInfoMode = (typeof CARD_INFO_MODES)[number];

export interface DisplayPreferences {
  portraitCoverSize: number;
  squareCoverSize: number;
  coverSizeScope: CoverSizeScope;
  gridGap: number;
  portraitGridGap: number;
  squareGridGap: number;
  viewMode: BookViewMode;
  cardOverlays: CardOverlayKey[];
  smartScopeFilterExpanded: boolean;
  authorCoverSize: number;
  authorCoverShape: AuthorCoverShape;
  tableZebraStriping: boolean;
  tableDensity: TableDensity;
  bookSpineOverlay: BookSpineOverlay;
  bookShadowStrength: BookShadowStrength;
  bookCoverDisplayMode: BookCoverDisplayMode;
  seriesCardCoverMode: SeriesCardCoverMode;
  gridCardPrimaryLabel: GridCardLabelField;
  gridCardSecondaryLabel: GridCardLabelField;
  cardInfoMode: CardInfoMode;
}
