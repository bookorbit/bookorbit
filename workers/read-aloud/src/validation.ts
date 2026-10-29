import { isCtcModelVariant } from "@storyteller-platform/ghost-story/constants";
import {
  READ_ALOUD_MAX_AUDIO_FILES,
  READ_ALOUD_WORKER_STAGES,
  type ReadAloudChapterDecision,
  type ReadAloudDecisions,
  type ReadAloudWorkerRequest,
  type ReadAloudWorkerStage,
} from "@bookorbit/types";
import { RequestError } from "./paths.js";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAPTER_DECISIONS: readonly ReadAloudChapterDecision[] = ["excluded", "included", "approved"];
const MAX_AUDIO_FILES = READ_ALOUD_MAX_AUDIO_FILES;
const MAX_CHAPTER_DECISIONS = 10_000;
const MAX_AUDIO_EXCLUSIONS = 1_000;

export function isJobId(value: string): boolean {
  return JOB_ID.test(value);
}

/**
 * Shape errors mean the server speaks a different protocol than this worker, so they carry
 * `worker_incompatible`. Fields added after protocol 1 shipped default instead of being required.
 */
export function validateRequest(value: unknown): ReadAloudWorkerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw incompatible("Request body must be a JSON object");
  const body = value as Record<string, unknown>;
  const jobId = body.jobId;
  if (typeof jobId !== "string" || !isJobId(jobId)) throw incompatible("jobId must be a UUID");
  if (typeof body.epubPath !== "string" || body.epubPath.length === 0) throw incompatible("epubPath must be a string");
  if (typeof body.workDir !== "string" || body.workDir.length === 0) throw incompatible("workDir must be a string");
  const audioPaths = body.audioPaths;
  if (
    !Array.isArray(audioPaths) ||
    audioPaths.length < 1 ||
    audioPaths.length > MAX_AUDIO_FILES ||
    audioPaths.some((path) => typeof path !== "string" || path.length === 0)
  ) {
    throw incompatible(`audioPaths must list 1 to ${MAX_AUDIO_FILES} paths`);
  }
  if (typeof body.language !== "string" || body.language.length === 0 || body.language.length > 50) throw incompatible("language must be a string");
  if (body.granularity !== "sentence" && body.granularity !== "word") throw incompatible("granularity must be sentence or word");
  if (body.model !== "quartznet15x5") throw incompatible("model must be quartznet15x5");
  if (!isNonNegativeInteger(body.sourceBytes)) throw incompatible("sourceBytes must be a non-negative integer");
  if (!isNonNegativeInteger(body.maxOutputBytes) || body.maxOutputBytes < 1) throw incompatible("maxOutputBytes must be a positive integer");
  const duration = body.audioDurationSeconds ?? null;
  if (duration !== null && (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0)) {
    throw incompatible("audioDurationSeconds must be null or a non-negative number");
  }
  const resumeFrom = body.resumeFrom ?? null;
  if (resumeFrom !== null && !(READ_ALOUD_WORKER_STAGES as readonly unknown[]).includes(resumeFrom)) {
    throw incompatible(`resumeFrom must be null or one of: ${READ_ALOUD_WORKER_STAGES.join(", ")}`);
  }
  assertSupportedLanguage(body.language);
  return {
    jobId,
    epubPath: body.epubPath,
    audioPaths: audioPaths as string[],
    workDir: body.workDir,
    language: body.language,
    granularity: body.granularity,
    model: body.model,
    sourceBytes: body.sourceBytes,
    audioDurationSeconds: duration,
    maxOutputBytes: body.maxOutputBytes,
    decisions: validateDecisions(body.decisions),
    resumeFrom: resumeFrom as ReadAloudWorkerStage | null,
  };
}

export function quartznetLanguage(language: string): string | null {
  let subtag: string;
  try {
    subtag = new Intl.Locale(language).language;
  } catch {
    return null;
  }
  return isCtcModelVariant(`quartznet15x5_${subtag}`) ? subtag : null;
}

function assertSupportedLanguage(language: string): void {
  if (!quartznetLanguage(language)) {
    throw new RequestError(400, "unsupported_language", "The QuartzNet model has no variant for this language");
  }
}

function validateDecisions(value: unknown): ReadAloudDecisions {
  if (value === undefined || value === null) return { chapters: {}, audio: [] };
  if (typeof value !== "object" || Array.isArray(value)) throw incompatible("decisions must be an object");
  const { chapters = {}, audio = [] } = value as { chapters?: unknown; audio?: unknown };
  if (!chapters || typeof chapters !== "object" || Array.isArray(chapters)) throw incompatible("decisions.chapters must be an object");
  const entries = Object.entries(chapters);
  if (entries.length > MAX_CHAPTER_DECISIONS) throw incompatible("decisions.chapters has too many entries");
  const validChapters: Record<string, ReadAloudChapterDecision> = {};
  for (const [href, decision] of entries) {
    if (!CHAPTER_DECISIONS.includes(decision as ReadAloudChapterDecision)) {
      throw incompatible("decisions.chapters values must be excluded, included or approved");
    }
    validChapters[href] = decision as ReadAloudChapterDecision;
  }
  if (!Array.isArray(audio) || audio.length > MAX_AUDIO_EXCLUSIONS) throw incompatible("decisions.audio must be an array");
  const validAudio = audio.map((entry) => {
    if (!entry || typeof entry !== "object") throw incompatible("decisions.audio entries must be objects");
    const { track, start = null, end = null } = entry as { track?: unknown; start?: unknown; end?: unknown };
    if (typeof track !== "string" || !isOptionalSeconds(start) || !isOptionalSeconds(end)) {
      throw incompatible("decisions.audio entries need a track name and optional start and end seconds");
    }
    return { track, start, end };
  });
  return { chapters: validChapters, audio: validAudio };
}

function isOptionalSeconds(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function incompatible(message: string): RequestError {
  return new RequestError(400, "worker_incompatible", message);
}
