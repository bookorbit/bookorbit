import { fork, type ChildProcess } from "node:child_process";
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ReadAloudErrorCode,
  ReadAloudJobEventLevel,
  ReadAloudStageDetail,
  ReadAloudWorkerEvent,
  ReadAloudWorkerJob,
  ReadAloudWorkerRequest,
  ReadAloudWorkerStage,
} from "@bookorbit/types";
import type { ResolvedCtcDevice } from "./accelerator.js";
import { workerTmpDir, type WorkerConfig } from "./config.js";
import { cleanMessage, errorClass, errorMessage, logLine } from "./log.js";
import { ReadableRoots, RequestError, expectedWorkDir, resolveSource, type RootCheckOptions } from "./paths.js";
import {
  MAX_EVENT_MESSAGE_LENGTH,
  type EventData,
  type Redaction,
  type RunnerJob,
  type RunnerToControl,
  type SourceFingerprint,
} from "./protocol.js";
import { markerStates, planStages, requiredDiskBytes, type FingerprintSource, type MarkerStage } from "./stages.js";

const MAX_EVENTS_PER_JOB = 1_000;
const DEFAULT_CANCEL_GRACE_MS = 30_000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60_000;
const SEQ_FILE = ".worker-event-seq";
const TERMINAL = new Set<ReadAloudWorkerJob["status"]>(["completed", "failed", "cancelled"]);

export type RegistryOptions = {
  config: WorkerConfig;
  device: ResolvedCtcDevice;
  runnerPath?: string;
  /** Extra environment for the runner; the tests use it to load a fake pipeline. */
  runnerEnv?: Record<string, string>;
  cancelGraceMs?: number;
  retentionMs?: number;
  freeBytes?: (path: string) => Promise<number | null>;
  rootChecks?: RootCheckOptions;
};

type JobRecord = {
  jobId: string;
  request: ReadAloudWorkerRequest;
  status: ReadAloudWorkerJob["status"];
  stage: ReadAloudWorkerStage;
  progress: number;
  stageDetail: ReadAloudStageDetail | null;
  errorCode: ReadAloudErrorCode | null;
  error: string | null;
  outputBytes: number | null;
  events: ReadAloudWorkerEvent[];
  lastSeq: number;
  /** Where the last event number is kept, so numbering continues after a worker restart. */
  seqFile: string;
  attempt: number;
  child: ChildProcess | null;
  result: Extract<RunnerToControl, { type: "done" | "failed" }> | null;
  /** Whether the runner has reported a stage yet; failures before that carry no stage. */
  stageReported: boolean;
  cancelRequested: boolean;
  killed: boolean;
  killTimer: NodeJS.Timeout | null;
  startedAt: number;
  finishedAt: number | null;
};

export type SubmitResult = { status: 200 | 202; job: ReadAloudWorkerJob };

type ResolvedSources = { workDir: string; epub: SourceFingerprint; audio: SourceFingerprint[] };

