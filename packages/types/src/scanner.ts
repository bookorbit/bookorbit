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
