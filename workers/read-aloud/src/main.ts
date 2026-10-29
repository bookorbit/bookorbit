import { needsDeviceProbe, probeDevice, resolveCtcDevice, type DeviceCheck } from "./accelerator.js";
import { loadConfig, workerVersion } from "./config.js";
import { errorClass, errorMessage, logLine } from "./log.js";
import { prepareDataFolders, startWorker } from "./server.js";
import { checkFfmpeg } from "./toolchain.js";

// The control process: HTTP, auth, the job slot and runner lifecycle. Pipeline code (STAlign) only
// ever loads in the forked runner, so this process keeps answering while a job runs.
const startedAt = Date.now();
const version = workerVersion(process.env);
logLine("read_aloud.worker.boot", "start", { version, pid: process.pid }, "worker starting");

try {
  const config = loadConfig(process.env);
  const device = resolveCtcDevice(config.configuredDevice);
  let deviceCheck: DeviceCheck = "not_checked";
  if (needsDeviceProbe(device)) {
    await probeDevice(device);
    deviceCheck = "ok";
  }
  await checkFfmpeg();
  await prepareDataFolders(config);
  const worker = await startWorker({ config, configuredDevice: config.configuredDevice, device, deviceCheck, version });
  // Logs every folder that is not readable yet; each is checked again on later health checks and jobs.
  const readableRoots = await worker.registry.libraryRoots();
  logLine(
    "read_aloud.worker.boot",
    "end",
    {
      host: config.host,
      port: worker.port,
      device,
      configuredDevice: config.configuredDevice,
      deviceCheck,
      libraryRoots: readableRoots.length,
      configuredLibraryRoots: config.libraryRoots.length,
      durationMs: Date.now() - startedAt,
    },
    "worker ready",
  );

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      const stopStartedAt = Date.now();
      logLine("read_aloud.worker.shutdown", "start", { signal, activeJobId: worker.registry.active ?? "none" }, "worker stopping");
      void worker.close().then(() => {
        logLine("read_aloud.worker.shutdown", "end", { durationMs: Date.now() - stopStartedAt }, "worker stopped");
        process.exit(0);
      });
    });
  }
} catch (error) {
  logLine(
    "read_aloud.worker.boot",
    "fail",
    { durationMs: Date.now() - startedAt, errorClass: errorClass(error), error: errorMessage(error) },
    "worker failed to start",
  );
  process.exit(1);
}