export class JobRegistry {
  private readonly jobs = new Map<string, JobRecord>();
  private activeJobId: string | null = null;
  /** The submit between taking the slot and spawning its runner, so shutdown can wait it out. */
  private starting: Promise<unknown> | null = null;
  private stopping = false;
  private readonly runnerPath: string;
  private readonly cancelGraceMs: number;
  private readonly retentionMs: number;
  private readonly redactions: Redaction[];
  private readonly roots: ReadableRoots;
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly options: RegistryOptions) {
    this.runnerPath = options.runnerPath ?? fileURLToPath(new URL("./runner.js", import.meta.url));
    this.cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.redactions = buildRedactions(options.config);
    this.roots = new ReadableRoots(options.config.libraryRoots, options.rootChecks);
    this.sweepTimer = setInterval(() => this.sweep(), 60 * 60_000);
    this.sweepTimer.unref();
  }

  get active(): string | null {
    return this.activeJobId;
  }

  get redactionList(): readonly Redaction[] {
    return this.redactions;
  }

  /** The library folders readable now; health reuses a check for a few seconds, a job always checks again. */
  libraryRoots(maxAgeMs?: number): Promise<string[]> {
    return this.roots.get(maxAgeMs);
  }

  get(jobId: string, afterSeq = 0): ReadAloudWorkerJob | null {
    const record = this.jobs.get(jobId);
    return record ? this.view(record, afterSeq) : null;
  }

  async submit(request: ReadAloudWorkerRequest): Promise<SubmitResult> {
    const existing = this.jobs.get(request.jobId);
    if (existing && !TERMINAL.has(existing.status)) return { status: 200, job: this.view(existing, 0) };
    // A 503 makes the server wait and resubmit to the next process instead of starting a runner here.
    if (this.stopping) throw new RequestError(503, "worker_unavailable", "The worker is shutting down");
    if (this.activeJobId) {
      throw new RequestError(503, "worker_unavailable", "The worker is busy with another job");
    }
    this.activeJobId = request.jobId;
    const starting = this.start(request, existing);
    this.starting = starting;
    try {
      return await starting;
    } finally {
      if (this.starting === starting) this.starting = null;
    }
  }

  private async start(request: ReadAloudWorkerRequest, existing: JobRecord | undefined): Promise<SubmitResult> {
    let resolved: ResolvedSources;
    try {
      resolved = await this.resolve(request);
      if (this.stopping) throw new RequestError(503, "worker_unavailable", "The worker is shutting down");
    } catch (error) {
      this.activeJobId = null;
      if (error instanceof RequestError) {
        logLine(
          "read_aloud.worker.request",
          "fail",
          { jobId: request.jobId, errorCode: error.code, error: this.clean(error.message) },
          "job rejected",
        );
      }
      throw error;
    }
    const record = this.startRecord(request, existing, resolved.workDir);
    logLine(
      "read_aloud.worker.job",
      "start",
      {
        jobId: record.jobId,
        attempt: record.attempt,
        audioFiles: request.audioPaths.length,
        sourceBytes: request.sourceBytes,
        resumeFrom: request.resumeFrom ?? "none",
      },
      "job accepted",
    );
    this.event(record, "info", null, "job_accepted", "Job accepted by the worker", {
      attempt: record.attempt,
      resumeFrom: request.resumeFrom,
      device: this.options.device,
    });

    try {
      await mkdir(resolved.workDir, { recursive: true });
      await mkdir(workerTmpDir(this.options.config), { recursive: true });
      const enough = await this.checkDisk(record, resolved);
      if (!enough) return { status: 202, job: this.view(record, 0) };
      // Shutdown began while the job was being set up: no runner may start after it.
      if (this.stopping) this.cancel(record.jobId);
      if (record.cancelRequested) {
        this.finish(record, "cancelled", "cancelled", "The job was cancelled");
        return { status: 202, job: this.view(record, 0) };
      }
      this.spawn(record, resolved);
    } catch (error) {
      this.finish(record, "failed", "unknown", `The worker could not start the job: ${this.clean(errorMessage(error))}`);
    }
    return { status: 202, job: this.view(record, 0) };
  }

  cancel(jobId: string): ReadAloudWorkerJob | null {
    const record = this.jobs.get(jobId);
    if (!record) return null;
    if (TERMINAL.has(record.status) || record.cancelRequested) return this.view(record, 0);
    record.cancelRequested = true;
    logLine("read_aloud.worker.cancel", "start", { jobId, graceMs: this.cancelGraceMs }, "cancel requested");
    this.event(record, "info", record.stage, "cancel_requested", "Cancellation requested");
    const child = record.child;
    if (child) {
      try {
        child.send({ type: "cancel" });
      } catch {
        // The runner is already exiting; its close handler records the outcome.
      }
      record.killTimer = setTimeout(() => {
        if (record.child !== child || child.exitCode !== null || child.signalCode !== null) return;
        record.killed = true;
        logLine("read_aloud.worker.cancel", "fail", { jobId, graceMs: this.cancelGraceMs }, "runner ignored cancel, killing it");
        this.event(record, "warn", record.stage, "runner_killed", "The job did not stop in time and was killed", { graceMs: this.cancelGraceMs });
        killGroup(child);
      }, this.cancelGraceMs);
    }
    return this.view(record, 0);
  }

  /** Cancels the running job and waits for its runner to exit, for shutdown. A job still starting never gets a runner. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.sweepTimer);
    await this.starting?.catch(() => undefined);
    const record = this.activeJobId ? this.jobs.get(this.activeJobId) : undefined;
    const child = record?.child;
    if (!record || !child) return;
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    this.cancel(record.jobId);
    await exited;
  }

  private async resolve(request: ReadAloudWorkerRequest): Promise<ResolvedSources> {
    const { workRoot } = this.options.config;
    const workDir = expectedWorkDir(request.workDir, workRoot, request.jobId);
    const libraryRoots = await this.roots.get(0);
    const epub = await resolveSource(request.epubPath, libraryRoots, "EPUB");
    const audio: SourceFingerprint[] = [];
    for (const [index, path] of request.audioPaths.entries()) audio.push(await resolveSource(path, libraryRoots, `audio file ${index + 1}`));
    return { workDir, epub, audio };
  }

  private startRecord(request: ReadAloudWorkerRequest, previous: JobRecord | undefined, workDir: string): JobRecord {
    const seqFile = join(workDir, SEQ_FILE);
    const record: JobRecord = {
      jobId: request.jobId,
      request,
      status: "queued",
      stage: "preparing_audio",
      progress: 0,
      stageDetail: null,
      errorCode: null,
      error: null,
      outputBytes: null,
      events: previous?.events ?? [],
      lastSeq: previous?.lastSeq ?? readSeq(seqFile),
      seqFile,
      attempt: (previous?.attempt ?? 0) + 1,
      child: null,
      result: null,
      stageReported: false,
      cancelRequested: false,
      killed: false,
      killTimer: null,
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.jobs.set(record.jobId, record);
    return record;
  }

  private async checkDisk(record: JobRecord, resolved: ResolvedSources): Promise<boolean> {
    const request = record.request;
    const source: FingerprintSource = {
      epub: resolved.epub,
      audio: resolved.audio,
      language: request.language,
      granularity: request.granularity,
      model: request.model,
      decisions: request.decisions,
    };
    const plan = planStages(await markerStates(resolved.workDir, source), request.resumeFrom);
    const skipped = new Set<MarkerStage>(plan.filter((entry) => !entry.run).map((entry) => entry.stage));
    const { required } = requiredDiskBytes({
      audioBytes: resolved.audio.reduce((sum, file) => sum + file.size, 0),
      epubBytes: resolved.epub.size,
      audioDurationSeconds: request.audioDurationSeconds,
      skipped,
    });
    const available = await (this.options.freeBytes ?? freeBytes)(resolved.workDir);
    const data = { neededBytes: required, availableBytes: available, cachedStages: skipped.size };
    if (available === null || available >= required) {
      this.event(record, "info", null, "disk_checked", "Enough free space for this run", data);
      return true;
    }
    logLine("read_aloud.worker.disk", "fail", { jobId: record.jobId, neededBytes: required, availableBytes: available }, "insufficient storage");
    this.event(record, "error", null, "disk_check_failed", "Not enough free space in the worker's data folder for this run", data);
    this.finish(record, "failed", "insufficient_storage", `The run needs ${required} free bytes but ${available} are available`);
    return false;
  }

  private spawn(record: JobRecord, resolved: ResolvedSources): void {
    const { config } = this.options;
    const request = record.request;
    const job: RunnerJob = {
      jobId: record.jobId,
      attempt: record.attempt,
      workDir: resolved.workDir,
      epub: resolved.epub,
      audio: resolved.audio,
      language: request.language,
      granularity: request.granularity,
      model: request.model,
      maxOutputBytes: request.maxOutputBytes,
      decisions: request.decisions,
      resumeFrom: request.resumeFrom,
      device: this.options.device,
      dtype: config.dtype,
      batchSize: config.batchSize,
      redactions: this.redactions,
    };
    const child = fork(this.runnerPath, [], {
      execArgv: [],
      // Its own process group: STAlign runs ffmpeg through a shell, and aborting only stops the shell.
      detached: true,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: {
        ...process.env,
        ...this.options.runnerEnv,
        TMPDIR: workerTmpDir(config),
        STORYTELLER_SCRATCH_DIR: join(resolved.workDir, "scratch"),
      },
    });
    record.child = child;
    record.status = "running";
    child.on("message", (message: RunnerToControl) => this.onMessage(record, child, message));
    child.on("error", (error) => {
      logLine(
        "read_aloud.worker.runner",
        "fail",
        { jobId: record.jobId, errorClass: errorClass(error), error: this.clean(errorMessage(error)) },
        "runner error",
      );
    });
    child.on("close", (code, signal) => this.onClose(record, child, code, signal));
    child.send({ type: "start", job });
  }

  private onMessage(record: JobRecord, child: ChildProcess, message: RunnerToControl): void {
    if (record.child !== child) return;
    switch (message.type) {
      case "progress":
        record.stageReported = true;
        record.stage = message.stage;
        record.progress = Math.max(record.progress, Math.min(100, Math.floor(message.overall)));
        record.stageDetail = message.detail;
        return;
      case "event":
        this.event(record, message.level, message.stage, message.code, message.message, message.data);
        if (message.stage && message.code === "stage_started") {
          record.stageReported = true;
          record.stage = message.stage;
          record.stageDetail = null;
        }
        return;
      case "done":
      case "failed":
        record.result = message;
        return;
    }
  }

  private onClose(record: JobRecord, child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (record.child !== child) return;
    record.child = null;
    // Anything the runner left behind, such as an ffmpeg a cancel orphaned, would keep using CPU and
    // hold disk space after the job folder is gone.
    killGroup(child);
    if (record.killTimer) clearTimeout(record.killTimer);
    record.killTimer = null;
    const result = record.result;
    if (record.cancelRequested) {
      this.finish(record, "cancelled", "cancelled", record.killed ? "The job was cancelled and its runner was killed" : "The job was cancelled");
    } else if (result?.type === "done") {
      record.outputBytes = result.outputBytes;
      record.progress = 100;
      record.stage = "validating";
      record.stageDetail = null;
      this.finish(record, "completed", null, null);
    } else if (result?.type === "failed") {
      this.finish(record, result.code === "cancelled" ? "cancelled" : "failed", result.code, result.message);
    } else {
      const exit = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      this.finish(record, "failed", "worker_crashed", `The job runner exited unexpectedly (${exit})`, { exitCode: code, signal });
    }
  }

  private finish(
    record: JobRecord,
    status: "completed" | "failed" | "cancelled",
    code: ReadAloudErrorCode | null,
    message: string | null,
    extra: EventData = {},
  ): void {
    record.status = status;
    record.errorCode = code;
    record.error = message ? this.clean(message) : null;
    record.finishedAt = Date.now();
    if (this.activeJobId === record.jobId) this.activeJobId = null;
    const durationMs = record.finishedAt - record.startedAt;
    if (status === "completed") {
      logLine("read_aloud.worker.job", "end", { jobId: record.jobId, status, durationMs, outputBytes: record.outputBytes ?? 0 }, "job finished");
      this.event(record, "info", null, "job_completed", "Generation finished", { durationMs, outputBytes: record.outputBytes });
    } else if (status === "cancelled") {
      logLine("read_aloud.worker.cancel", "end", { jobId: record.jobId, durationMs, killed: record.killed }, "job cancelled");
      this.event(record, "info", null, "job_cancelled", "The job was cancelled", { durationMs, killed: record.killed });
    } else {
      logLine(
        "read_aloud.worker.job",
        "fail",
        {
          jobId: record.jobId,
          stage: record.stageReported ? record.stage : undefined,
          errorCode: code ?? "unknown",
          durationMs,
          error: record.error ?? "",
        },
        "job failed",
      );
      const stage = record.stageReported ? record.stage : null;
      this.event(record, "error", stage, "job_failed", record.error ?? "The job failed", { errorCode: code, durationMs, ...extra });
    }
  }

  private event(
    record: JobRecord,
    level: ReadAloudJobEventLevel,
    stage: ReadAloudWorkerStage | null,
    code: string,
    message: string | null,
    data: EventData | null = null,
  ): void {
    record.lastSeq += 1;
    record.events.push({
      seq: record.lastSeq,
      at: new Date().toISOString(),
      level,
      stage,
      code,
      message: message === null ? null : this.clean(message),
      data,
    });
    if (record.events.length > MAX_EVENTS_PER_JOB) record.events.splice(0, record.events.length - MAX_EVENTS_PER_JOB);
    writeSeq(record.seqFile, record.lastSeq);
  }

  private view(record: JobRecord, afterSeq: number): ReadAloudWorkerJob {
    return {
      jobId: record.jobId,
      status: record.status,
      stage: record.stage,
      progress: record.progress,
      stageDetail: record.stageDetail,
      errorCode: record.errorCode,
      error: record.error,
      outputBytes: record.outputBytes,
      events: record.events.filter((entry) => entry.seq > afterSeq),
    };
  }

  private clean(text: string): string {
    return cleanMessage(text, this.redactions, MAX_EVENT_MESSAGE_LENGTH);
  }

  private sweep(): void {
    const cutoff = Date.now() - this.retentionMs;
    for (const [id, record] of this.jobs) {
      if (TERMINAL.has(record.status) && record.finishedAt !== null && record.finishedAt < cutoff) this.jobs.delete(id);
    }
  }
}

/** Kills the runner's whole process group; ESRCH just means nothing was left in it. */
function killGroup(child: ChildProcess): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
  }
  child.kill("SIGKILL");
}

