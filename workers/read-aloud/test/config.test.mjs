import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WORKER_TMP_SUBDIR, loadConfig, parseLibraryRoots, workerVersion } from "../dist/config.js";
import { prepareDataFolders } from "../dist/server.js";
import { checkFfmpeg } from "../dist/toolchain.js";

const TOKEN = "0123456789abcdef0123";

test("library roots: the list wins, trimmed and de-duplicated", () => {
  assert.deepEqual(parseLibraryRoots({ READ_ALOUD_LIBRARY_ROOTS: " /books , /mnt/audio/,,/books", READ_ALOUD_LIBRARY_ROOT: "/old" }), [
    "/books",
    "/mnt/audio",
  ]);
});

test("library roots: the single-root variable is the fallback, then /books", () => {
  assert.deepEqual(parseLibraryRoots({ READ_ALOUD_LIBRARY_ROOT: "/library" }), ["/library"]);
  assert.deepEqual(parseLibraryRoots({}), ["/books"]);
  assert.deepEqual(parseLibraryRoots({ READ_ALOUD_LIBRARY_ROOTS: "  " }), ["/books"]);
});

test("library roots: relative paths are refused", () => {
  assert.throws(() => parseLibraryRoots({ READ_ALOUD_LIBRARY_ROOTS: "/books,media" }), /absolute/);
  assert.throws(() => parseLibraryRoots({ READ_ALOUD_LIBRARY_ROOTS: "," }), /at least one/);
});

test("version: the image's release version, else the package version", () => {
  const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  assert.equal(workerVersion({ APP_VERSION: " v3.4.0 " }), "v3.4.0");
  assert.equal(workerVersion({ APP_VERSION: "" }), packageVersion);
  assert.equal(workerVersion({}), packageVersion);
});

test("config: binds to loopback and keeps temp files beside the job folder by default", () => {
  const config = loadConfig({ READ_ALOUD_WORKER_TOKEN: TOKEN, READ_ALOUD_WORK_ROOT: "/data/read-aloud/jobs" });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8787);
  assert.equal(config.tmpDir, "/data/read-aloud/tmp");
  assert.equal(config.configuredDevice, "auto");
  assert.equal(config.dtype, null);
  assert.equal(config.batchSize, null);
  assert.equal(loadConfig({ READ_ALOUD_WORKER_TOKEN: TOKEN, READ_ALOUD_WORKER_HOST: "0.0.0.0" }).host, "0.0.0.0");
});

test("config: rejects a short token and bad tuning values", () => {
  assert.throws(() => loadConfig({ READ_ALOUD_WORKER_TOKEN: "short" }), /16 characters/);
  assert.throws(() => loadConfig({ READ_ALOUD_WORKER_TOKEN: TOKEN, READ_ALOUD_CTC_DEVICE: "tpu" }), /READ_ALOUD_CTC_DEVICE/);
  assert.throws(() => loadConfig({ READ_ALOUD_WORKER_TOKEN: TOKEN, READ_ALOUD_CTC_BATCH_SIZE: "100" }), /BATCH_SIZE/);
  assert.throws(() => loadConfig({ READ_ALOUD_WORKER_TOKEN: TOKEN, READ_ALOUD_TMP_DIR: "tmp" }), /absolute/);
});

test("data folders: only the worker's own temp subfolder is emptied, and a temp folder holding the jobs is refused", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "read-aloud-config-test-")));
  try {
    const workRoot = join(root, "read-aloud", "jobs");
    const tmpDir = join(root, "read-aloud", "tmp");
    const library = join(root, "books");
    const scratch = join(tmpDir, WORKER_TMP_SUBDIR);
    mkdirSync(join(scratch, "stale", "deep"), { recursive: true });
    writeFileSync(join(scratch, "leftover.bin"), "x");
    writeFileSync(join(tmpDir, "someone-elses.sock"), "x");
    const config = { libraryRoots: [library], workRoot, tmpDir };
    await prepareDataFolders(config);
    assert.ok(existsSync(workRoot));
    assert.deepEqual(readdirSync(scratch), []);
    assert.ok(existsSync(join(tmpDir, "someone-elses.sock")), "a shared temp folder such as /tmp keeps everything else");

    symlinkSync(join(root, "read-aloud"), join(root, "linked-data"));
    await assert.rejects(prepareDataFolders({ ...config, tmpDir: join(root, "linked-data") }), /must not be, or contain/);

    await assert.rejects(prepareDataFolders({ ...config, tmpDir: join(root, "read-aloud") }), /must not be, or contain/);
    await assert.rejects(prepareDataFolders({ ...config, tmpDir: join(library, "tmp") }), /inside a library/);
    await assert.rejects(prepareDataFolders({ ...config, tmpDir: "/" }), /filesystem root/);
    assert.ok(existsSync(workRoot), "a refused temp folder deletes nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("toolchain: a missing ffmpeg is a startup error", async () => {
  await assert.rejects(checkFfmpeg({ PATH: "/nonexistent" }), /ffmpeg was not found on the PATH/);
});
