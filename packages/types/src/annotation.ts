export type AnnotationPositionStatus = "exact" | "repaired" | "failed" | "pending";

export interface AnnotationItem {
  id: number;
  bookId: number;
  cfi: string | null;
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
  jumpFileId: number | null;
  pageno: number | null;
}

export interface AnnotationHubResponse {
  items: AnnotationHubItem[];
  total: number;
  page: number;
  pageSize: number;
}
