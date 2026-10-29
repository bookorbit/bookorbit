import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  estimateReadAloudEmissionsBytes,
  READ_ALOUD_ASSUMED_AUDIO_BYTES_PER_SECOND,
  READ_ALOUD_DISK_MARGIN_BYTES,
  READ_ALOUD_EMISSION_BYTES_PER_SECOND,
  READ_ALOUD_WORKER_STAGES,
  type ReadAloudDecisions,
  type ReadAloudGranularity,
  type ReadAloudWorkerStage,
} from "@bookorbit/types";
import type { SourceFingerprint } from "./protocol.js";

/** Stages whose output is cached in the job folder behind a `.done-<stage>` marker. */
export const MARKER_STAGES = ["preparing_audio", "generating_emissions", "marking_up_ebook", "aligning"] as const;
export type MarkerStage = (typeof MARKER_STAGES)[number];

/** A stage reruns whenever a stage it reads from ran in the same run. */
export const STAGE_DEPENDENCIES: Record<MarkerStage, readonly MarkerStage[]> = {
  preparing_audio: [],
  generating_emissions: ["preparing_audio"],
  marking_up_ebook: [],
  aligning: ["preparing_audio", "generating_emissions", "marking_up_ebook"],
};

export const STAGE_WEIGHTS: Record<ReadAloudWorkerStage, number> = {
  preparing_audio: 5,
  downloading_model: 5,
  generating_emissions: 60,
  marking_up_ebook: 5,
  aligning: 20,
  validating: 5,
};

/** Bump to invalidate every cached stage after a change that alters stage outputs. */
export const MARKER_VERSION = 1;

/** Shared with the server and client, which estimate the same space before a job starts. */
export const EMISSION_BYTES_PER_SECOND = READ_ALOUD_EMISSION_BYTES_PER_SECOND;
export const ASSUMED_AUDIO_BYTES_PER_SECOND = READ_ALOUD_ASSUMED_AUDIO_BYTES_PER_SECOND;

export const DISK_MARGIN_BYTES = READ_ALOUD_DISK_MARGIN_BYTES;

export type FingerprintSource = {
  epub: SourceFingerprint;
  audio: SourceFingerprint[];
  language: string;
  granularity: ReadAloudGranularity;
  model: string;
  decisions: ReadAloudDecisions;
};

export function stageInputs(stage: MarkerStage, source: FingerprintSource): Record<string, unknown> {
  const locale = normalizedLocale(source.language);
  const audio = source.audio.map(({ path, size, mtimeMs }) => ({ path, size, mtimeMs }));
  const epub = { path: source.epub.path, size: source.epub.size, mtimeMs: source.epub.mtimeMs };
  switch (stage) {
    case "preparing_audio":
      return { v: MARKER_VERSION, audio };
    case "generating_emissions":
      return { v: MARKER_VERSION, audio, model: source.model, language: new Intl.Locale(locale).language };
    case "marking_up_ebook":
      return { v: MARKER_VERSION, epub, granularity: source.granularity, locale };
    case "aligning":
      return {
        v: MARKER_VERSION,
        audio,
        epub,
        model: source.model,
        locale,
        granularity: source.granularity,
        decisions: canonicalDecisions(source.decisions),
      };
  }
}

export function fingerprint(inputs: unknown): string {
  return createHash("sha256").update(canonicalJson(inputs)).digest("hex");
}

export type StageMarker = {
  stage: MarkerStage;
  fingerprint: string;
  inputs: Record<string, unknown>;
  finishedAt: string;
  durationMs: number;
};

export type MarkerState = "valid" | "missing" | "stale";

export function markerPath(workDir: string, stage: MarkerStage): string {
  return join(workDir, `.done-${stage}`);
}

export async function readMarker(workDir: string, stage: MarkerStage): Promise<StageMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(markerPath(workDir, stage), "utf8")) as Partial<StageMarker>;
    return typeof parsed.fingerprint === "string" ? (parsed as StageMarker) : null;
  } catch {
    return null;
  }
}

export async function writeMarker(workDir: string, marker: StageMarker): Promise<void> {
  const target = markerPath(workDir, marker.stage);
  const partial = `${target}.partial`;
  await writeFile(partial, JSON.stringify(marker), "utf8");
  await rename(partial, target);
}

