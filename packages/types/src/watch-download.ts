export interface WatchDownloadTicketRequest {
  bookId: number;
  fileIds: number[];
}

export interface WatchDownloadTicketFile {
  fileId: number;
  format: string;
  sizeBytes: number;
  downloadPath: string;
}

export interface WatchDownloadTicketResponse {
  token: string;
  expiresAt: string;
  files: WatchDownloadTicketFile[];
  coverPath: string | null;
}

/**
 * Narration audio for an EPUB3 media-overlay book, addressed by its href inside the archive
 * rather than by a book file id. Only the iOS Watch path calls this; the web client plays the
 * same resources through the reader's own streaming route.
 */
export interface WatchMediaOverlayDownloadTicketRequest {
  bookId: number;
  fileId: number;
  hrefs: string[];
}

export interface WatchMediaOverlayDownloadTicketFile {
  href: string;
  mediaType: string;
  sizeBytes: number;
  downloadPath: string;
}

export interface WatchMediaOverlayDownloadTicketResponse {
  token: string;
  expiresAt: string;
  files: WatchMediaOverlayDownloadTicketFile[];
  coverPath: string | null;
}
