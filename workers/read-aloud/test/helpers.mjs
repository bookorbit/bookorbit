import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { startWorker } from "../dist/server.js";

export const TOKEN = "test-token-0123456789abcdef";
export const FAKE_PIPELINE = fileURLToPath(new URL("./fixtures/fake-pipeline.mjs", import.meta.url));

/** A throwaway library and data folder under the system temp folder. */
export function makeSandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "read-aloud-worker-test-")));
  const library = join(root, "library");
  const book = join(library, "Author", "Book");
  const data = join(root, "data", "read-aloud");
  mkdirSync(book, { recursive: true });
  mkdirSync(join(data, "jobs"), { recursive: true });
  writeFileSync(join(book, "book.epub"), "epub-bytes");
  writeFileSync(join(book, "01.mp3"), "a".repeat(1000));
  writeFileSync(join(book, "02.mp3"), "b".repeat(2000));
  return {
    root,
    library,
    book,
    workRoot: join(data, "jobs"),
    tmpDir: join(data, "tmp"),
    logPath: join(root, "fake-pipeline.jsonl"),
    modelDir: join(root, "models"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export async function startTestWorker(sandbox, options = {}) {
  const config = {
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    libraryRoots: options.libraryRoots ?? [sandbox.library],
    workRoot: sandbox.workRoot,
    tmpDir: sandbox.tmpDir,
    configuredDevice: "cpu",
    dtype: null,
    batchSize: null,
  };
  mkdirSync(sandbox.tmpDir, { recursive: true });
  const worker = await startWorker({
    config,
    configuredDevice: "cpu",
    device: "cpu",
    deviceCheck: "not_checked",
    version: "0.0.0-test",
    cancelGraceMs: options.cancelGraceMs ?? 5_000,
    freeBytes: options.freeBytes,
    rootChecks: options.rootChecks,
    runnerEnv: {
      READ_ALOUD_RUNNER_PIPELINE: FAKE_PIPELINE,
      FAKE_PIPELINE_MODE: options.mode ?? "ok",
      FAKE_PIPELINE_LOG: sandbox.logPath,
      ...(options.modelDir ? { FAKE_MODEL_DIR: options.modelDir } : {}),
    },
  });
  const base = `http://127.0.0.1:${worker.port}`;
  return {
    worker,
    base,
    async call(method, path, body, token = TOKEN) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    close: () => worker.close(),
  };
}

export function jobRequest(sandbox, overrides = {}) {
  const jobId = overrides.jobId ?? randomUUID();
  return {
    jobId,
    epubPath: join(sandbox.book, "book.epub"),
    audioPaths: [join(sandbox.book, "01.mp3"), join(sandbox.book, "02.mp3")],
    workDir: join(sandbox.workRoot, jobId),
    language: "en",
    granularity: "sentence",
    model: "quartznet15x5",
    sourceBytes: 3010,
    audioDurationSeconds: 120,
    maxOutputBytes: 1_000_000,
    decisions: { chapters: {}, audio: [] },
    resumeFrom: null,
    ...overrides,
  };
}

export async function waitForJob(client, jobId, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await client.call("GET", `/v1/jobs/${jobId}`);
    if (last.status === 200 && predicate(last.body)) return last.body;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for job ${jobId}; last state ${JSON.stringify(last?.body)}`);
}

export function stagesRun(sandbox, jobId) {
  let text = "";
  try {
    text = readFileSync(sandbox.logPath, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.jobId === jobId);
}

export function resetStageLog(sandbox) {
  rmSync(sandbox.logPath, { force: true });
}

export const TERMINAL = new Set(["completed", "failed", "cancelled"]);
