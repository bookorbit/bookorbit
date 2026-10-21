import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const distUrl = new URL("../../client/dist/", import.meta.url);

test("production service worker precaches the PDFium binary referenced by the reader", async () => {
  const assetsUrl = new URL("assets/", distUrl);
  const assets = await readdir(assetsUrl);
  const scripts = await Promise.all(assets.filter((name) => name.endsWith(".js")).map((name) => readFile(new URL(name, assetsUrl), "utf8")));
  const wasmPaths = new Set(scripts.flatMap((script) => [...script.matchAll(/\/assets\/pdfium-[\w-]+\.wasm/g)].map(([path]) => path)));
  assert.equal(wasmPaths.size, 1, "the reader must reference one PDFium binary");

  const [wasmPath] = wasmPaths;
  const binary = await readFile(new URL(wasmPath.slice(1), distUrl));
  assert.ok(WebAssembly.validate(binary), "the emitted PDF engine must be valid WebAssembly");

  const serviceWorker = await readFile(new URL("sw.js", distUrl), "utf8");
  const precacheUrls = new Set([...serviceWorker.matchAll(/\burl:\s*["']([^"']+)["']/g)].map(([, url]) => url));
  assert.ok(
    precacheUrls.has(wasmPath.slice(1)),
    "PDFium must remain available from the service worker cache when a deployment removes its original URL",
  );
});
