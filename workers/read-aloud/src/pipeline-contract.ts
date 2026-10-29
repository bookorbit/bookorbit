import type { Logger } from "pino";
import type { ReadAloudErrorCode, ReadAloudStageDetail } from "@bookorbit/types";
import type { EventData, RunnerJob } from "./protocol.js";

export type WorkPaths = {
  workDir: string;
  sourceAudioDir: string;
  processedAudioDir: string;
  emissionsDir: string;
  scratchDir: string;
  upgradedEpubPath: string;
  markedEpubPath: string;
  outputPath: string;
  reportPath: string;
};

export type LogListener = (level: "info" | "warn" | "error", message: string) => void;

export type StageContext = {
  job: RunnerJob;
  paths: WorkPaths;
  signal: AbortSignal;
  /** A pino logger at info that prints sanitized single lines; the listener sees each raw message first. */
  createLogger(listener?: LogListener): Logger;
  progress(fraction: number, detail?: ReadAloudStageDetail | null): void;
  event(level: "info" | "warn", code: string, message: string, data?: EventData | null): void;
};

export type StageResult = { data?: EventData } | void;

/**
 * The stage implementations the runner drives. `pipeline.ts` is the STAlign one; tests swap in a fake
 * through READ_ALOUD_RUNNER_PIPELINE so the runner's caching, progress and failure handling run for real.
 */
export type Pipeline = {
  modelInstalled(context: StageContext): Promise<boolean>;
  prepareAudio(context: StageContext): Promise<StageResult>;
  downloadModel(context: StageContext): Promise<StageResult>;
  generateEmissions(context: StageContext): Promise<StageResult>;
  markupEbook(context: StageContext): Promise<StageResult>;
  align(context: StageContext): Promise<StageResult>;
};

/** Thrown by a stage that knows a more precise code than its stage default. */
export class StageError extends Error {
  constructor(
    readonly code: ReadAloudErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StageError";
  }
}
