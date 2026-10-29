import { timingSafeEqual } from "node:crypto";
import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { READ_ALOUD_WORKER_PROTOCOL, type ReadAloudErrorCode, type ReadAloudWorkerError, type ReadAloudWorkerHealth } from "@bookorbit/types";
import type { ConfiguredCtcDevice, DeviceCheck, ResolvedCtcDevice } from "./accelerator.js";
import { workerTmpDir, type WorkerConfig } from "./config.js";
import { JobRegistry, freeBytes, type RegistryOptions } from "./jobs.js";
import { errorClass, errorMessage, logLine } from "./log.js";
import { RequestError, within } from "./paths.js";
import { isJobId, validateRequest } from "./validation.js";

/** Room for the largest job: every audio path at a generous length, plus chapter decisions. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const JOB_PATH = /^\/v1\/jobs\/([^/]+)$/;

export type WorkerOptions = Omit<RegistryOptions, "config"> & {
  config: WorkerConfig;
  configuredDevice: ConfiguredCtcDevice;
  device: ResolvedCtcDevice;
  deviceCheck: DeviceCheck;
  version: string;
};

export type RunningWorker = {
  server: Server;
  registry: JobRegistry;
  port: number;
  close(): Promise<void>;
};

export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const registry = new JobRegistry(options);
  const server = createServer((request, response) => {
    handle(request, response, options, registry).catch((error: unknown) => {
      logLine("read_aloud.worker.http", "fail", { errorClass: errorClass(error), error: errorMessage(error) }, "request failed");
      if (!response.headersSent) sendError(response, 500, "unknown", "Internal worker error");
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.config.port, options.config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    registry,
    port,
    async close() {
      await registry.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

async function handle(request: IncomingMessage, response: ServerResponse, options: WorkerOptions, registry: JobRegistry): Promise<void> {
  if (!authorized(request, options.config.token)) {
    request.resume();
    return sendError(response, 401, "worker_unavailable", "Unauthorized");
  }
  const url = new URL(request.url ?? "/", "http://worker.local");

  if (url.pathname === "/health" && request.method === "GET") {
    const health: ReadAloudWorkerHealth = {
      status: "ok",
      version: options.version,
      protocol: READ_ALOUD_WORKER_PROTOCOL,
      activeJobId: registry.active,
      activeJobs: registry.active ? 1 : 0,
      capacity: 1,
      device: options.device,
      configuredDevice: options.configuredDevice,
      deviceCheck: options.deviceCheck,
      libraryRoots: await registry.libraryRoots(),
      workRoot: options.config.workRoot,
      freeBytes: await (options.freeBytes ?? freeBytes)(options.config.workRoot),
      platform: process.platform,
      architecture: process.arch,
    };
    return sendJson(response, 200, health);
  }

  if (url.pathname === "/v1/jobs" && request.method === "POST") {
    try {
      const body = validateRequest(await readJson(request));
      const result = await registry.submit(body);
      return sendJson(response, result.status, result.job);
    } catch (error) {
      if (error instanceof RequestError) return sendError(response, error.status, error.code, error.message);
      throw error;
    }
  }

  const match = JOB_PATH.exec(url.pathname);
  if (match && (request.method === "GET" || request.method === "DELETE")) {
    const jobId = decodePathSegment(match[1]!);
    if (jobId === null || !isJobId(jobId)) return sendError(response, 404, "worker_unavailable", "Job not found");
    const job = request.method === "GET" ? registry.get(jobId, afterSeq(url)) : registry.cancel(jobId);
    return job ? sendJson(response, 200, job) : sendError(response, 404, "worker_unavailable", "Job not found");
  }

  request.resume();
  return sendError(response, 404, "worker_incompatible", "Not found");
}

/** Bad percent-encoding cannot name a job, so it is a 404 like any other unknown id rather than a 500. */
function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function afterSeq(url: URL): number {
  const value = Number(url.searchParams.get("afterSeq") ?? 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new RequestError(400, "worker_incompatible", "Request body is too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "worker_incompatible", "Request body is not valid JSON");
  }
}

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? "";
  const provided = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function sendError(response: ServerResponse, status: number, errorCode: ReadAloudErrorCode, error: string): void {
  const body: ReadAloudWorkerError = { error, errorCode };
  sendJson(response, status, body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

/**
 * Creates the job and temp folders and empties the worker's own temp subfolder, which only ever
 * holds scratch left by a killed run. Only that subfolder is emptied, so a shared folder such as
 * `/tmp` keeps everything else in it. Paths are compared as written and with symlinks resolved, so
 * a temp folder that is a link to the data folder is refused too.
 */
export async function prepareDataFolders(config: WorkerConfig): Promise<void> {
  const tmpDir = config.tmpDir;
  if (dirname(tmpDir) === tmpDir) throw new Error("READ_ALOUD_TMP_DIR must not be a filesystem root");
  await mkdir(config.workRoot, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  const spellings = async (path: string) => [...new Set([resolve(path), await realpath(path).catch(() => resolve(path))])];
  const temps = await spellings(tmpDir);
  const guarded = (await Promise.all([config.workRoot, ...config.libraryRoots, homedir()].filter(Boolean).map(spellings))).flat();
  if (temps.some((temp) => guarded.some((path) => within(path, temp)))) {
    throw new Error("READ_ALOUD_TMP_DIR must not be, or contain, the job folder, a library folder or the home folder");
  }
  const libraries = (await Promise.all(config.libraryRoots.map(spellings))).flat();
  if (temps.some((temp) => libraries.some((root) => within(temp, root)))) throw new Error("READ_ALOUD_TMP_DIR must not be inside a library folder");
  const scratch = workerTmpDir(config);
  await mkdir(scratch, { recursive: true });
  for (const entry of await readdir(scratch)) await rm(join(scratch, entry), { recursive: true, force: true });
}
