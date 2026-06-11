export type AnnotationPositionStatus = "exact" | "repaired" | "failed" | "pending";

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
  deletedAt: string | null;
}

export interface AnnotationHubResponse {
  items: AnnotationHubItem[];
  total: number;
  page: number;
  pageSize: number;
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
