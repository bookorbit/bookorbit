import { mkdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "node:util";
import { pino, type Logger } from "pino";
import type { ReadAloudErrorCode, ReadAloudStageDetail, ReadAloudWorkerStage } from "@bookorbit/types";
import { cleanMessage, errorClass, errorMessage, logLine } from "./log.js";
import { StageError, type LogListener, type Pipeline, type StageContext, type StageResult, type WorkPaths } from "./pipeline-contract.js";
import { MAX_EVENT_MESSAGE_LENGTH, type ControlToRunner, type EventData, type RunnerJob, type RunnerToControl } from "./protocol.js";
import {
  MARKER_STAGES,
  STAGE_DEPENDENCIES,
  fingerprint,
  markerStates,
  normalizedWeights,
  planStages,
  removeMarker,
  stageInputs,
  writeMarker,
  type FingerprintSource,
  type MarkerStage,
  type StageDecision,
} from "./stages.js";

const STAGE_ERROR_CODES: Record<ReadAloudWorkerStage, ReadAloudErrorCode> = {
  preparing_audio: "audio_processing_failed",
  downloading_model: "model_download_failed",
  generating_emissions: "inference_failed",
  marking_up_ebook: "markup_failed",
  aligning: "alignment_failed",
  validating: "invalid_output",
};

const STAGE_LABELS: Record<ReadAloudWorkerStage, string> = {
  preparing_audio: "Preparing audio",
  downloading_model: "Downloading the speech model",
  generating_emissions: "Generating emissions",
  marking_up_ebook: "Marking up the EPUB",
  aligning: "Aligning text and audio",
  validating: "Validating the output",
};

const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 1_000;
const MAX_FORWARDED_WARNINGS = 50;
const REPORT_TOTAL_KEYS = [
  "sentences",
  "matchedSentences",
  "interpolatedSentences",
  "unmatchedSentences",
  "droppedSentences",
  "seconds",
  "matchedSeconds",
  "interpolatedSeconds",
  "looseSeconds",
  "tracks",
  "unalignedTracks",
] as const;

class CancelledError extends Error {
  constructor() {
    super("The job was cancelled");
    this.name = "CancelledError";
  }
}

class StageFailure extends Error {
  constructor(
    readonly stage: ReadAloudWorkerStage | null,
    readonly code: ReadAloudErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StageFailure";
  }
}

const controller = new AbortController();
let started = false;
let consoleContext: { jobId: string; redactions: RunnerJob["redactions"] } | null = null;

// Libraries print to the console directly (ghost-story logs every model download with its absolute
// destination), so console output goes through the same single-line, redacted format as everything else.
for (const method of ["log", "info", "debug", "warn", "error"] as const) {
  console[method] = (...args: unknown[]) => {
    const level = method === "warn" || method === "error" ? method : "info";
    const message = cleanMessage(format(...args), consoleContext?.redactions ?? []);
    if (message) logLine("read_aloud.worker.console", null, { jobId: consoleContext?.jobId, level }, message);
  };
}

process.on("message", (message: ControlToRunner) => {
  if (message.type === "start" && !started) {
    started = true;
    consoleContext = { jobId: message.job.jobId, redactions: message.job.redactions };
    void run(message.job);
  } else if (message.type === "cancel") {
    controller.abort(new CancelledError());
  }
});

// The control process is gone, so nothing else will clean up after this run: stop it, and on the way out
// kill the runner's process group so an ffmpeg STAlign started does not keep running.
process.on("disconnect", () => {
  controller.abort(new CancelledError());
  process.once("exit", killOwnProcessGroup);
  setTimeout(() => process.exit(1), 5_000).unref();
});

/**
 * The control process forks each runner detached, which makes it the leader of a new process group that
 * holds only the runner and what it started; the control process is never in it. A runner that is not a
 * group leader has no group with its own pid, so the kill fails with ESRCH and signals nothing.
 */
function killOwnProcessGroup(): void {
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch {
    // ESRCH: this runner leads no process group.
  }
}

function send(message: RunnerToControl, callback?: () => void): void {
  if (!process.connected || !process.send) {
    callback?.();
    return;
  }
  process.send(message, undefined, {}, () => callback?.());
}

async function run(job: RunnerJob): Promise<void> {
  const runStartedAt = Date.now();
  const signal = controller.signal;
  const paths = workPaths(job.workDir);
  const reporter = new ProgressReporter();
  const clean = (text: string) => cleanMessage(text, job.redactions, MAX_EVENT_MESSAGE_LENGTH);
  let currentStage: ReadAloudWorkerStage | null = null;
  let forwardedWarnings = 0;

  const event = (level: "info" | "warn", stage: ReadAloudWorkerStage | null, code: string, message: string, data: EventData | null = null) => {
    send({ type: "event", level, stage, code, message: clean(message), data });
  };

  const createLogger = (listener?: LogListener): Logger =>
    pino(
      { level: "info", base: null, timestamp: false },
      {
        write(line: string) {
          let record: { level?: number; msg?: unknown; err?: { message?: unknown } };
          try {
            record = JSON.parse(line);
          } catch {
            return;
          }
          const level = (record.level ?? 30) >= 50 ? "error" : (record.level ?? 30) >= 40 ? "warn" : "info";
          const raw = typeof record.msg === "string" ? record.msg : typeof record.err?.message === "string" ? record.err.message : "";
          listener?.(level, raw);
          const message = clean(raw);
          logLine("read_aloud.worker.stalign", null, { jobId: job.jobId, stage: currentStage ?? undefined, level }, message);
          if (level !== "info" && forwardedWarnings < MAX_FORWARDED_WARNINGS) {
            forwardedWarnings += 1;
            event("warn", currentStage, "stalign_warning", message);
          }
        },
      },
    );

  const context = (stage: ReadAloudWorkerStage): StageContext => ({
    job,
    paths,
    signal,
    createLogger,
    progress: (fraction, detail) => reporter.update(stage, fraction, detail ?? null),
    event: (level, code, message, data) => event(level, stage, code, message, data ?? null),
  });

  const runStage = async (stage: ReadAloudWorkerStage, work: () => Promise<StageResult>, data: EventData = {}): Promise<number> => {
    currentStage = stage;
    const startedAt = Date.now();
    logLine("read_aloud.worker.stage", "start", { jobId: job.jobId, stage, ...data }, "stage started");
    event("info", stage, "stage_started", STAGE_LABELS[stage], Object.keys(data).length ? data : null);
    reporter.begin(stage);
    let result: StageResult;
    try {
      result = await work();
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const failure = toFailure(stage, error, signal);
      logLine(
        "read_aloud.worker.stage",
        "fail",
        { jobId: job.jobId, stage, durationMs, errorCode: failure.code, errorClass: errorClass(error), error: clean(errorMessage(error)) },
        "stage failed",
      );
      if (failure.code !== "cancelled") event("warn", stage, "stage_failed", failure.message, { durationMs, errorCode: failure.code });
      throw failure;
    }
    const durationMs = Date.now() - startedAt;
    const resultData = result?.data ?? {};
    logLine("read_aloud.worker.stage", "end", { jobId: job.jobId, stage, durationMs, ...resultData }, "stage finished");
    event("info", stage, "stage_finished", `${STAGE_LABELS[stage]} finished`, { durationMs, ...resultData });
    reporter.finish(stage);
    return durationMs;
  };

  try {
    await prepareFolders(job, paths);
    const pipeline = await loadPipeline();
    const source: FingerprintSource = {
      epub: job.epub,
      audio: job.audio,
      language: job.language,
      granularity: job.granularity,
      model: job.model,
      decisions: job.decisions,
    };
    const plan = planStages(await markerStates(job.workDir, source), job.resumeFrom);
    const decisionFor = (stage: MarkerStage): StageDecision => plan.find((entry) => entry.stage === stage)!;
    let needsModel = false;
    if (decisionFor("generating_emissions").run) {
      try {
        needsModel = !(await pipeline.modelInstalled(context("downloading_model")));
      } catch (error) {
        throw toFailure("downloading_model", error, signal);
      }
    }
    const order: ReadAloudWorkerStage[] = [
      "preparing_audio",
      ...(needsModel ? (["downloading_model"] as const) : []),
      "generating_emissions",
      "marking_up_ebook",
      "aligning",
      "validating",
    ];
    reporter.plan(order.filter((stage) => !isMarkerStage(stage) || decisionFor(stage).run));

    let outputBytes = 0;
    for (const stage of order) {
      signal.throwIfAborted();
      if (isMarkerStage(stage)) {
        const decision = decisionFor(stage);
        if (!decision.run) {
          logLine("read_aloud.worker.stage", "end", { jobId: job.jobId, stage, skipped: "cached" }, "stage cached");
          event("info", stage, "stage_skipped", `${STAGE_LABELS[stage]} reused from an earlier run`, { reason: "cached" });
          continue;
        }
        await removeMarker(job.workDir, stage);
        for (const dependent of dependentsOf(stage)) await removeMarker(job.workDir, dependent);
        await clearStageOutputs(stage, decision, paths);
        const inputs = stageInputs(stage, source);
        const durationMs = await runStage(stage, () => stageWork(pipeline, stage, context(stage)), { reason: decision.reason });
        await writeMarker(job.workDir, { stage, fingerprint: fingerprint(inputs), inputs, finishedAt: new Date().toISOString(), durationMs });
      } else if (stage === "downloading_model") {
        await runStage(stage, () => pipeline.downloadModel(context(stage)));
      } else {
        await runStage(stage, async () => {
          const validated = await validateOutput(paths, job.maxOutputBytes);
          outputBytes = validated.outputBytes;
          return { data: validated.data };
        });
      }
    }
    reporter.flush();
    logLine("read_aloud.worker.run", "end", { jobId: job.jobId, durationMs: Date.now() - runStartedAt, outputBytes }, "run finished");
    send({ type: "done", outputBytes }, () => process.exit(0));
  } catch (error) {
    reporter.flush();
    const failure = error instanceof StageFailure ? error : toFailure(currentStage, error, signal);
    logLine(
      "read_aloud.worker.run",
      "fail",
      { jobId: job.jobId, stage: failure.stage ?? undefined, durationMs: Date.now() - runStartedAt, errorCode: failure.code, error: failure.message },
      "run failed",
    );
    send({ type: "failed", code: failure.code, message: failure.message }, () => process.exit(0));
  }

  function toFailure(stage: ReadAloudWorkerStage | null, error: unknown, abortSignal: AbortSignal): StageFailure {
    if (error instanceof StageFailure) return error;
    if (abortSignal.aborted || error instanceof CancelledError) return new StageFailure(stage, "cancelled", "The job was cancelled");
    const label = stage ? STAGE_LABELS[stage] : "The job";
    const message = clean(errorMessage(error)) || `${label} failed without an error message; the worker log has details`;
    if (error instanceof StageError) return new StageFailure(stage, error.code, message);
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOSPC") {
      return new StageFailure(stage, "insufficient_storage", "The work volume ran out of free space");
    }
    return new StageFailure(stage, stage ? STAGE_ERROR_CODES[stage] : "unknown", message);
  }
}

