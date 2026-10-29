export const READ_ALOUD_JOB_STATUSES = [
  "queued",
  "processing",
  "awaiting_review",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
] as const;

export type ReadAloudJobStatus = (typeof READ_ALOUD_JOB_STATUSES)[number];

export const READ_ALOUD_ACTIVE_JOB_STATUSES = ["queued", "processing", "awaiting_review"] as const satisfies readonly ReadAloudJobStatus[];

export const READ_ALOUD_TERMINAL_JOB_STATUSES = [
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
] as const satisfies readonly ReadAloudJobStatus[];

export const READ_ALOUD_JOB_STAGES = [
  "queued",
  "preparing_audio",
  "downloading_model",
  "generating_emissions",
  "marking_up_ebook",
  "aligning",
  "validating",
  "awaiting_review",
  "publishing",
  "completed",
] as const;

export type ReadAloudJobStage = (typeof READ_ALOUD_JOB_STAGES)[number];

export type ReadAloudGranularity = "sentence" | "word";

export const READ_ALOUD_QUARTZNET_LANGUAGES = [
  "ar",
  "ca",
  "de",
  "en",
  "es",
  "fo",
  "fr",
  "hy",
  "is",
  "it",
  "ja",
  "kk",
  "mt",
  "pl",
  "pt",
  "ru",
  "zh",
] as const;

export type ReadAloudQuartzNetLanguage = (typeof READ_ALOUD_QUARTZNET_LANGUAGES)[number];

/** The most audio files one job takes; server and worker both enforce it. */
export const READ_ALOUD_MAX_AUDIO_FILES = 2000;

export type ReadAloudEligibilityReason =
  | "worker_not_configured"
  | "worker_unavailable"
  | "worker_incompatible"
  | "book_missing"
  | "no_epub"
  | "no_audiobook"
  | "too_many_audio_files"
  | "single_file_library"
  | "epub_not_allowed"
  | "library_not_mounted"
  | "job_active";

export const READ_ALOUD_ERROR_CODES = [
  "worker_unavailable",
  "worker_incompatible",
  "worker_crashed",
  "library_not_mounted",
  "source_missing",
  "source_changed",
  "invalid_source",
  "unsupported_language",
  "insufficient_storage",
  "audio_processing_failed",
  "model_download_failed",
  "inference_failed",
  "markup_failed",
  "alignment_failed",
  "invalid_output",
  "publication_failed",
  "review_expired",
  "discarded",
  "cancelled",
  "unknown",
] as const;

export type ReadAloudErrorCode = (typeof READ_ALOUD_ERROR_CODES)[number];

export function isReadAloudErrorCode(value: unknown): value is ReadAloudErrorCode {
  return typeof value === "string" && (READ_ALOUD_ERROR_CODES as readonly string[]).includes(value);
}

export type ReadAloudWarningCode = "unaligned_tracks" | "unmatched_text" | "interpolated_text" | "dropped_text";

export type ReadAloudCandidateFile = {
  id: number;
  filename: string;
  format: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
};

/** A media-overlay EPUB already on the book. `generatedByJobId` is set when a BookOrbit job produced it. */
export type ReadAloudExistingFile = {
  fileId: number;
  filename: string;
  sizeBytes: number | null;
  generatedByJobId: string | null;
};

export type ReadAloudJobInput = {
  epubFileId: number;
  audioFileIds: number[];
  language: string;
  granularity: ReadAloudGranularity;
  sourceBytes: number;
  /** The existing read-along this job overwrites when it publishes, or null to add a new file. */
  replaceFileId: number | null;
};

export type ReadAloudStageUnit = "file" | "track" | "chapter";

export type ReadAloudStageDetail = {
  current: number;
  total: number;
  unit: ReadAloudStageUnit;
};

/** STAlign's per-chapter alignment decision, keyed by the chapter's spine href. */
export type ReadAloudChapterDecision = "excluded" | "included" | "approved";

