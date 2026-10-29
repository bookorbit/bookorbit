import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ReadAloudWorkerDevice, ReadAloudWorkerHealth } from "@bookorbit/types";

export type ConfiguredCtcDevice = ReadAloudWorkerDevice;
export type ResolvedCtcDevice = Exclude<ReadAloudWorkerDevice, "auto">;
export type DeviceCheck = ReadAloudWorkerHealth["deviceCheck"];

export const CTC_DEVICES = ["auto", "cpu", "cuda", "webgpu", "mlx"] as const satisfies readonly ReadAloudWorkerDevice[];

type Runtime = {
  platform: NodeJS.Platform;
  architecture: string;
};

/**
 * `auto` never picks CUDA: the image ships no CUDA libraries, and a missing provider fails the job
 * instead of falling back. CUDA is only for native Linux installs that ask for it explicitly.
 */
export function resolveCtcDevice(configured: ConfiguredCtcDevice, runtime: Runtime = currentRuntime()): ResolvedCtcDevice {
  const appleSilicon = runtime.platform === "darwin" && runtime.architecture === "arm64";
  if (configured === "auto") return appleSilicon ? "mlx" : "cpu";
  if (configured === "mlx" && !appleSilicon) {
    throw new Error("READ_ALOUD_CTC_DEVICE=mlx requires native macOS on Apple Silicon");
  }
  if (configured === "cuda" && (runtime.platform !== "linux" || runtime.architecture !== "x64")) {
    throw new Error("READ_ALOUD_CTC_DEVICE=cuda requires native Linux x64 with CUDA 12 and cuDNN 9");
  }
  if (configured === "webgpu" && runtime.platform === "linux" && runtime.architecture === "arm64") {
    throw new Error("READ_ALOUD_CTC_DEVICE=webgpu is not available on Linux arm64");
  }
  return configured;
}

/**
 * GPU devices are probed because a missing runtime does not fail until inference, hours into a job. In the Docker image
 * neither probe can pass (no CUDA libraries, no Vulkan driver for WebGPU), which keeps it on the CPU as documented.
 */
export function needsDeviceProbe(device: ResolvedCtcDevice): boolean {
  return device === "cuda" || device === "webgpu";
}

export const PROBE_MODEL_PATH = fileURLToPath(new URL("../assets/cuda-probe.onnx", import.meta.url));
const PROBE_SCRIPT_PATH = fileURLToPath(new URL("./probe.js", import.meta.url));

const PROBE_HINTS: Partial<Record<ResolvedCtcDevice, string>> = {
  cuda: "CUDA needs native Linux x64 with CUDA 12 and cuDNN 9 installed and onnxruntime-node's CUDA provider",
  webgpu: "WebGPU needs a native worker with a GPU ONNX Runtime can reach; the Docker image has none",
};

/**
 * Opens a tiny identity model with the device's execution provider in a short-lived child process, so
 * a missing GPU runtime fails startup with a clear message instead of failing the first job hours in.
 */
export function probeDevice(device: ResolvedCtcDevice, options: { timeoutMs?: number; modelPath?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [PROBE_SCRIPT_PATH, device, options.modelPath ?? PROBE_MODEL_PATH],
      { timeout: options.timeoutMs ?? 120_000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) return resolve();
        const detail = stderr.trim().split("\n").filter(Boolean).at(-1) ?? error.message;
        const hint = PROBE_HINTS[device];
        reject(
          new Error(
            `READ_ALOUD_CTC_DEVICE=${device} could not start ONNX Runtime's ${device} provider (${detail.slice(0, 400)}). ` +
              `${hint ? `${hint}; ` : ""}use READ_ALOUD_CTC_DEVICE=cpu otherwise.`,
          ),
        );
      },
    );
  });
}

function currentRuntime(): Runtime {
  return { platform: process.platform, architecture: process.arch };
}
