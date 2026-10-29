import assert from "node:assert/strict";
import test from "node:test";
import { estimateReadAloudWorkBytes } from "@bookorbit/types";
import {
  DISK_MARGIN_BYTES,
  EMISSION_BYTES_PER_SECOND,
  ASSUMED_AUDIO_BYTES_PER_SECOND,
  fingerprint,
  normalizedWeights,
  planStages,
  requiredDiskBytes,
  stageInputs,
} from "../dist/stages.js";

const GB = 1024 ** 3;
const ALL_VALID = { preparing_audio: "valid", generating_emissions: "valid", marking_up_ebook: "valid", aligning: "valid" };

function source(overrides = {}) {
  return {
    epub: { path: "/books/a/book.epub", size: 1000, mtimeMs: 1 },
    audio: [{ path: "/books/a/01.mp3", size: 5000, mtimeMs: 2 }],
    language: "en",
    granularity: "sentence",
    model: "quartznet15x5",
    decisions: { chapters: {}, audio: [] },
    ...overrides,
  };
}

test("disk rule: 4 x audio + 7 x EPUB + emissions + 512 MB for a fresh run", () => {
  const { required } = requiredDiskBytes({ audioBytes: 2 * GB, epubBytes: 10_000_000, audioDurationSeconds: 36_000, skipped: new Set() });
  assert.equal(required, 4 * 2 * GB + 7 * 10_000_000 + 36_000 * EMISSION_BYTES_PER_SECOND + DISK_MARGIN_BYTES);
});

test("disk rule: the server's estimate for a fresh run matches the worker's", () => {
  const input = { audioBytes: 2 * GB, epubBytes: 10_000_000, audioDurationSeconds: 36_000 };
  assert.equal(estimateReadAloudWorkBytes(input), requiredDiskBytes({ ...input, skipped: new Set() }).required);
});

test("disk rule: cached stages no longer count", () => {
  const input = { audioBytes: 2 * GB, epubBytes: 10_000_000, audioDurationSeconds: 36_000 };
  const resync = requiredDiskBytes({ ...input, skipped: new Set(["preparing_audio", "generating_emissions", "marking_up_ebook"]) });
  // Re-aligning holds the unpacked copy, the scratch EPUB and the output at once.
  assert.equal(resync.required, 3 * 2 * GB + 5 * 10_000_000 + DISK_MARGIN_BYTES);
  const everything = requiredDiskBytes({ ...input, skipped: new Set(["preparing_audio", "generating_emissions", "marking_up_ebook", "aligning"]) });
  assert.equal(everything.required, DISK_MARGIN_BYTES);
});

test("disk rule: an unknown duration is estimated from the audio size", () => {
  const { shares } = requiredDiskBytes({ audioBytes: 800_000_000, epubBytes: 0, audioDurationSeconds: null, skipped: new Set() });
  assert.equal(shares.generating_emissions, Math.ceil((800_000_000 / ASSUMED_AUDIO_BYTES_PER_SECOND) * EMISSION_BYTES_PER_SECOND));
});

test("plan: every valid marker is skipped", () => {
  assert.ok(planStages(ALL_VALID, null).every((entry) => !entry.run && entry.reason === "cached"));
});

test("plan: resumeFrom forces that stage and every later one", () => {
  const plan = planStages(ALL_VALID, "marking_up_ebook");
  assert.deepEqual(
    plan.filter((entry) => entry.run).map((entry) => [entry.stage, entry.reason]),
    [
      ["marking_up_ebook", "forced"],
      ["aligning", "forced"],
    ],
  );
  assert.deepEqual(
    planStages(ALL_VALID, "validating").filter((entry) => entry.run),
    [],
  );
});

test("plan: a rerun stage drags its dependents with it, not unrelated stages", () => {
  const plan = planStages({ ...ALL_VALID, preparing_audio: "missing" }, null);
  assert.deepEqual(
    plan.filter((entry) => entry.run).map((entry) => [entry.stage, entry.reason]),
    [
      ["preparing_audio", "missing"],
      ["generating_emissions", "dependency"],
      ["aligning", "dependency"],
    ],
  );
});

test("fingerprints: changed decisions invalidate only alignment", () => {
  const before = source();
  const after = source({ decisions: { chapters: { "chapter.xhtml": "excluded" }, audio: [] } });
  for (const stage of ["preparing_audio", "generating_emissions", "marking_up_ebook"]) {
    assert.equal(fingerprint(stageInputs(stage, before)), fingerprint(stageInputs(stage, after)), stage);
  }
  assert.notEqual(fingerprint(stageInputs("aligning", before)), fingerprint(stageInputs("aligning", after)));
});

test("fingerprints: decision key order does not matter, granularity and sources do", () => {
  const a = source({ decisions: { chapters: { "a.xhtml": "excluded", "b.xhtml": "included" }, audio: [] } });
  const b = source({ decisions: { chapters: { "b.xhtml": "included", "a.xhtml": "excluded" }, audio: [] } });
  assert.equal(fingerprint(stageInputs("aligning", a)), fingerprint(stageInputs("aligning", b)));
  const word = source({ granularity: "word" });
  assert.notEqual(fingerprint(stageInputs("marking_up_ebook", source())), fingerprint(stageInputs("marking_up_ebook", word)));
  assert.equal(fingerprint(stageInputs("generating_emissions", source())), fingerprint(stageInputs("generating_emissions", word)));
  const touched = source({ audio: [{ path: "/books/a/01.mp3", size: 5000, mtimeMs: 3 }] });
  assert.notEqual(fingerprint(stageInputs("preparing_audio", source())), fingerprint(stageInputs("preparing_audio", touched)));
  assert.equal(fingerprint(stageInputs("marking_up_ebook", source())), fingerprint(stageInputs("marking_up_ebook", touched)));
});

test("weights: skipped stages are renormalized so a run still ends at 100", () => {
  const all = normalizedWeights(["preparing_audio", "generating_emissions", "marking_up_ebook", "aligning", "validating"]);
  assert.equal(Math.round([...all.values()].reduce((sum, value) => sum + value, 0)), 100);
  assert.equal(all.get("generating_emissions"), (60 / 95) * 100);
  const resync = normalizedWeights(["aligning", "validating"]);
  assert.equal(resync.get("aligning"), 80);
  assert.equal(resync.get("validating"), 20);
});