export async function removeMarker(workDir: string, stage: MarkerStage): Promise<void> {
  await rm(markerPath(workDir, stage), { force: true });
}

export async function markerStates(workDir: string, source: FingerprintSource): Promise<Record<MarkerStage, MarkerState>> {
  const states = {} as Record<MarkerStage, MarkerState>;
  for (const stage of MARKER_STAGES) {
    const marker = await readMarker(workDir, stage);
    if (!marker) states[stage] = "missing";
    else states[stage] = marker.fingerprint === fingerprint(stageInputs(stage, source)) ? "valid" : "stale";
  }
  return states;
}

export type StageDecision = {
  stage: MarkerStage;
  run: boolean;
  reason: "cached" | "missing" | "stale" | "forced" | "dependency";
  state: MarkerState;
};

/** Decides which cached stages rerun: a missing or stale marker, `resumeFrom` at or before the stage, or a dependency that reruns. */
export function planStages(states: Record<MarkerStage, MarkerState>, resumeFrom: ReadAloudWorkerStage | null): StageDecision[] {
  const forcedFrom = resumeFrom ? READ_ALOUD_WORKER_STAGES.indexOf(resumeFrom) : Number.POSITIVE_INFINITY;
  const decisions: StageDecision[] = [];
  const running = new Set<MarkerStage>();
  for (const stage of MARKER_STAGES) {
    const state = states[stage];
    let reason: StageDecision["reason"] = "cached";
    if (state !== "valid") reason = state;
    else if (READ_ALOUD_WORKER_STAGES.indexOf(stage) >= forcedFrom) reason = "forced";
    else if (STAGE_DEPENDENCIES[stage].some((dependency) => running.has(dependency))) reason = "dependency";
    const run = reason !== "cached";
    if (run) running.add(stage);
    decisions.push({ stage, run, reason, state });
  }
  return decisions;
}

export type DiskInput = {
  audioBytes: number;
  epubBytes: number;
  audioDurationSeconds: number | null;
  /** Cached stages whose outputs already sit in the job folder. */
  skipped: ReadonlySet<MarkerStage>;
};

export function estimateEmissionsBytes(audioDurationSeconds: number | null, audioBytes: number): number {
  return estimateReadAloudEmissionsBytes(audioDurationSeconds, audioBytes);
}

/**
 * Free space a run needs on the work volume: `4 x audio + 7 x EPUB + emissions + 512 MB`.
 * Processed audio is one copy of the audio; emissions are their own share; upgraded and marked EPUBs
 * are two copies of the EPUB. At its peak alignment holds three copies of EPUB plus audio at once:
 * the unpacked working copy, the repacked scratch EPUB and the output. The unpacked copy's text
 * counts twice, since it is no longer compressed. A stage whose output is cached is not needed again.
 */
export function requiredDiskBytes(input: DiskInput): { required: number; shares: Record<MarkerStage, number> } {
  const shares: Record<MarkerStage, number> = {
    preparing_audio: input.audioBytes,
    generating_emissions: estimateEmissionsBytes(input.audioDurationSeconds, input.audioBytes),
    marking_up_ebook: 2 * input.epubBytes,
    aligning: 3 * input.audioBytes + 5 * input.epubBytes,
  };
  let required = DISK_MARGIN_BYTES;
  for (const stage of MARKER_STAGES) if (!input.skipped.has(stage)) required += shares[stage];
  return { required, shares };
}

/** Weight of each stage that will run, scaled so the run ends at 100. */
export function normalizedWeights(stages: readonly ReadAloudWorkerStage[]): Map<ReadAloudWorkerStage, number> {
  const total = stages.reduce((sum, stage) => sum + STAGE_WEIGHTS[stage], 0);
  return new Map(stages.map((stage) => [stage, total > 0 ? (STAGE_WEIGHTS[stage] / total) * 100 : 0]));
}

function normalizedLocale(language: string): string {
  return new Intl.Locale(language).toString();
}

function canonicalDecisions(decisions: ReadAloudDecisions): ReadAloudDecisions {
  const chapters: ReadAloudDecisions["chapters"] = {};
  for (const href of Object.keys(decisions.chapters).sort()) chapters[href] = decisions.chapters[href]!;
  return { chapters, audio: decisions.audio.map(({ track, start, end }) => ({ track, start, end })) };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