export type ReadAloudAudioExclusion = {
  track: string;
  start: number | null;
  end: number | null;
};

export type ReadAloudDecisions = {
  chapters: Record<string, ReadAloudChapterDecision>;
  audio: ReadAloudAudioExclusion[];
};

export type ReadAloudReportSummary = {
  sentences: number;
  matchedSentences: number;
  interpolatedSentences: number;
  unmatchedSentences: number;
  droppedSentences: number;
  seconds: number;
  matchedSeconds: number;
  interpolatedSeconds: number;
  looseSeconds: number;
  tracks: number;
  unalignedTracks: number;
};

/**
 * How much of the book the narration covers. Unmatched text before the narration starts or after it
 * ends, such as front and back matter or a bonus excerpt of another book, is reported here instead of
 * counting against the alignment: an audiobook never reads it.
 */
export type ReadAloudNarrationCoverage = {
  /** Sentences from where the narration starts to where it ends. */
  storySentences: number;
  storyUnmatchedSentences: number;
  /** Unmatched sentences outside the narration. */
  outsideSentences: number;
  outsideChapterCount: number;
  /** Titles of those chapters in book order, at most READ_ALOUD_OUTSIDE_TITLES_SHOWN of them. */
  outsideTitles: string[];
};

export const READ_ALOUD_OUTSIDE_TITLES_SHOWN = 8;

const CHAPTER_LABEL_SNIPPET = 36;

/**
 * A readable name for a chapter: its title, else its opening words (a copyright page or dedication
 * often has no title), else its file name. Never the full path, which means nothing to a reader.
 */
