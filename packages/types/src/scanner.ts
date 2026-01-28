export interface ScanProgressEvent {
  jobId: number;
  libraryId: number;
  status: 'running' | 'completed' | 'failed';
  processed: number;
  total: number;
  added: number;
  updated: number;
  missing: number;
  errorMessage?: string;
}

export interface CoverRefreshProgressEvent {
  libraryId: number;
  processed: number;
  total: number;
  status: 'running' | 'completed';
}

export interface CoverRefreshedEvent {
  bookId: number;
  libraryId: number;
}

export interface BookMissingEvent {
  libraryId: number;
  bookIds: number[];
}

export interface BookFileRemovedEvent {
  libraryId: number;
  bookId: number;
  fileId: number;
}
