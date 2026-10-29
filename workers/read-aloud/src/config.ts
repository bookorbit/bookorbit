import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CTC_DEVICES, type ConfiguredCtcDevice } from "./accelerator.js";

export type WorkerConfig = {
  host: string;
  port: number;
  token: string;
  libraryRoots: string[];
  workRoot: string;
  tmpDir: string;
  configuredDevice: ConfiguredCtcDevice;
  dtype: "fp32" | "fp16" | null;
  batchSize: number | null;
};

type Env = Record<string, string | undefined>;

/** The worker's own folder inside READ_ALOUD_TMP_DIR: runners write their scratch there, and it is the only thing emptied at startup. */
export const WORKER_TMP_SUBDIR = "read-aloud-worker";

export function workerTmpDir(config: Pick<WorkerConfig, "tmpDir">): string {
  return join(config.tmpDir, WORKER_TMP_SUBDIR);
}

/** The release the image was built from (its APP_VERSION build argument), else the package version for a native build. */
export function workerVersion(env: Env): string {
  const baked = env.APP_VERSION?.trim();
  if (baked) return baked;
  return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
}

export function loadConfig(env: Env): WorkerConfig {
  const token = env.READ_ALOUD_WORKER_TOKEN?.trim() ?? "";
  if (token.length < 16) throw new Error("READ_ALOUD_WORKER_TOKEN must contain at least 16 characters");
  const workRoot = absolutePath(env.READ_ALOUD_WORK_ROOT, "/data/read-aloud/jobs", "READ_ALOUD_WORK_ROOT");
  return {
    host: env.READ_ALOUD_WORKER_HOST?.trim() || "127.0.0.1",
    port: port(env.PORT, 8787),
    token,
    libraryRoots: parseLibraryRoots(env),
    workRoot,
    tmpDir: absolutePath(env.READ_ALOUD_TMP_DIR, resolve(dirname(workRoot), "tmp"), "READ_ALOUD_TMP_DIR"),
    configuredDevice: readEnum(env.READ_ALOUD_CTC_DEVICE, CTC_DEVICES, "auto", "READ_ALOUD_CTC_DEVICE"),
    dtype: readOptionalEnum(env.READ_ALOUD_CTC_DTYPE, ["fp32", "fp16"] as const, "READ_ALOUD_CTC_DTYPE"),
    batchSize: optionalBatchSize(env.READ_ALOUD_CTC_BATCH_SIZE),
  };
}

/** READ_ALOUD_LIBRARY_ROOTS (comma-separated), else READ_ALOUD_LIBRARY_ROOT (one folder), else /books. */
export function parseLibraryRoots(env: Env): string[] {
  const list = env.READ_ALOUD_LIBRARY_ROOTS?.trim();
  const raw = list ? list.split(",") : [env.READ_ALOUD_LIBRARY_ROOT?.trim() || "/books"];
  const roots: string[] = [];
  for (const entry of raw) {
    const value = entry.trim();
    if (!value) continue;
    if (!isAbsolute(value)) throw new Error(`Library roots must be absolute paths, got "${value}"`);
    const normalized = resolve(value);
    if (!roots.includes(normalized)) roots.push(normalized);
  }
  if (roots.length === 0) throw new Error("READ_ALOUD_LIBRARY_ROOTS must list at least one absolute path");
  return roots;
}

function absolutePath(value: string | undefined, fallback: string, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return resolve(fallback);
  if (!isAbsolute(trimmed)) throw new Error(`${name} must be an absolute path`);
  return resolve(trimmed);
}

function port(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65535) throw new Error("PORT must be an integer from 0 to 65535");
  return parsed;
}

function readEnum<const T extends readonly string[]>(value: string | undefined, choices: T, fallback: T[number], name: string): T[number] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (choices.includes(normalized)) return normalized as T[number];
  throw new Error(`${name} must be one of: ${choices.join(", ")}`);
}

function readOptionalEnum<const T extends readonly string[]>(value: string | undefined, choices: T, name: string): T[number] | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") return null;
  if (choices.includes(normalized)) return normalized as T[number];
  throw new Error(`${name} must be one of: auto, ${choices.join(", ")}`);
}

function optionalBatchSize(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "auto") return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 64) {
    throw new Error("READ_ALOUD_CTC_BATCH_SIZE must be an integer from 1 to 64");
  }
  return parsed;
}
