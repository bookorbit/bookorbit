// A stand-in for the STAlign pipeline, loaded by the runner through READ_ALOUD_RUNNER_PIPELINE.
// It writes small placeholder outputs and records every stage it runs, so the tests exercise the
// runner's real caching, progress, cancel and failure handling without the model.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const mode = process.env.FAKE_PIPELINE_MODE ?? "ok";
const logPath = process.env.FAKE_PIPELINE_LOG;
const modelDir = process.env.FAKE_MODEL_DIR;
const stepMs = Number(process.env.FAKE_PIPELINE_STEP_MS ?? 20);

function record(stage, context) {
  if (!logPath) return;
  appendFileSync(
    logPath,
    `${JSON.stringify({
      jobId: context.job.jobId,
      stage,
      tmpdir: process.env.TMPDIR ?? null,
      scratch: process.env.STORYTELLER_SCRATCH_DIR ?? null,
      decisions: context.job.decisions,
    })}\n`,
  );
}

async function steps(context, total, unit) {
  for (let index = 0; index <= total; index += 1) {
    context.signal.throwIfAborted();
    context.progress(index / total, { current: index, total, unit });
    await sleep(stepMs);
  }
}

export const pipeline = {
  async modelInstalled() {
    return !modelDir || existsSync(join(modelDir, "installed"));
  },

  async prepareAudio(context) {
    record("preparing_audio", context);
    mkdirSync(context.paths.processedAudioDir, { recursive: true });
    for (const [index] of context.job.audio.entries()) {
      writeFileSync(join(context.paths.processedAudioDir, `${String(index + 1).padStart(5, "0")}-00001.mp3`), "audio");
    }
    await steps(context, context.job.audio.length, "file");
    return { data: { files: context.job.audio.length } };
  },

  async downloadModel(context) {
    record("downloading_model", context);
    context.event("info", "model_download_started", "Downloading the fake model", { variant: "fake" });
    await sleep(stepMs);
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, "installed"), "yes");
    context.event("info", "model_download_finished", "Downloaded the fake model", { variant: "fake", bytes: 3 });
  },

  async generateEmissions(context) {
    record("generating_emissions", context);
    if (mode === "crash") process.exit(7);
    if (mode === "hang") {
      await new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      });
    }
    if (mode === "orphan-child") {
      // Like STAlign aborting an ffmpeg pipeline: the shell stops, the process it started does not.
      const child = spawn("sleep", ["60"], { stdio: "ignore" });
      child.unref();
      writeFileSync(join(context.paths.workDir, "orphan.pid"), String(child.pid));
      await new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      });
    }
    if (mode === "ignore-cancel") {
      setInterval(() => {}, 1_000);
      await new Promise(() => {});
    }
    mkdirSync(context.paths.emissionsDir, { recursive: true });
    writeFileSync(join(context.paths.emissionsDir, "00001-00001.emissions"), "emissions");
    await steps(context, context.job.audio.length, "track");
    if (mode === "slow") await sleep(1_500);
    return { data: { tracks: context.job.audio.length, cached: 0 } };
  },

  async markupEbook(context) {
    record("marking_up_ebook", context);
    if (mode === "fail-markup") throw new Error(`markup broke while reading ${context.paths.upgradedEpubPath}`);
    writeFileSync(context.paths.markedEpubPath, "marked");
    await steps(context, 3, "chapter");
  },

  async align(context) {
    record("aligning", context);
    await steps(context, 3, "chapter");
    if (mode === "block-align") {
      // STAlign's Viterbi pass is a synchronous loop; this stands in for it.
      const until = Date.now() + 2_000;
      while (Date.now() < until);
    }
    writeFileSync(context.paths.outputPath, mode === "empty-output" ? "" : "output-epub-bytes");
    writeFileSync(
      context.paths.reportPath,
      JSON.stringify({
        version: 4,
        totals: {
          sentences: 10,
          matchedSentences: 9,
          interpolatedSentences: 1,
          unmatchedSentences: 0,
          droppedSentences: 0,
          seconds: 60,
          matchedSeconds: 58,
          interpolatedSeconds: 1,
          looseSeconds: 1,
          spine: {},
          tracks: context.job.audio.length,
          unalignedTracks: 0,
        },
      }),
    );
    return { data: { chapters: 3 } };
  },
};