function stageWork(pipeline: Pipeline, stage: MarkerStage, context: StageContext): Promise<StageResult> {
  switch (stage) {
    case "preparing_audio":
      return pipeline.prepareAudio(context);
    case "generating_emissions":
      return pipeline.generateEmissions(context);
    case "marking_up_ebook":
      return pipeline.markupEbook(context);
    case "aligning":
      return pipeline.align(context);
  }
}

function isMarkerStage(stage: ReadAloudWorkerStage): stage is MarkerStage {
  return (MARKER_STAGES as readonly string[]).includes(stage);
}

function dependentsOf(stage: MarkerStage): MarkerStage[] {
  const result = new Set<MarkerStage>();
  const visit = (current: MarkerStage) => {
    for (const candidate of MARKER_STAGES) {
      if (STAGE_DEPENDENCIES[candidate].includes(current) && !result.has(candidate)) {
        result.add(candidate);
        visit(candidate);
      }
    }
  };
  visit(stage);
  return [...result];
}

function workPaths(workDir: string): WorkPaths {
  return {
    workDir,
    sourceAudioDir: join(workDir, "source-audio"),
    processedAudioDir: join(workDir, "processed-audio"),
    emissionsDir: join(workDir, "emissions"),
    scratchDir: join(workDir, "scratch"),
    upgradedEpubPath: join(workDir, "upgraded.epub"),
    markedEpubPath: join(workDir, "marked.epub"),
    outputPath: join(workDir, "output.epub"),
    reportPath: join(workDir, "report.json"),
  };
}

