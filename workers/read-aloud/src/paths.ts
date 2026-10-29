import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ReadAloudErrorCode } from "@bookorbit/types";
import { errorClass, errorMessage, logLine } from "./log.js";
import type { SourceFingerprint } from "./protocol.js";

const ROOT_CHECK_MAX_AGE_MS = 5_000;
const ROOT_CHECK_TIMEOUT_MS = 2_000;

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ReadAloudErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export function within(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** The job folder is always `<workRoot>/<jobId>`; anything else means the server and worker disagree on the data mount. */
export function expectedWorkDir(input: string, workRoot: string, jobId: string): string {
  const expected = resolve(workRoot, jobId);
  if (!isAbsolute(input) || resolve(input) !== expected || !within(expected, workRoot)) {
    throw new RequestError(
      400,
      "worker_incompatible",
      "workDir does not match the worker's job folder; check that both use the same read-aloud data folder",
    );
  }
  return expected;
}

/**
 * Resolves a source the server sent. A path outside every configured root is reported as
 * `library_not_mounted` before touching the filesystem, because an unmounted library looks exactly
 * like a missing file from inside the worker.
 */
export async function resolveSource(input: string, roots: readonly string[], label: string): Promise<SourceFingerprint> {
  if (!isAbsolute(input)) throw new RequestError(400, "invalid_source", `The ${label} path must be absolute`);
  const lexical = resolve(input);
  if (!roots.some((root) => within(lexical, root))) {
    throw new RequestError(400, "library_not_mounted", `The ${label} is outside every folder the worker can read`);
  }
  let real: string;
  try {
    real = await realpath(lexical);
  } catch (error) {
    throw sourceError(error, label);
  }
  const realRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => null)));
  if (!realRoots.some((root) => root !== null && within(real, root))) {
    throw new RequestError(400, "library_not_mounted", `The ${label} resolves outside every folder the worker can read`);
  }
  try {
    const info = await stat(real);
    if (!info.isFile()) throw new RequestError(400, "invalid_source", `The ${label} is not a regular file`);
    await access(real, constants.R_OK);
    return { path: real, size: info.size, mtimeMs: Math.trunc(info.mtimeMs) };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw sourceError(error, label);
  }
}

function sourceError(error: unknown, label: string): RequestError {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return new RequestError(400, "source_missing", `The ${label} does not exist`);
  return new RequestError(400, "invalid_source", `The ${label} cannot be read (${code ?? "unknown error"})`);
}

export type RootCheckOptions = {
  /** How long health reuses the last check before the folders are checked again. */
  maxAgeMs?: number;
  /** How long one folder may take to answer before it counts as unreadable for that check. */
  timeoutMs?: number;
  /** Replaces the access check; the tests use it to stand in for a hung mount. */
  check?: (path: string) => Promise<void>;
};

type RootState = { readable: boolean | null; pending: Promise<boolean> | null };

/**
 * The configured library folders this process can read right now. They are checked again once the last
 * check is older than `maxAgeMs`, so a folder that was not readable at startup, such as an automount that
 * comes up after the worker, is picked up without a restart. A folder whose earlier check has not answered
 * yet (a hung network mount) is not checked again until it does, so a dead mount holds at most one
 * filesystem thread.
 */
export class ReadableRoots {
  private readonly states = new Map<string, RootState>();
  private readable: string[] = [];
  private checkedAt: number | null = null;
  private refreshing: Promise<string[]> | null = null;

  constructor(
    private readonly roots: readonly string[],
    private readonly options: RootCheckOptions = {},
  ) {}

  /** The readable folders in configured order; `maxAgeMs: 0` checks again unless a check is already running. */
  get(maxAgeMs = this.options.maxAgeMs ?? ROOT_CHECK_MAX_AGE_MS): Promise<string[]> {
    if (this.checkedAt !== null && Date.now() - this.checkedAt < maxAgeMs) return Promise.resolve(this.readable);
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<string[]> {
    const results = await Promise.all(this.roots.map((root) => this.checkRoot(root)));
    this.readable = this.roots.filter((_, index) => results[index]);
    this.checkedAt = Date.now();
    return this.readable;
  }

  private async checkRoot(root: string): Promise<boolean> {
    let state = this.states.get(root);
    if (!state) this.states.set(root, (state = { readable: null, pending: null }));
    const entry = state;
    entry.pending ??= (this.options.check ?? canRead)(root).then(
      () => this.settle(root, entry, null),
      (error: unknown) => this.settle(root, entry, error),
    );
    const timeoutMs = this.options.timeoutMs ?? ROOT_CHECK_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const readable = await Promise.race([entry.pending, timedOut]);
    clearTimeout(timer);
    if (readable !== null) return readable;
    this.report(root, entry, false, "TimeoutError", `no answer within ${timeoutMs} ms`);
    return false;
  }

  private settle(root: string, state: RootState, error: unknown): boolean {
    state.pending = null;
    if (error === null) this.report(root, state, true);
    else this.report(root, state, false, errorClass(error), (error as NodeJS.ErrnoException).code ?? errorMessage(error));
    return error === null;
  }

  /** Logs only changes, so a folder that stays unreadable is not reported on every health check. */
  private report(root: string, state: RootState, readable: boolean, errorName?: string, error?: string): void {
    if (readable && state.readable === false) {
      logLine("read_aloud.worker.library_root", "end", { path: root }, "library folder is readable again and is back in health");
    } else if (!readable && state.readable !== false) {
      logLine(
        "read_aloud.worker.library_root",
        "fail",
        { path: root, errorClass: errorName, error },
        "library folder is not readable and is left out of health",
      );
    }
    state.readable = readable;
  }
}

function canRead(path: string): Promise<void> {
  return access(path, constants.R_OK | constants.X_OK);
}
