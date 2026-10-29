import type {
  ReadAloudDecisions,
  ReadAloudErrorCode,
  ReadAloudGranularity,
  ReadAloudJobEventLevel,
  ReadAloudStageDetail,
  ReadAloudWorkerStage,
} from "@bookorbit/types";
import type { ResolvedCtcDevice } from "./accelerator.js";

export type EventData = Record<string, string | number | boolean | null>;

export type SourceFingerprint = {
  path: string;
  size: number;
  mtimeMs: number;
};

/** Everything the runner needs for one run. Paths are already resolved and checked by the control process. */
export type RunnerJob = {
  jobId: string;
  attempt: number;
  workDir: string;
  epub: SourceFingerprint;
  audio: SourceFingerprint[];
  language: string;
  granularity: ReadAloudGranularity;
  model: "quartznet15x5";
  maxOutputBytes: number;
  decisions: ReadAloudDecisions;
  resumeFrom: ReadAloudWorkerStage | null;
  device: ResolvedCtcDevice;
  dtype: "fp32" | "fp16" | null;
  batchSize: number | null;
  /** Absolute folders replaced by placeholders in event messages and logs. */
  redactions: Redaction[];
};

export type Redaction = { path: string; placeholder: string };

export type ControlToRunner = { type: "start"; job: RunnerJob } | { type: "cancel" };

export type RunnerToControl =
  | {
      type: "progress";
      stage: ReadAloudWorkerStage;
      overall: number;
      stageFraction: number;
      detail: ReadAloudStageDetail | null;
    }
  | {
      type: "event";
      level: Exclude<ReadAloudJobEventLevel, "error">;
      stage: ReadAloudWorkerStage | null;
      code: string;
      message: string;
      data: EventData | null;
    }
  | { type: "done"; outputBytes: number }
  | { type: "failed"; code: ReadAloudErrorCode; message: string };

export const MAX_EVENT_MESSAGE_LENGTH = 500;
