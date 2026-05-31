export interface AnnasArchiveSearchResult {
  md5: string;
  title: string;
  author?: string;
  format?: string;
  filesize?: string;
  language?: string;
  url: string;
}

export type AnnasArchiveDownloadStatus = 'pending' | 'fetching_links' | 'downloading' | 'completed' | 'failed';

export interface AnnasArchiveDownloadJob {
  id: string;
  md5: string;
  filename: string;
  destPath: string;
  status: AnnasArchiveDownloadStatus;
  startedAt: string;
  completedAt?: string;
  totalBytes?: number;
  downloadedBytes?: number;
  error?: string;
}
