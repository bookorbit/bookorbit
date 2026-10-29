import { existsSync, readdirSync } from "node:fs";
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ctcAlign, emit, markup, processAudiobook, upgradeEpub } from "@storyteller-platform/align";
import { getModelDir, loadCtcModel, resolveCtcRun, type CtcRun } from "@storyteller-platform/ghost-story";
import type { ReadAloudStageDetail, ReadAloudStageUnit } from "@bookorbit/types";
import { StageError, type Pipeline, type StageContext } from "./pipeline-contract.js";

const ENGINE = "ctc-local";
const MAX_SPLIT_HOURS = 2;
/** Written only after every package file matched the registry and the model loaded. */
const INSTALL_MARKER = ".bookorbit-installed";

type InstallModelPackage = (
  model: CtcRun["package"],
  options: { modelDir?: string; printOutput?: boolean; signal?: AbortSignal | null },
) => Promise<string>;

/** STAlign's own `pipeline --ctc` stages, called with the options Storyteller's server uses. */
export const pipeline: Pipeline = {
  async modelInstalled(context) {
    const run = ctcRun(context);
    return isInstalled(run) && existsSync(join(packageDir(run), INSTALL_MARKER));
  },

  async prepareAudio(context) {
    const total = context.job.audio.length;
    let reencoded = 0;
    const logger = context.createLogger((_level, message) => {
      const match = /^Forcing CBR MP3 for .* at (\S+)$/.exec(message);
      if (!match) return;
      reencoded += 1;
      context.event("info", "audio_reencoded_cbr", "A variable bitrate MP3 was re-encoded to constant bitrate for precise seeking", {
        bitrate: match[1] ?? null,
      });
    });
    // `encoding` stays unset: with a codec STAlign skips its VBR MP3 to CBR re-encode.
    await processAudiobook(context.paths.sourceAudioDir, context.paths.processedAudioDir, {
      maxLength: MAX_SPLIT_HOURS,
      parallelism: 1,
      signal: context.signal,
      logger,
      // STAlign's own fraction runs ahead (a one-range file reports 2), so count finished files instead.
      onProgress: () => {
        const done = Math.min(total, splitFilesDone(context.paths.processedAudioDir));
        context.progress(done / total, { current: done, total, unit: "file" });
      },
    });
    const tracks = await audioTrackCount(context.paths.processedAudioDir);
    return { data: { files: total, tracks, reencoded } };
  },

  async downloadModel(context) {
    const run = ctcRun(context);
    const startedAt = Date.now();
    const marker = join(packageDir(run), INSTALL_MARKER);
    context.event("info", "model_download_started", `Downloading the ${run.variant} model`, { variant: run.variant });
    await rm(marker, { force: true });
    let verified = true;
    try {
      // ghost-story's own install skips a package whose entry file exists, so an interrupted download
      // would count as installed forever. This checks every file against the registry and resumes.
      const install = await loadInstaller();
      await install(run.package, { modelDir: getModelDir(), printOutput: false, signal: context.signal });
    } catch (error) {
      if (context.signal.aborted) throw error;
      // Offline with a model already on disk: use it if it loads, and verify again on the next run.
      if (!isInstalled(run)) throw new StageError("model_download_failed", errorText(error), { cause: error });
      verified = false;
      context.event("warn", "model_unverified", "The speech model could not be checked against the registry; using the copy on disk", {
        variant: run.variant,
      });
    }
    try {
      const loaded = await loadCtcModel(run, { signal: context.signal, printOutput: false });
      await loaded[Symbol.asyncDispose]();
    } catch (error) {
      if (context.signal.aborted) throw error;
      // Every file matched the registry, so a load failure is the device, not the download.
      if (verified) throw new StageError("inference_failed", errorText(error), { cause: error });
      throw new StageError("model_download_failed", errorText(error), { cause: error });
    }
    if (verified) await writeFile(marker, JSON.stringify({ package: run.package.name, version: run.package.version, at: new Date().toISOString() }));
    const bytes = await directoryBytes(packageDir(run));
    const durationMs = Date.now() - startedAt;
    context.event("info", "model_download_finished", `Downloaded the ${run.variant} model`, { variant: run.variant, bytes, durationMs });
    return { data: { variant: run.variant, bytes } };
  },

  async generateEmissions(context) {
    const total = await audioTrackCount(context.paths.processedAudioDir);
    let cached = 0;
    const logger = context.createLogger((_level, message) => {
      if (message.startsWith("Found existing emissions for ")) cached += 1;
    });
    const job = context.job;
    await emit(context.paths.processedAudioDir, context.paths.emissionsDir, {
      engine: ENGINE,
      device: job.device,
      model: job.model,
      dtype: job.dtype,
      batchSize: job.batchSize,
      language: new Intl.Locale(job.language),
      concurrency: 1,
      signal: context.signal,
      logger,
      onProgress: (fraction) => context.progress(fraction, countDetail(fraction, total, "track")),
    });
    if (cached > 0) {
      context.event("info", "emissions_cached", `Reused emissions for ${cached} of ${total} tracks`, { cached, tracks: total });
    }
    return { data: { tracks: total, cached, device: job.device } };
  },

  async markupEbook(context) {
    const locale = new Intl.Locale(context.job.language);
    const logger = context.createLogger();
    await upgradeEpub(context.job.epub.path, context.paths.upgradedEpubPath, { removeNcx: false });
    context.signal.throwIfAborted();
    const chapters = new SpineCounter();
    await markup(context.paths.upgradedEpubPath, context.paths.markedEpubPath, {
      granularity: context.job.granularity,
      primaryLocale: locale,
      logger,
      onProgress: (fraction) => context.progress(fraction, chapters.detail(fraction)),
    });
    return chapters.total ? { data: { chapters: chapters.total } } : undefined;
  },

  async align(context) {
    const job = context.job;
    const chapters = new SpineCounter();
    await ctcAlign(context.paths.markedEpubPath, context.paths.outputPath, context.paths.emissionsDir, context.paths.processedAudioDir, {
      reportsPath: context.paths.reportPath,
      granularity: job.granularity,
      textRef: "id-fragment",
      outFormat: "epub",
      primaryLocale: new Intl.Locale(job.language),
      autoExclude: true,
      decisions: job.decisions,
      signal: context.signal,
      logger: context.createLogger(),
      onProgress: (fraction) => context.progress(fraction, chapters.detail(fraction)),
    });
    return chapters.total ? { data: { chapters: chapters.total } } : undefined;
  },
};

