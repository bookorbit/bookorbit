/** Which of a file's two positions a write moved. A write that names neither moved the text one. */
export const READING_POSITION_KINDS = ["text", "narration"] as const;
export type ReadingPositionKind = (typeof READING_POSITION_KINDS)[number];

/** The most writes one `PUT /reading-progress` carries. */
export const READING_PROGRESS_MAX_WRITES = 25;

export interface ReadingTextPosition {
  /** EPUB: the CFI of the page start. */
  cfi: string | null;
  /** PDF and comics: the page, 1-based. */
  page: number | null;
  /** When the text position last moved. Null on rows written before the two positions were split. */
  updatedAt: string | null;
}

/** Where an EPUB3 read-along or a narrated file is, kept apart from the text position. */
export interface ReadingNarrationPosition {
  seconds: number | null;
  /** The SMIL text fragment being narrated. */
  fragment: string | null;
  /** The spine section the fragment belongs to. */
  sectionIndex: number | null;
  percentage: number | null;
  updatedAt: string | null;
}

/** The bookmark a Kobo device resumes from. */
export interface ReadingKoboLocation {
  /** The spine resource the location sits in. */
  source: string | null;
  /** Usually `KoboSpan`. */
  type: string | null;
  value: string | null;
  /** Progress within `source`, 0 to 100. */
  contentPercent: number | null;
}

export interface ReadingProgressEntry {
  fileId: number;
  /** 0 to 100. */
  percentage: number;
  /** When any position on the file was last saved; null when none ever was. */
  updatedAt: string | null;
  text: ReadingTextPosition;
  narration: ReadingNarrationPosition;
  kobo: ReadingKoboLocation;
  /** The KOReader XPointer for the same place. */
  koreader: string | null;
}

/** `GET /reading-progress?fileId=` (one entry) or `?bookId=` (one per file of the book). */
export interface ReadingProgressListResponse {
  items: ReadingProgressEntry[];
}

/**
 * One position to save. A narration object that is left out keeps the marker the file holds, and
 * inside it, a field left out keeps that field while an explicit null clears it.
 */
export interface ReadingProgressWrite {
  fileId: number;
  kind?: ReadingPositionKind;
  percentage: number;
  /**
   * When the reader made this move, on the server's clock. A position saved after it wins, and the
   * write comes back `superseded` with that position instead. Without it the write always lands.
   */
  editedAt?: string;
  text?: { cfi?: string | null; page?: number | null };
  narration?: { seconds?: number | null; fragment?: string | null; sectionIndex?: number | null };
  kobo?: { source?: string | null; type?: string | null; value?: string | null; contentPercent?: number | null };
  koreader?: string | null;
}

/** `PUT /reading-progress`. Each file appears at most once. */
export interface ReadingProgressWriteRequest {
  writes: ReadingProgressWrite[];
}

export type ReadingProgressWriteStatus = "saved" | "superseded";

export interface ReadingProgressWriteResult {
  fileId: number;
  status: ReadingProgressWriteStatus;
  /** What the file holds now: this write's result, or the newer position that superseded it. */
  progress: ReadingProgressEntry;
}

/** Results in the order the writes were sent. */
export interface ReadingProgressWriteResponse {
  results: ReadingProgressWriteResult[];
}
