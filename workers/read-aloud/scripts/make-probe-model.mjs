// Writes assets/cuda-probe.onnx: an ONNX model with one Identity node, float32 input "x" of shape [1]
// and output "y". The accelerator probe opens it with a GPU execution provider and runs it once.
// The protobuf is encoded by hand so the worker needs no ONNX tooling to rebuild it.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VARINT = 0;
const LENGTH_DELIMITED = 2;
const FLOAT = 1;

function varint(value) {
  const bytes = [];
  let remaining = BigInt(value);
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function key(field, wireType) {
  return varint((field << 3) | wireType);
}

function intField(field, value) {
  return Buffer.concat([key(field, VARINT), varint(value)]);
}

function bytesField(field, value) {
  const payload = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return Buffer.concat([key(field, LENGTH_DELIMITED), varint(payload.length), payload]);
}

function message(...fields) {
  return Buffer.concat(fields);
}

// TypeProto { tensor_type: TypeProto.Tensor { elem_type: FLOAT, shape: { dim: [{ dim_value: 1 }] } } }
const dimension = message(intField(1, 1));
const shape = message(bytesField(1, dimension));
const tensorType = message(intField(1, FLOAT), bytesField(2, shape));
const type = message(bytesField(1, tensorType));

const valueInfo = (name) => message(bytesField(1, name), bytesField(2, type));

// NodeProto { input: "x", output: "y", name: "identity", op_type: "Identity" }
const node = message(bytesField(1, "x"), bytesField(2, "y"), bytesField(3, "identity"), bytesField(4, "Identity"));

// GraphProto { node, name, input (11), output (12) }
const graph = message(bytesField(1, node), bytesField(2, "probe"), bytesField(11, valueInfo("x")), bytesField(12, valueInfo("y")));

// OperatorSetIdProto { domain: "", version: 13 }
const opset = message(bytesField(1, ""), intField(2, 13));

// ModelProto { ir_version: 7, producer_name: "bookorbit", graph (7), opset_import (8) }
const model = message(intField(1, 7), bytesField(2, "bookorbit"), bytesField(7, graph), bytesField(8, opset));

const target = fileURLToPath(new URL("../assets/cuda-probe.onnx", import.meta.url));
writeFileSync(target, model);
process.stdout.write(`wrote ${model.length} bytes\n`);
