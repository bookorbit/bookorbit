import type { FileChapterSpan } from '../../../common/utils/audiobook-chapters.utils';
import type { BookWritePayloadKey } from './book-write-payload.interface';

export interface FormatWriteOptions {
  fieldMask: Set<BookWritePayloadKey>;
  dryRun: boolean;
  trackNumber?: number;
  trackTotal?: number;
  trackTitle?: string;
  isMultiTrackAudio?: boolean;
  /**
   * The file is one of several audio files whose relationship is unknown: tracks of one recording,
   * or complete alternative editions. Its own title and track tags are left as they are.
   */
  preserveTrackIdentity?: boolean;
  /** This file's chapters, on its own clock. Only an explicit chapter write passes them. */
  chapters?: FileChapterSpan[];
}
