// Opt-in end-to-end run of the real STAlign pipeline: READ_ALOUD_SMOKE=1 pnpm --filter
// @bookorbit/read-aloud-worker test. It needs macOS (`say`), ffmpeg, zip and unzip, and the first run
// downloads the English QuartzNet model. READ_ALOUD_SMOKE_FRESH_MODEL=1 points the model cache at the
// temp folder to time a fresh download. Everything it writes lives in a temp folder.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { makeFixture } from "./smoke/make-fixture.mjs";

const enabled = process.env.READ_ALOUD_SMOKE === "1";
const TOKEN = `smoke-${randomUUID()}`;

test(
  "the real pipeline produces a media overlay EPUB and resumes from its cache",
  { skip: !enabled && "set READ_ALOUD_SMOKE=1 to run", timeout: 30 * 60_000 },
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "read-aloud-smoke-")));
    const workRoot = join(root, "data", "read-aloud", "jobs");
    const fixture = makeFixture(root);
    const worker = await startMainProcess({
      READ_ALOUD_WORKER_TOKEN: TOKEN,
      PORT: "0",
      READ_ALOUD_LIBRARY_ROOTS: fixture.libraryRoot,
      READ_ALOUD_WORK_ROOT: workRoot,
      READ_ALOUD_CTC_DEVICE: process.env.READ_ALOUD_CTC_DEVICE ?? "auto",
      ...(process.env.READ_ALOUD_SMOKE_FRESH_MODEL === "1" ? { HOME: join(root, "home"), XDG_DATA_HOME: join(root, "home", "share") } : {}),
    });
    const healthGaps = watchHealth(worker.base);
    try {
      const jobId = randomUUID();
      const workDir = join(workRoot, jobId);
      const durationSeconds = fixture.audioPaths.reduce((sum, path) => sum + probeDuration(path), 0);
      const request = {
        jobId,
        epubPath: fixture.epubPath,
        audioPaths: fixture.audioPaths,
        workDir,
        language: "en",
        granularity: "sentence",
        model: "quartznet15x5",
        sourceBytes: [fixture.epubPath, ...fixture.audioPaths].reduce((sum, path) => sum + statSync(path).size, 0),
        audioDurationSeconds: durationSeconds,
        maxOutputBytes: 1024 ** 3,
        decisions: { chapters: {}, audio: [] },
        resumeFrom: null,
      };

      const startedAt = Date.now();
      const first = await runJob(worker.base, request);
      const wallMs = Date.now() - startedAt;
      assert.equal(first.status, "completed", JSON.stringify(first.events.slice(-5)));

      const opf = execFileSync("unzip", ["-p", join(workDir, "output.epub"), "OEBPS/content.opf"], { encoding: "utf8" });
      assert.match(opf, /media-overlay="/);
      assert.match(opf, /application\/smil\+xml/);
      const entries = execFileSync("unzip", ["-l", join(workDir, "output.epub")], { encoding: "utf8" });
      assert.match(entries, /\.smil/);

      const report = JSON.parse(readFileSync(join(workDir, "report.json"), "utf8"));
      assert.equal(report.totals.tracks, fixture.audioPaths.length);
      assert.equal(report.totals.unalignedTracks, 0);
      assert.ok(report.totals.sentences >= 20, `sentences ${report.totals.sentences}`);
      assert.ok(report.totals.matchedSeconds / report.totals.seconds >= 0.7, JSON.stringify(report.totals));
      assert.equal(report.spine.filter((item) => item.status === "aligned").length, 3, "every chapter aligned");

      const codes = first.events.map((event) => event.code);
      assert.ok(codes.includes("audio_reencoded_cbr"), "the VBR chapter was re-encoded");
      const processed = readdirSync(join(workDir, "processed-audio")).filter((name) => name.startsWith("00002-") && name.endsWith(".mp3"));
      assert.equal(processed.length, 1);
      assert.ok(packetSizes(fixture.audioPaths[1]) > 2, "the source is VBR");
      assert.ok(packetSizes(join(workDir, "processed-audio", processed[0])) <= 2, "the processed file is CBR");

      const emissionsBytes = readdirSync(join(workDir, "emissions"))
        .filter((name) => name.endsWith(".emissions"))
        .reduce((sum, name) => sum + statSync(join(workDir, "emissions", name)).size, 0);
      const stageMs = Object.fromEntries(
        first.events.filter((event) => event.code === "stage_finished").map((event) => [event.stage, event.data.durationMs]),
      );

      const second = await runJob(worker.base, request);
      assert.equal(second.status, "completed");
      const fresh = second.events.filter((event) => event.seq > first.events.at(-1).seq);
      assert.deepEqual(
        fresh.filter((event) => event.code === "stage_skipped").map((event) => event.stage),
        ["preparing_audio", "generating_emissions", "marking_up_ebook", "aligning"],
      );

      const resync = await runJob(worker.base, { ...request, decisions: { chapters: { "chapter-3.xhtml": "excluded" }, audio: [] } });
      assert.equal(resync.status, "completed");
      const resyncRan = resync.events
        .filter((event) => event.seq > second.events.at(-1).seq && event.code === "stage_finished")
        .map((event) => event.stage);
      assert.deepEqual(resyncRan, ["aligning", "validating"]);
      const resyncReport = JSON.parse(readFileSync(join(workDir, "report.json"), "utf8"));
      assert.equal(resyncReport.spine.find((item) => item.href.endsWith("chapter-3.xhtml"))?.status, "excluded");

      const summary = {
        device: (await health(worker.base)).device,
        audioSeconds: Math.round(durationSeconds * 10) / 10,
        wallMs,
        stageMs,
        emissionsBytes,
        emissionsBytesPerSecond: Math.round(emissionsBytes / durationSeconds),
        outputBytes: first.outputBytes,
        modelDownload: first.events.find((event) => event.code === "model_download_finished")?.data ?? null,
        totals: report.totals,
        longestHealthResponseMs: healthGaps.longestResponseMs,
        longestHealthGapMs: healthGaps.longestGapMs,
      };
      process.stdout.write(`READ_ALOUD_SMOKE_SUMMARY ${JSON.stringify(summary)}\n`);
      if (process.env.READ_ALOUD_SMOKE_REPORT) writeFileSync(process.env.READ_ALOUD_SMOKE_REPORT, JSON.stringify(summary, null, 2));
    } finally {
      healthGaps.stop();
      await worker.stop();
      if (process.env.READ_ALOUD_SMOKE_KEEP === "1") process.stdout.write(`READ_ALOUD_SMOKE_KEPT ${root}\n`);
      else rmSync(root, { recursive: true, force: true });
    }
  },
);