/** Never removes the job folder: cached stages are what make retries and restarts resume. */
async function prepareFolders(job: RunnerJob, paths: WorkPaths): Promise<void> {
  await mkdir(paths.workDir, { recursive: true });
  await rm(paths.scratchDir, { recursive: true, force: true });
  await mkdir(paths.scratchDir, { recursive: true });
  await rm(paths.sourceAudioDir, { recursive: true, force: true });
  await mkdir(paths.sourceAudioDir, { recursive: true });
  for (const [index, audio] of job.audio.entries()) {
    const name = `${String(index + 1).padStart(4, "0")}${extname(audio.path).toLowerCase()}`;
    await symlink(audio.path, join(paths.sourceAudioDir, name));
  }
}

async function clearStageOutputs(stage: MarkerStage, decision: StageDecision, paths: WorkPaths): Promise<void> {
  if (stage === "preparing_audio") {
    // Splitting is not resumable, and a stale split from different sources would pair with the wrong emissions.
    await rm(paths.processedAudioDir, { recursive: true, force: true });
    if (decision.state === "stale") await rm(paths.emissionsDir, { recursive: true, force: true });
  }
  if (stage === "aligning") {
    await rm(paths.outputPath, { force: true });
    await rm(paths.reportPath, { force: true });
  }
}

