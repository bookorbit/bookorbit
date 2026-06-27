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
}

export interface AnnotationStats {
  totalHighlights: number;
  colorBreakdown: { color: string; count: number }[];
  originBreakdown: { origin: AnnotationItem["origin"]; count: number }[];
  chaptersWithHighlights: number;
  highlightsWithNotes: number;
  chapters: string[];
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
}

export interface AnnotationHubStats {
  books: number;
  withNotes: number;
  originBreakdown: { origin: AnnotationItem["origin"]; count: number }[];
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
