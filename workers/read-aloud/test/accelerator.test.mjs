import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PROBE_MODEL_PATH, needsDeviceProbe, probeDevice, resolveCtcDevice } from "../dist/accelerator.js";

test("auto selects MLX on Apple Silicon", () => {
  assert.equal(resolveCtcDevice("auto", runtime("darwin", "arm64")), "mlx");
});

test("auto selects CPU everywhere else, including Linux x64 with a GPU", () => {
  assert.equal(resolveCtcDevice("auto", runtime("linux", "x64")), "cpu");
  assert.equal(resolveCtcDevice("auto", runtime("linux", "arm64")), "cpu");
  assert.equal(resolveCtcDevice("auto", runtime("darwin", "x64")), "cpu");
  assert.equal(resolveCtcDevice("auto", runtime("win32", "x64")), "cpu");
});

test("explicit devices are honoured where they can run", () => {
  assert.equal(resolveCtcDevice("cuda", runtime("linux", "x64")), "cuda");
  assert.equal(resolveCtcDevice("webgpu", runtime("win32", "x64")), "webgpu");
  assert.equal(resolveCtcDevice("cpu", runtime("darwin", "arm64")), "cpu");
});

test("explicit devices fail fast on incompatible hosts", () => {
  assert.throws(() => resolveCtcDevice("mlx", runtime("linux", "arm64")), /native macOS on Apple Silicon/);
  assert.throws(() => resolveCtcDevice("cuda", runtime("linux", "arm64")), /Linux x64/);
  assert.throws(() => resolveCtcDevice("cuda", runtime("darwin", "arm64")), /Linux x64/);
  assert.throws(() => resolveCtcDevice("webgpu", runtime("linux", "arm64")), /not available/);
});

test("CUDA and WebGPU are probed at startup", () => {
  assert.equal(needsDeviceProbe("cuda"), true);
  assert.equal(needsDeviceProbe("webgpu"), true);
  assert.equal(needsDeviceProbe("cpu"), false);
  assert.equal(needsDeviceProbe("mlx"), false);
});

test("the bundled probe model is a tiny identity graph that runs on CPU", async () => {
  assert.ok(statSync(PROBE_MODEL_PATH).size < 1024);
  await probeDevice("cpu");
});

test("a probe for a provider that cannot load fails with a clear message", async () => {
  if (process.platform === "linux" && process.arch === "x64" && process.env.READ_ALOUD_TEST_HAS_CUDA === "1") return;
  await assert.rejects(probeDevice("cuda"), /READ_ALOUD_CTC_DEVICE=cuda could not start .*CUDA 12 and cuDNN 9.*use READ_ALOUD_CTC_DEVICE=cpu/);
});

test("a failed WebGPU probe stops startup and points at the CPU", async () => {
  await assert.rejects(
    probeDevice("webgpu", { modelPath: join(tmpdir(), `read-aloud-missing-${process.pid}.onnx`) }),
    /READ_ALOUD_CTC_DEVICE=webgpu could not start .*the Docker image has none; use READ_ALOUD_CTC_DEVICE=cpu/,
  );
  // On a host without a GPU adapter, such as the Docker image or a GPU-less CI runner, the real probe fails the same way.
  const real = await probeDevice("webgpu").then(
    () => null,
    (error) => error,
  );
  if (real) assert.match(real.message, /READ_ALOUD_CTC_DEVICE=webgpu could not start/);
});

function runtime(platform, architecture) {
  return { platform, architecture };
}
