import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, test } from "node:test";
import { FAKE_PIPELINE, makeSandbox, stagesRun } from "./helpers.mjs";

const RUNNER = new URL("../dist/runner.js", import.meta.url);

describe("runner without its control process", () => {
  test("a runner whose control process goes away kills what it started", async () => {
    const sandbox = makeSandbox();
    const job = runnerJob(sandbox);
    const runner = startRunner(sandbox, "orphan-child", { detached: true });
    let orphan = null;
    try {
      runner.child.send({ type: "start", job });
      const pidFile = join(job.workDir, "orphan.pid");
      await until(() => existsSync(pidFile), "the stand-in ffmpeg to start");
      orphan = Number(readFileSync(pidFile, "utf8"));
      assert.ok(isAlive(orphan), "the stand-in ffmpeg is running");

      runner.child.disconnect();
      const exit = await runner.exited;
      assert.equal(exit.signal, "SIGKILL", "the runner went down with its own process group");
      await until(() => !isAlive(orphan), "the orphaned child to be killed");
    } finally {
      runner.stop();
      if (orphan !== null && isAlive(orphan)) process.kill(orphan, "SIGKILL");
      sandbox.cleanup();
    }
  });

  test("a runner that leads no process group signals nothing outside itself", async () => {
    const sandbox = makeSandbox();
    const job = runnerJob(sandbox);
    // Not detached: the runner shares this test's process group, as it would if it were started by hand.
    const runner = startRunner(sandbox, "hang", { detached: false });
    try {
      runner.child.send({ type: "start", job });
      await until(() => stagesRun(sandbox, job.jobId).some((entry) => entry.stage === "generating_emissions"), "the runner to reach inference");

      runner.child.disconnect();
      const exit = await runner.exited;
      assert.equal(exit.signal, null, "the group kill found no group of its own and signalled nothing");
      assert.ok(isAlive(process.pid));
    } finally {
      runner.stop();
      sandbox.cleanup();
    }
  });
});

function startRunner(sandbox, mode, { detached }) {
  const child = fork(RUNNER, [], {
    execArgv: [],
    detached,
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    env: { ...process.env, READ_ALOUD_RUNNER_PIPELINE: FAKE_PIPELINE, FAKE_PIPELINE_MODE: mode, FAKE_PIPELINE_LOG: sandbox.logPath },
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return {
    child,
    exited,
    stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
}

function runnerJob(sandbox) {
  const jobId = randomUUID();
  return {
    jobId,
    attempt: 1,
    workDir: join(sandbox.workRoot, jobId),
    epub: fingerprint(join(sandbox.book, "book.epub")),
    audio: [fingerprint(join(sandbox.book, "01.mp3"))],
    language: "en",
    granularity: "sentence",
    model: "quartznet15x5",
    maxOutputBytes: 1_000_000,
    decisions: { chapters: {}, audio: [] },
    resumeFrom: null,
    device: "cpu",
    dtype: null,
    batchSize: null,
    redactions: [],
  };
}

function fingerprint(path) {
  const info = statSync(path);
  return { path, size: info.size, mtimeMs: Math.trunc(info.mtimeMs) };
}

async function until(predicate, what, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(25);
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