function readSeq(path: string): number {
  try {
    const value = Number(readFileSync(path, "utf8").trim());
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeSeq(path: string, seq: number): void {
  try {
    writeFileSync(`${path}.partial`, String(seq));
    renameSync(`${path}.partial`, path);
  } catch {
    // The job folder may not exist yet for the first event; the next event writes it.
  }
}

export async function freeBytes(path: string): Promise<number | null> {
  try {
    const info = await statfs(path, { bigint: true });
    const bytes = info.bavail * info.bsize;
    return bytes > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(bytes);
  } catch {
    return null;
  }
}

/** Configured folders and their real paths (macOS resolves /tmp and /var through /private). */
function buildRedactions(config: WorkerConfig): Redaction[] {
  const folders: Redaction[] = [
    { path: config.workRoot, placeholder: "<work>" },
    { path: config.tmpDir, placeholder: "<tmp>" },
    ...config.libraryRoots.map((path) => ({ path, placeholder: "<library>" })),
  ];
  const home = homedir();
  if (home && home !== "/") folders.push({ path: home, placeholder: "<home>" });
  const redactions: Redaction[] = [];
  for (const folder of folders) {
    redactions.push(folder);
    try {
      const real = realpathSync.native(folder.path);
      if (real !== folder.path) redactions.push({ path: real, placeholder: folder.placeholder });
    } catch {
      // A folder that does not exist yet has no other spelling.
    }
  }
  return redactions;
}
