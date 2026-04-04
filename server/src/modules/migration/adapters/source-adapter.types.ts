export interface SourceValidationResult {
  ok: boolean;
  sourceType: string;
  sourceVersion: string | null;
  missingTables: string[];
  warnings: string[];
  counts: Record<string, number>;
}

export interface SourceSnapshot {
  generatedAt: string;
  sourceType: string;
  sourceVersion: string | null;
  counts: Record<string, number>;
}

export interface SourceUser {
  sourceUserId: string;
  username: string;
  name: string | null;
  email: string | null;
}

export interface SourceContributor {
  sourceContributorId: string | null;
  name: string;
  sortName: string | null;
  description: string | null;
  displayOrder: number;
}

export interface SourceBookFile {
  sourceFileId: string;
  sourceBookId: string;
  filePath: string | null;
  fileHash: string | null;
  fileName: string | null;
  fileSubPath: string | null;
  durationSeconds: number | null;
}

export interface SourceBook {
  sourceBookId: string;
  title: string | null;
  /**
   * Legacy display value retained for existing matching/report code. New code
   * should prefer the structured authors array.
   */
  author: string | null;
  subtitle: string | null;
  isbn10: string | null;
  isbn13: string | null;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount?: number | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
  rating?: number | null;
  googleBooksId?: string | null;
  goodreadsId?: string | null;
  amazonId?: string | null;
  hardcoverId?: string | null;
  audibleId?: string | null;
  comicvineId?: string | null;
  durationSeconds?: number | null;
  abridged?: boolean | null;
  authors?: SourceContributor[];
  narrators?: SourceContributor[];
  filePath: string | null;
  fileHash: string | null;
  files?: SourceBookFile[];
  genres: string[];
  tags: string[];
  presentFields?: string[];
}

export interface SourceUserBookStatus {
  sourceUserId: string;
  sourceBookId: string;
  status: string | null;
  percentage: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
}

export interface SourceUserFileProgress {
  sourceUserId: string;
  sourceBookId: string;
  sourceFileId?: string | null;
  percentage: number | null;
  cfi: string | null;
  href?: string | null;
  pageNumber: number | null;
  positionSeconds: number | null;
  updatedAt: string | null;
}

export interface SourceBookmark {
  sourceUserId: string;
  sourceBookId: string;
  sourceFileId?: string | null;
  title: string | null;
  cfi: string | null;
  positionSeconds: number | null;
  trackIndex?: number | null;
  createdAt: string | null;
}

export interface SourceAnnotation {
  sourceUserId: string;
  sourceBookId: string;
  cfi: string;
  text: string;
  color: string | null;
  style: string | null;
  note: string | null;
  chapterTitle: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SourceShelf {
  sourceShelfId: string;
  sourceUserId: string;
  name: string;
}

export interface SourceShelfBook {
  sourceShelfId: string;
  sourceUserId: string;
  sourceBookId: string;
}

export interface SourceExportData {
  users: SourceUser[];
  books: SourceBook[];
  userBookStatuses: SourceUserBookStatus[];
  userFileProgress: SourceUserFileProgress[];
  bookmarks: SourceBookmark[];
  annotations: SourceAnnotation[];
  shelves: SourceShelf[];
  shelfBooks: SourceShelfBook[];
}

export interface SourceAdapter<TConnectionConfig = unknown> {
  readonly type: string;

  validate(config: TConnectionConfig): Promise<SourceValidationResult>;

  snapshot(config: TConnectionConfig): Promise<SourceSnapshot>;

  exportData(config: TConnectionConfig): Promise<SourceExportData>;

  fetchPathPrefixes?(config: TConnectionConfig): Promise<string[]>;
}