async function validateOutput(paths: WorkPaths, maxOutputBytes: number): Promise<{ outputBytes: number; data: EventData }> {
  const output = await stat(paths.outputPath).catch(() => null);
  if (!output?.isFile() || output.size <= 0) throw new StageError("invalid_output", "The aligned EPUB is missing or empty");
  if (output.size > maxOutputBytes) {
    throw new StageError("invalid_output", `The aligned EPUB is ${output.size} bytes, above the ${maxOutputBytes} byte limit`);
  }
  const report = await stat(paths.reportPath).catch(() => null);
  if (!report?.isFile() || report.size <= 0 || report.size > MAX_REPORT_BYTES) {
    throw new StageError("invalid_output", "The alignment report is missing, empty or too large");
  }
  let parsed: { totals?: Record<string, unknown> } | null;
  try {
    parsed = JSON.parse(await readFile(paths.reportPath, "utf8"));
  } catch {
    throw new StageError("invalid_output", "The alignment report is not valid JSON");
  }
  const totals = parsed?.totals;
  if (!totals || REPORT_TOTAL_KEYS.some((key) => typeof totals[key] !== "number" || !Number.isFinite(totals[key]))) {
    throw new StageError("invalid_output", "The alignment report has no usable totals");
  }
  return {
    outputBytes: output.size,
    data: {
      outputBytes: output.size,
      sentences: totals.sentences as number,
      matchedSentences: totals.matchedSentences as number,
      tracks: totals.tracks as number,
      unalignedTracks: totals.unalignedTracks as number,
    },
  };
}

async function loadPipeline(): Promise<Pipeline> {
  // Test hook: the worker tests point this at a fake pipeline module.
  const override = process.env.READ_ALOUD_RUNNER_PIPELINE?.trim();
  const module = (await import(override ? pathToFileURL(override).href : "./pipeline.js")) as { pipeline?: Pipeline; default?: Pipeline };
  const pipeline = module.pipeline ?? module.default;
  if (!pipeline) throw new Error("The pipeline module exports no pipeline");
  return pipeline;
}

/** Maps stage fractions onto 0-100 across the stages that run, at most once per second. */
class ProgressReporter {
  private weights = new Map<ReadAloudWorkerStage, number>();
  private completed = 0;
  private overall = 0;
  private lastSentAt = 0;
  private pending: RunnerToControl | null = null;
  private timer: NodeJS.Timeout | null = null;

  plan(stages: readonly ReadAloudWorkerStage[]): void {
    this.weights = normalizedWeights(stages);
  }

  begin(stage: ReadAloudWorkerStage): void {
    this.update(stage, 0, null, true);
  }

  update(stage: ReadAloudWorkerStage, fraction: number, detail: ReadAloudStageDetail | null, force = false): void {
    const bounded = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    const weight = this.weights.get(stage) ?? 0;
    this.overall = Math.min(100, Math.max(this.overall, this.completed + weight * bounded));
    this.pending = { type: "progress", stage, overall: Math.round(this.overall * 10) / 10, stageFraction: bounded, detail };
    const wait = PROGRESS_INTERVAL_MS - (Date.now() - this.lastSentAt);
    if (force || wait <= 0) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), wait);
  }

  finish(stage: ReadAloudWorkerStage): void {
    this.completed += this.weights.get(stage) ?? 0;
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    send(this.pending);
    this.pending = null;
    this.lastSentAt = Date.now();
  }
}