async function startMainProcess(env) {
  const child = spawn(process.execPath, [new URL("../dist/main.js", import.meta.url).pathname], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise((resolve, reject) => {
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      buffer += text;
      const match = /\[read_aloud\.worker\.boot\] \[end\] .*port=(\d+)/.exec(buffer);
      if (match) resolve(Number(match[1]));
    });
    child.once("exit", (code) => reject(new Error(`worker exited with ${code}`)));
  });
  return {
    base: `http://127.0.0.1:${port}`,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

async function call(base, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function health(base) {
  return (await call(base, "GET", "/health")).body;
}

async function runJob(base, request) {
  const created = await call(base, "POST", "/v1/jobs", request);
  assert.equal(created.status, 202, JSON.stringify(created.body));
  for (;;) {
    const { body } = await call(base, "GET", `/v1/jobs/${request.jobId}`);
    if (["completed", "failed", "cancelled"].includes(body.status)) return body;
    await sleep(250);
  }
}

/** Polls /health every 100 ms during the run and records the slowest answer and the longest silence. */
function watchHealth(base) {
  const state = { longestResponseMs: 0, longestGapMs: 0, running: true };
  let lastOk = Date.now();
  let warmedUp = false;
  void (async () => {
    while (state.running) {
      const sentAt = Date.now();
      try {
        await health(base);
        const now = Date.now();
        // The first request includes the client's own connection setup, so it is not counted.
        if (warmedUp) {
          state.longestResponseMs = Math.max(state.longestResponseMs, now - sentAt);
          state.longestGapMs = Math.max(state.longestGapMs, now - lastOk);
        }
        warmedUp = true;
        lastOk = now;
      } catch {
        // A refused request counts toward the gap.
      }
      await sleep(100);
    }
  })();
  return {
    get longestResponseMs() {
      return state.longestResponseMs;
    },
    get longestGapMs() {
      return state.longestGapMs;
    },
    stop() {
      state.running = false;
    },
  };
}

function probeDuration(path) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" }).trim());
}

/** Distinct MP3 packet sizes: CBR frames differ only by the padding byte, VBR frames vary widely. */
function packetSizes(path) {
  const output = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "packet=size", "-of", "csv=p=0", path], {
    encoding: "utf8",
  });
  return new Set(output.split("\n").filter(Boolean).slice(1, -1)).size;
}