function ctcRun(context: StageContext): CtcRun {
  return resolveCtcRun({
    device: context.job.device,
    model: context.job.model,
    language: new Intl.Locale(context.job.language).language,
    dtype: context.job.dtype,
    batchSize: context.job.batchSize,
  });
}

function packageDir(run: CtcRun): string {
  return join(getModelDir(), run.package.subdir);
}

/** ghost-story's own installed check: the package's entry file exists in the model folder. */
function isInstalled(run: CtcRun): boolean {
  return existsSync(join(packageDir(run), run.package.entryFile));
}

/**
 * ghost-story keeps its verifying installer out of the package exports. The pinned, patched version
 * ships it beside the entry point; a release that moves it fails the download stage loudly.
 */
async function loadInstaller(): Promise<InstallModelPackage> {
  const entry = fileURLToPath(import.meta.resolve("@storyteller-platform/ghost-story"));
  const module = (await import(pathToFileURL(join(dirname(entry), "cli", "ctc-install.js")).href)) as { installModelPackage?: unknown };
  if (typeof module.installModelPackage !== "function") throw new Error("ghost-story no longer provides installModelPackage");
  return module.installModelPackage as InstallModelPackage;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function countDetail(fraction: number, total: number, unit: ReadAloudStageUnit): ReadAloudStageDetail | null {
  if (total <= 0) return null;
  return { current: Math.min(total, Math.max(0, Math.floor(fraction * total))), total, unit };
}

/**
 * markup and ctcAlign report `index / spine.length` before each spine item, so the first non-zero
 * value is exactly `1 / spine.length`.
 */
class SpineCounter {
  total = 0;

  detail(fraction: number): ReadAloudStageDetail | null {
    if (!this.total && fraction > 0) this.total = Math.round(1 / fraction);
    if (!this.total) return null;
    return { current: Math.min(this.total, Math.round(fraction * this.total)), total: this.total, unit: "chapter" };
  }
}

/** Source files with at least one finished range: each range leaves a `<file>-<range>.source.json` sidecar. */
function splitFilesDone(directory: string): number {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return 0;
  }
  return new Set(names.filter((name) => name.endsWith(".source.json")).map((name) => name.split("-")[0])).size;
}

async function audioTrackCount(directory: string): Promise<number> {
  const names = await readdir(directory).catch(() => [] as string[]);
  return names.filter((name) => !name.startsWith(".") && !name.endsWith(".json")).length;
}

async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    total += await stat(join(entry.parentPath, entry.name)).then(
      (info) => info.size,
      () => 0,
    );
  }
  return total;
}
