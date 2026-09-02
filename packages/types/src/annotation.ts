export type AnnotationPositionStatus = "exact" | "repaired" | "failed" | "pending";

export const KOBO_HIGHLIGHT_COLORS = [
  { name: "yellow", label: "Yellow", hex: "#F6F3B3" },
  { name: "green", label: "Green", hex: "#C6E09E" },
  { name: "blue", label: "Blue", hex: "#B2E1E8" },
  { name: "pink", label: "Pink", hex: "#E8AFCF" },
] as const;

export type KoboHighlightColorName = (typeof KOBO_HIGHLIGHT_COLORS)[number]["name"];

export const KOREADER_HIGHLIGHT_COLORS = [
  { name: "red", label: "Red", hex: "#FF3300", appHex: "#F87171", koboFallback: "pink" },
  { name: "orange", label: "Orange", hex: "#FF8800", appHex: "#FB923C", koboFallback: "yellow" },
  { name: "yellow", label: "Yellow", hex: "#FFFF33", appHex: "#FACC15", koboFallback: "yellow" },
  { name: "green", label: "Green", hex: "#00AA66", appHex: "#4ADE80", koboFallback: "green" },
  { name: "olive", label: "Olive", hex: "#88FF77", appHex: "#84CC16", koboFallback: "green" },
  { name: "cyan", label: "Cyan", hex: "#00FFEE", appHex: "#22D3EE", koboFallback: "blue" },
  { name: "blue", label: "Blue", hex: "#0066FF", appHex: "#38BDF8", koboFallback: "blue" },
  { name: "purple", label: "Purple", hex: "#EE00FF", appHex: "#C084FC", koboFallback: "pink" },
  { name: "gray", label: "Gray", hex: "#808080", appHex: "#9CA3AF", koboFallback: "yellow" },
] as const satisfies readonly {
  name: string;
  label: string;
  hex: string;
  appHex: string;
  koboFallback: KoboHighlightColorName;
}[];

export type KoreaderHighlightColorName = (typeof KOREADER_HIGHLIGHT_COLORS)[number]["name"];

export const ANNOTATION_HIGHLIGHT_COLORS = [
  { name: "yellow", label: "Yellow", hex: "#FACC15", koreaderFallback: "yellow", koboFallback: "yellow" },
  { name: "green", label: "Green", hex: "#4ADE80", koreaderFallback: "green", koboFallback: "green" },
  { name: "blue", label: "Blue", hex: "#38BDF8", koreaderFallback: "blue", koboFallback: "blue" },
  { name: "pink", label: "Pink", hex: "#F472B6", koreaderFallback: "purple", koboFallback: "pink" },
  { name: "orange", label: "Orange", hex: "#FB923C", koreaderFallback: "orange", koboFallback: "yellow" },
  { name: "red", label: "Red", hex: "#F87171", koreaderFallback: "red", koboFallback: "pink" },
  { name: "olive", label: "Olive", hex: "#84CC16", koreaderFallback: "olive", koboFallback: "green" },
  { name: "cyan", label: "Cyan", hex: "#22D3EE", koreaderFallback: "cyan", koboFallback: "blue" },
  { name: "purple", label: "Purple", hex: "#C084FC", koreaderFallback: "purple", koboFallback: "pink" },
  { name: "gray", label: "Gray", hex: "#9CA3AF", koreaderFallback: "gray", koboFallback: "yellow" },
] as const satisfies readonly {
  name: string;
  label: string;
  hex: string;
  koreaderFallback: KoreaderHighlightColorName;
  koboFallback: KoboHighlightColorName;
}[];

export type AnnotationHighlightColorName = (typeof ANNOTATION_HIGHLIGHT_COLORS)[number]["name"];

export const KOREADER_EXACT_HIGHLIGHT_COLORS = [
  { hex: "#FF3300", label: "KOReader Red" },
  { hex: "#FF8800", label: "KOReader Orange" },
  { hex: "#FFFF33", label: "KOReader Yellow" },
  { hex: "#00AA66", label: "KOReader Green" },
  { hex: "#88FF77", label: "KOReader Olive" },
  { hex: "#00FFEE", label: "KOReader Cyan" },
  { hex: "#0066FF", label: "KOReader Blue" },
  { hex: "#EE00FF", label: "KOReader Purple" },
  { hex: "#808080", label: "KOReader Gray" },
] as const;

export const ANNOTATION_COLOR_FILTER_OPTIONS = [...ANNOTATION_HIGHLIGHT_COLORS, ...KOREADER_EXACT_HIGHLIGHT_COLORS] as const;

export interface AnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A PDF highlight's geometry, in unscaled PDF page coordinate space (points,
 * top-left origin). `page` is the zero-based page index. `rect` is the bounding
 * box and `rects` are the per-line segment quads used to render the markup.
 */
export interface AnnotationPdfPosition {
  page: number;
  rect: AnnotationRect;
  rects: AnnotationRect[];
}

export interface AnnotationItem {
  id: number;
  bookId: number;
  cfi: string | null;
  jumpFileId: number | null;
  pageno: number | null;
  text: string;
  color: string;
  style: string;
  note: string | null;
  chapterTitle: string | null;
  origin: "web" | "koreader" | "kobo";
  positionStatus: AnnotationPositionStatus | null;
  chapterIndex: number | null;
  createdAt: string;
  /** Present for PDF highlights; null/absent for EPUB and device-synced formats. */
  pdf?: AnnotationPdfPosition | null;
}