export function readAloudChapterLabel(chapter: Pick<ReadAloudChapterReport, "title" | "preview" | "href">): string {
  const title = chapter.title?.trim();
  if (title) return title;
  const preview = chapter.preview?.trim();
  if (preview) {
    if (preview.length <= CHAPTER_LABEL_SNIPPET) return preview;
    // Whole words only: a label cut mid-word reads as a typo.
    const cut = preview.slice(0, CHAPTER_LABEL_SNIPPET);
    const space = cut.lastIndexOf(" ");
    return `${(space > CHAPTER_LABEL_SNIPPET / 3 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
  }
  return chapter.href.split("/").pop() || chapter.href;
}

export type ReadAloudJob = {
  id: string;
  bookId: number;
  status: ReadAloudJobStatus;
  stage: ReadAloudJobStage;
  progress: number;
  stageDetail: ReadAloudStageDetail | null;
  /** Jobs ahead of this one while it is queued; null otherwise. */
  queuePosition: number | null;
  input: ReadAloudJobInput;
  decisions: ReadAloudDecisions;
  outputFileId: number | null;
  report: ReadAloudReportSummary | null;
  warnings: ReadAloudWarningCode[];
  /** Null until the output is validated, and for jobs validated before coverage was recorded. */
  coverage: ReadAloudNarrationCoverage | null;
  errorCode: ReadAloudErrorCode | null;
  /** Cancellation was asked for and the worker has not stopped yet. */
  cancelRequested: boolean;
  /**
   * Whether a cancel would still be accepted. False once the output is being added to the book, or
   * was approved for it before a restart put the job back in line, since its file may be there already.
   */
  cancellable: boolean;
  /** The resolved accelerator the worker used, such as "cpu" or "mlx". */
  device: string | null;
  /** Whether the viewer may cancel, discard, publish, retry, re-sync or dismiss this job. */
  canManage: boolean;
  requestedBy: { id: number | null; name: string | null };
  createdAt: string;
  updatedAt: string;
  /** When the current run started processing; drives elapsed time. */
  startedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  /** When an output awaiting review is discarded automatically. */
  expiresAt: string | null;
  /** Until when a failed job keeps its work files, so Retry resumes instead of starting over. */
  retryableUntil: string | null;
};

export type ReadAloudCapability = {
  model: "quartznet15x5";
  supportedLanguages: ReadAloudQuartzNetLanguage[];
  workerConfigured: boolean;
  workerAvailable: boolean;
  /** The worker's resolved accelerator, when it is reachable. */
  workerDevice: string | null;
  /** Free space on the worker's work volume, when it is reachable; compare with `estimateReadAloudWorkBytes`. */
  workerFreeBytes: number | null;
  eligible: boolean;
  reason: ReadAloudEligibilityReason | null;
  epubFiles: ReadAloudCandidateFile[];
  audioFiles: ReadAloudCandidateFile[];
  existingReadAlongs: ReadAloudExistingFile[];
  estimatedOutputBytes: number | null;
  latestJob: ReadAloudJob | null;
};

/** What a user's read-alouds start with, under `/user-preferences/read-aloud`. */
export interface ReadAloudPreferences {
  /**
   * The narration language preselected when a book states none the speech model supports, as a
   * language subtag. The book's own language still wins when it is supported.
   */
  defaultLanguage: string | null;
}

export const DEFAULT_READ_ALOUD_PREFERENCES: ReadAloudPreferences = { defaultLanguage: null };

export type CreateReadAloudJobRequest = {
  epubFileId?: number;
  audioFileIds?: number[];
  language?: string;
  granularity?: ReadAloudGranularity;
  replaceFileId?: number;
};

export type ResyncReadAloudJobRequest = {
  decisions: ReadAloudDecisions;
};

export type ReadAloudChapterStatus = "aligned" | "not-found" | "too-short" | "excluded" | "audio-only";

export type ReadAloudChapterReport = {
  index: number;
  href: string;
  title: string | null;
  zone: "front" | "body" | "back" | null;
  status: ReadAloudChapterStatus;
  decision: ReadAloudChapterDecision | null;
  sentenceCount: number;
  matchedSentenceCount: number;
  interpolatedSentenceCount: number;
  droppedSentenceCount: number;
  matchedSeconds: number;
  score: number | null;
  preview: string | null;
  firstMatch: string | null;
  lastMatch: string | null;
  /** Unmatched text before the narration starts or after it ends; see ReadAloudNarrationCoverage. */
  outsideNarration: boolean;
};

export type ReadAloudJobReport = {
  jobId: string;
  totals: ReadAloudReportSummary;
  coverage: ReadAloudNarrationCoverage | null;
  chapters: ReadAloudChapterReport[];
};

export type ReadAloudJobEventLevel = "info" | "warn" | "error";

export type ReadAloudJobEvent = {
  id: number;
  at: string;
  level: ReadAloudJobEventLevel;
  stage: ReadAloudJobStage | null;
  code: string;
  message: string | null;
  data: Record<string, string | number | boolean | null> | null;
};

export type ReadAloudJobEventsResponse = {
  events: ReadAloudJobEvent[];
};

/**
 * Bytes of emissions per second of audio. Measured 2026-10-01 for quartznet15x5_en at 2,911 B/s
 * (dense fp16 frames, 29 classes at 50 frames per second, plus headers). Vocabularies above 128
 * classes (zh, ja) are stored as sparse top-16 frames of 64 bytes, 3,200 B/s, which this covers.
 */
export const READ_ALOUD_EMISSION_BYTES_PER_SECOND = 3_200;

/** Estimates duration from size when it is unknown: a low audiobook bitrate (64 kbps) overestimates safely. */
export const READ_ALOUD_ASSUMED_AUDIO_BYTES_PER_SECOND = 8_000;

export const READ_ALOUD_DISK_MARGIN_BYTES = 512 * 1024 * 1024;

export function estimateReadAloudEmissionsBytes(audioDurationSeconds: number | null, audioBytes: number): number {
  const seconds = audioDurationSeconds ?? audioBytes / READ_ALOUD_ASSUMED_AUDIO_BYTES_PER_SECOND;
  return Math.ceil(seconds * READ_ALOUD_EMISSION_BYTES_PER_SECOND);
}

/**
 * Free space a fresh run needs on the worker's volume: `4 x audio + 7 x EPUB + emissions + 512 MB`.
 * Processed audio is one copy of the audio, the upgraded and marked EPUBs two copies of the EPUB,
 * and alignment peaks at three copies of EPUB plus audio: the unpacked working copy (its text
 * counted twice, uncompressed), the repacked scratch EPUB and the output.
 */
export function estimateReadAloudWorkBytes(input: { audioBytes: number; epubBytes: number; audioDurationSeconds: number | null }): number {
  return (
    4 * input.audioBytes +
    7 * input.epubBytes +
    estimateReadAloudEmissionsBytes(input.audioDurationSeconds, input.audioBytes) +
    READ_ALOUD_DISK_MARGIN_BYTES
  );
}

/** Socket.IO namespace and event for live job updates, sent to the job's requester. */
export const READ_ALOUD_SOCKET_NAMESPACE = "/read-aloud";
export const READ_ALOUD_JOB_UPDATED_EVENT = "read-aloud:job-updated";

/**
 * Private server-to-worker protocol. Bump `READ_ALOUD_WORKER_PROTOCOL` on any breaking change: the
 * worker image and the app image can be pinned separately, and the server refuses a worker whose
 * protocol it does not support.
 */
export const READ_ALOUD_WORKER_PROTOCOL = 1;

export const READ_ALOUD_WORKER_STAGES = [
  "preparing_audio",
  "downloading_model",
  "generating_emissions",
  "marking_up_ebook",
  "aligning",
  "validating",
] as const satisfies readonly ReadAloudJobStage[];

export type ReadAloudWorkerStage = (typeof READ_ALOUD_WORKER_STAGES)[number];

export type ReadAloudWorkerRequest = {
  jobId: string;
  epubPath: string;
  audioPaths: string[];
  workDir: string;
  language: string;
  granularity: ReadAloudGranularity;
  model: "quartznet15x5";
  sourceBytes: number;
  /** Total duration of the selected audio, used for the disk estimate; null when unknown. */
  audioDurationSeconds: number | null;
  maxOutputBytes: number;
  decisions: ReadAloudDecisions;
  /** Rerun from this stage even if later stages are cached, e.g. "aligning" for a re-sync. */
  resumeFrom: ReadAloudWorkerStage | null;
};

export type ReadAloudWorkerEvent = {
  /** Increases by one per event within a job, so the server can ask only for what it has not stored. */
  seq: number;
  at: string;
  level: ReadAloudJobEventLevel;
  stage: ReadAloudWorkerStage | null;
  code: string;
  message: string | null;
  data: Record<string, string | number | boolean | null> | null;
};

export type ReadAloudWorkerJob = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: ReadAloudWorkerStage;
  progress: number;
  stageDetail: ReadAloudStageDetail | null;
  errorCode: ReadAloudErrorCode | null;
  error: string | null;
  outputBytes: number | null;
  /** Events with `seq` greater than the request's `afterSeq`, oldest first. */
  events: ReadAloudWorkerEvent[];
};

export type ReadAloudWorkerError = {
  error: string;
  errorCode: ReadAloudErrorCode;
};

export type ReadAloudWorkerDevice = "auto" | "cpu" | "cuda" | "webgpu" | "mlx";

export type ReadAloudWorkerHealth = {
  status: "ok";
  version: string;
  protocol: number;
  activeJobId: string | null;
  activeJobs: number;
  capacity: number;
  device: Exclude<ReadAloudWorkerDevice, "auto">;
  configuredDevice: ReadAloudWorkerDevice;
  deviceCheck: "ok" | "not_checked" | "failed";
  /** Absolute folders the worker can read sources from. */
  libraryRoots: string[];
  workRoot: string;
  freeBytes: number | null;
  platform: string;
  architecture: string;
};
