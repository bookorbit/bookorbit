import { InferenceSession, Tensor } from "onnxruntime-node";

const [device, modelPath] = process.argv.slice(2);
if (!device || !modelPath) {
  process.stderr.write("usage: probe.js <device> <model.onnx>\n");
  process.exit(2);
}

try {
  const session = await InferenceSession.create(modelPath, { executionProviders: [device] });
  const input = new Tensor("float32", Float32Array.from([1.5]), [1]);
  const output = await session.run({ x: input });
  const value = (output["y"]?.data as Float32Array | undefined)?.[0];
  await session.release();
  if (value !== 1.5) throw new Error(`probe model returned ${String(value)} instead of 1.5`);
  process.stdout.write("ok\n");
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`.replace(/\n(?=.)/g, " "));
  process.exit(1);
}