/**
 * One chapter's worth of highlights, aggregated server-side. The book detail
 * Highlights tab draws its chapter index and its position band from this, so it
 * never has to hold every annotation row in memory to describe the whole book.
 */
export interface AnnotationChapterStat {
  /** null for highlights that carry no chapter title. */
  title: string | null;
  count: number;
  /** Composition of the chapter, ordered by count descending. */
  colors: { color: string; count: number }[];
  /** Spine index when a position carries one, otherwise null. */
  chapterIndex: number | null;
  /** Sort key through the book. Null when no position could be resolved. */
  order: number | null;
  /** Oldest highlight in the chapter, the tiebreak when `order` is null. */
  firstCreatedAt: string;
}

export interface AnnotationStats {
  totalHighlights: number;
  colorBreakdown: { color: string; count: number }[];
  originBreakdown: { origin: AnnotationItem["origin"]; count: number }[];
  chaptersWithHighlights: number;
  highlightsWithNotes: number;
  /**
   * Highlights whose canonical position is not `exact`. Counted with the review filter
   * itself removed, so the chip that toggles it keeps showing the real total while on.
   */
  highlightsNeedingReview: number;
  chapters: string[];
  chapterBreakdown: AnnotationChapterStat[];
  /** Distinct days that carry at least one highlight, newest first. */
  activity: { day: string; count: number; origins: { origin: AnnotationItem["origin"]; count: number }[] }[];
}

export interface AnnotationListResponse {
  items: AnnotationItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: AnnotationStats;
}

export interface AnnotationHubItem extends AnnotationItem {
  bookTitle: string | null;
  author: string | null;
  deletedAt: string | null;
  jumpFileFormat: string | null;
}

export interface AnnotationHubStats {
  books: number;
  withNotes: number;
  originBreakdown: { origin: AnnotationItem["origin"]; count: number }[];
}

/**
 * How the hub stream is grouped. The mode drives the server sort as well as the
 * rules drawn between rows, because grouping a page of an infinite list only
 * lands on whole groups when the server already ordered by the same key.
 */
export const ANNOTATION_HUB_GROUP_MODES = ["month", "book", "color", "source"] as const;
export type AnnotationHubGroupMode = (typeof ANNOTATION_HUB_GROUP_MODES)[number];

/** One device that has ever exchanged annotations, summarised across the whole library. */
export interface AnnotationHubDeviceSummary {
  source: "koreader" | "kobo";
  deviceId: string;
  deviceName: string | null;
  /** Annotations this device has a sync row for. */
  annotations: number;
  /** How many of those are behind the canonical version. */
  behind: number;
  lastSyncedAt: string;
}

/** One week of marking activity, for the hub's twelve-month sparkline. */
export interface AnnotationHubActivityWeek {
  /** Monday of the week, as `yyyy-mm-dd` in UTC. */
  weekStart: string;
  count: number;
  origins: { origin: AnnotationItem["origin"]; count: number }[];
}

/**
 * The library-wide facets behind the hub's side rail. Split out from the paginated
 * list because the list is an infinite stream: recomputing six aggregates over every
 * annotation a user owns on each page of scrolling is the one thing this page cannot
 * afford. It reloads when the filters change, not when more rows arrive.
 */
export interface AnnotationHubOverview {
  total: number;
  books: number;
  withNotes: number;
  /** Highlights whose canonical position is not `exact`, so they cannot open at the right page. */
  needsReview: number;
  /** Always the whole trash, independent of the current status filter. */
  trashed: number;
  originBreakdown: { origin: AnnotationItem["origin"]; count: number }[];
  colorBreakdown: { color: string; count: number }[];
  /** Books ranked by mark count, not by recency the way the filter combobox is. */
  shelf: AnnotationHubBookFacet[];
  weeks: AnnotationHubActivityWeek[];
  busiestWeek: AnnotationHubActivityWeek | null;
  /**
   * Longest run of consecutive empty weeks inside the covered window. Counted in weeks
   * rather than days because the activity is bucketed weekly: reporting days here would
   * claim a precision the aggregate does not have.
   */
  longestQuietWeeks: number;
  devices: AnnotationHubDeviceSummary[];
}

export interface AnnotationHubResponse {
  items: AnnotationHubItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: AnnotationHubStats;
}

export interface AnnotationHubBookFacet {
  bookId: number;
  bookTitle: string | null;
  author: string | null;
  count: number;
}

export type AnnotationPositionFormat = "cfi" | "xpointer" | "pdf" | "kobo_span";

export interface AnnotationPositionInfo {
  format: AnnotationPositionFormat;
  status: AnnotationPositionStatus;
  reason: string | null;
  converterVersion: number | null;
  updatedAt: string;
}

export interface AnnotationDeviceSyncInfo {
  source: "koreader" | "kobo";
  deviceId: string;
  deviceName: string | null;
  lastAppliedVersion: number;
  upToDate: boolean;
  deleteAckedAt: string | null;
  lastSyncedAt: string;
}

export interface AnnotationSyncDetail {
  annotationId: number;
  origin: AnnotationItem["origin"];
  version: number;
  positions: AnnotationPositionInfo[];
  devices: AnnotationDeviceSyncInfo[];
}
