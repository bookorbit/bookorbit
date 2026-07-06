#!/usr/bin/env node
import { createRequire } from "module";
import { createHash } from "crypto";
import { copyFile, mkdir, rename, rm, stat, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const requireFromClient = createRequire(new URL("../../client/package.json", import.meta.url));
const { io } = requireFromClient("socket.io-client");

const DEFAULT_LIB1_ROOT = "/Users/aditya.chandel/Workspace-private/bookorbit-local/books/Move Test Lib 1";
const DEFAULT_LIB2_ROOT = "/Users/aditya.chandel/Workspace-private/bookorbit-local/books/Move Test Lib 2";
const PG_IMAGE = "pgvector/pgvector:pg18";
const SETTLE_MS = 6500;
const WAIT_MS = 45000;

const args = parseArgs(process.argv.slice(2));
const image = args.image ?? "bookorbit:move-e2e-local";
const modes = parseModes(args.modes ?? "file,folder");
const hostRoots = {
  lib1: process.env.BOOKORBIT_MOVE_E2E_LIB1 ?? DEFAULT_LIB1_ROOT,
  lib2: process.env.BOOKORBIT_MOVE_E2E_LIB2 ?? DEFAULT_LIB2_ROOT,
};
const runId = `__bookorbit_move_e2e_${Date.now()}`;

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--build") parsed.build = true;
    else if (arg === "--keep") parsed.keep = true;
    else if (arg === "--image") parsed.image = argv[++i];
    else if (arg === "--modes") parsed.modes = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function parseModes(value) {
  const selected = new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const modesToRun = [];
  if (selected.has("file")) modesToRun.push({ key: "file", organizationMode: "book_per_file", port: 32191 });
  if (selected.has("folder")) modesToRun.push({ key: "folder", organizationMode: "book_per_folder", port: 32192 });
  if (modesToRun.length === 0) throw new Error("No modes selected. Use --modes file,folder");
  return modesToRun;
}

async function main() {
  console.log(`runId=${runId}`);
  await assertDockerAvailable();
  await mkdir(hostRoots.lib1, { recursive: true });
  await mkdir(hostRoots.lib2, { recursive: true });

  if (args.build) {
    await run("docker", ["build", "-t", image, "."], { cwd: repoRoot, stdio: "inherit", timeout: 20 * 60_000 });
  }

  for (const mode of modes) {
    await runMode(mode);
  }

  console.log("MOVE_WATCHER_E2E_PASS");
}

async function runMode(mode) {
  const suffix = `${runId}_${mode.key}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const names = {
    network: `bo_move_ext_${suffix}_net`,
    db: `bo_move_ext_${suffix}_db`,
    app: `bo_move_ext_${suffix}_app`,
    pgVolume: `bo_move_ext_${suffix}_pg`,
    dataVolume: `bo_move_ext_${suffix}_data`,
  };
  const hostLib1 = join(hostRoots.lib1, runId, mode.key, "lib1");
  const hostLib2 = join(hostRoots.lib2, runId, mode.key, "lib2");
  const baseUrl = `http://127.0.0.1:${mode.port}`;
  const setupToken = `setup-${suffix}`;
  const state = { names, hostLib1, hostLib2, socket: null };

  try {
    await mkdir(hostLib1, { recursive: true });
    await mkdir(hostLib2, { recursive: true });
    await seedModeFixtures(mode, hostLib1, hostLib2);
    await startDockerInstance(mode, names, hostLib1, hostLib2, setupToken);
    await waitForHealth(baseUrl);

    const token = await setupApp(baseUrl, setupToken, mode);
    const libraries = await createLibraries(baseUrl, token, mode);
    const events = await connectScanSocket(baseUrl, token, libraries);
    state.socket = events.socket;

    await waitForInitialRows(names.db, mode, libraries);
    const ids = await loadInitialIds(names.db, mode);
    console.log(`[${mode.key}] baseline ids ${JSON.stringify(ids)}`);

    if (mode.key === "file") {
      await runFileModeMatrix({ modeKey: mode.key, names, hostLib1, hostLib2, libraries, events, ids });
    } else {
      await runFolderModeMatrix({ modeKey: mode.key, names, hostLib1, hostLib2, libraries, events, ids });
    }

    const rows = await getRows(names.db);
    console.log(`[${mode.key}] final rows ${JSON.stringify(rows, null, 2)}`);
    console.log(`[${mode.key}] PASS`);
  } catch (error) {
    console.error(`[${mode.key}] FAIL ${error?.stack ?? error}`);
    await printContainerLogs(names.app);
    throw error;
  } finally {
    state.socket?.disconnect();
    if (!args.keep) await cleanup(names, hostLib1, hostLib2);
  }
}

async function seedModeFixtures(mode, hostLib1) {
  if (mode.key === "file") {
    await writeFixture(hostLib1, "Alpha.epub", content("file-alpha"));
    await writeFixture(hostLib1, "Space Dir/Beta.pdf", content("file-beta"));
    await writeFixture(hostLib1, "Author Three/Gamma.cbz", content("file-gamma"));
    await writeFixture(hostLib1, "Batch/One.epub", content("file-batch-one"));
    await writeFixture(hostLib1, "Batch/Two.pdf", content("file-batch-two"));
    await writeFixture(hostLib1, "Rapid.epub", content("file-rapid"));
    await writeFixture(hostLib1, "Restore.epub", content("file-restore"));
    await writeFixture(hostLib1, "CopyDelete.epub", content("file-copy-delete"));
    await writeFixture(hostLib1, "DeleteMe.epub", content("file-delete"));
    return;
  }

  await writeFixture(hostLib1, "Author One/Book Alpha/alpha.epub", content("folder-alpha"));
  await writeFixture(hostLib1, "Author Two/Book Beta/beta.pdf", content("folder-beta"));
  await writeFixture(hostLib1, "Author Two/Book Beta/metadata.opf", metadataOpf("Book Beta"));
  await writeFixture(hostLib1, "Author Three/Book Gamma/gamma.cbz", content("folder-gamma"));
  await writeFixture(hostLib1, "Batch/Book One/one.epub", content("folder-batch-one"));
  await writeFixture(hostLib1, "Batch/Book Two/two.pdf", content("folder-batch-two"));
  await writeFixture(hostLib1, "Rapid/Book Rapid/rapid.epub", content("folder-rapid"));
  await writeFixture(hostLib1, "Restore/Book Restore/restore.epub", content("folder-restore"));
  await writeFixture(hostLib1, "CopyDelete/Book Copy/copy.epub", content("folder-copy-delete"));
  await writeFixture(hostLib1, "Delete/Book Delete/delete.epub", content("folder-delete"));
}

function content(label) {
  return `${label}\n${createHash("sha256").update(label).digest("hex")}\n`.repeat(256);
}

function metadataOpf(title) {
  return `<?xml version="1.0" encoding="UTF-8"?><package><metadata><title>${title}</title></metadata></package>\n`;
}

async function writeFixture(root, relPath, data) {
  const fullPath = join(root, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
}

async function startDockerInstance(mode, names, hostLib1, hostLib2, setupToken) {
  await run("docker", ["network", "create", names.network]);
  await run("docker", ["volume", "create", names.pgVolume]);
  await run("docker", ["volume", "create", names.dataVolume]);

  await run("docker", [
    "run",
    "-d",
    "--name",
    names.db,
    "--network",
    names.network,
    "-e",
    "POSTGRES_USER=bookorbit",
    "-e",
    "POSTGRES_PASSWORD=bookorbit",
    "-e",
    "POSTGRES_DB=bookorbit",
    "-e",
    "PGDATA=/var/lib/postgresql/data/pgdata",
    "-v",
    `${names.pgVolume}:/var/lib/postgresql/data`,
    PG_IMAGE,
  ]);
  await waitForPostgres(names.db);

  await run("docker", [
    "run",
    "-d",
    "--name",
    names.app,
    "--network",
    names.network,
    "-p",
    `127.0.0.1:${mode.port}:3000`,
    "-e",
    "NODE_ENV=production",
    "-e",
    "PORT=3000",
    "-e",
    `APP_URL=http://127.0.0.1:${mode.port}`,
    "-e",
    `CLIENT_URL=http://127.0.0.1:${mode.port}`,
    "-e",
    `DATABASE_URL=postgres://bookorbit:bookorbit@${names.db}:5432/bookorbit`,
    "-e",
    "JWT_SECRET=move-watcher-e2e-jwt-secret",
    "-e",
    "JWT_EXPIRES_IN=1h",
    "-e",
    "JWT_REFRESH_EXPIRES_IN=7d",
    "-e",
    `SETUP_BOOTSTRAP_TOKEN=${setupToken}`,
    "-e",
    `PUID=${process.getuid?.() ?? 1000}`,
    "-e",
    `PGID=${process.getgid?.() ?? 1000}`,
    "-v",
    `${names.dataVolume}:/data`,
    "-v",
    `${hostLib1}:/books/lib1`,
    "-v",
    `${hostLib2}:/books/lib2`,
    image,
  ]);
}

async function setupApp(baseUrl, setupToken, mode) {
  const response = await api(baseUrl, "/api/v1/auth/setup", {
    method: "POST",
    headers: { "x-setup-token": setupToken },
    body: {
      username: `${mode.key}admin`,
      name: `${mode.key} Admin`,
      email: `${mode.key}@example.test`,
      password: "Password123",
    },
  });
  return response.accessToken;
}

async function createLibraries(baseUrl, token, mode) {
  const lib1 = await api(baseUrl, "/api/v1/libraries", {
    method: "POST",
    token,
    body: libraryPayload(`${mode.key} Move Test Lib 1`, "/books/lib1", mode.organizationMode),
  });
  const lib2 = await api(baseUrl, "/api/v1/libraries", {
    method: "POST",
    token,
    body: libraryPayload(`${mode.key} Move Test Lib 2`, "/books/lib2", mode.organizationMode),
  });
  return { lib1: lib1.id, lib2: lib2.id };
}

function libraryPayload(name, folder, organizationMode) {
  return {
    name,
    icon: "BookOpen",
    folders: [folder],
    watch: true,
    organizationMode,
    metadataPrecedence: ["embedded", "opfFile"],
    allowedFormats: [],
    formatPriority: ["epub", "pdf", "cbz", "cbr", "mp3", "m4b"],
  };
}

async function connectScanSocket(baseUrl, token, libraries) {
  const events = [];
  const socket = io(`${baseUrl}/scan`, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
  });
  await new Promise((resolveConnect, rejectConnect) => {
    const timer = setTimeout(() => rejectConnect(new Error("scan socket connect timed out")), 15000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolveConnect();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      rejectConnect(err);
    });
  });

  for (const eventName of ["book:missing", "book:restored", "book:moved", "book:transferred", "scan:books:added", "scan:progress"]) {
    socket.on(eventName, (event) => events.push({ type: eventName, event, ts: Date.now() }));
  }
  socket.emit("subscribe:library", libraries.lib1);
  socket.emit("subscribe:library", libraries.lib2);
  return { socket, events };
}

async function runFileModeMatrix(ctx) {
  const { names, hostLib1, hostLib2, libraries, events, ids } = ctx;

  await moveAndExpect(
    ctx,
    "file rename in same library",
    async () => {
      await movePath(hostLib1, "Alpha.epub", hostLib1, "Alpha Renamed!.epub");
    },
    [{ id: ids.alpha, libraryId: libraries.lib1, relPath: "Alpha Renamed!.epub", status: "present" }],
  );

  await moveAndExpect(
    ctx,
    "file nested move in same library",
    async () => {
      await movePath(hostLib1, "Alpha Renamed!.epub", hostLib1, "Nested/Alpha Final.epub");
    },
    [{ id: ids.alpha, libraryId: libraries.lib1, relPath: "Nested/Alpha Final.epub", status: "present" }],
  );

  await moveAndExpect(
    ctx,
    "file cross-library move",
    async () => {
      await movePath(hostLib1, "Space Dir/Beta.pdf", hostLib2, "Incoming/Beta Moved.pdf");
    },
    [{ id: ids.beta, libraryId: libraries.lib2, relPath: "Incoming/Beta Moved.pdf", status: "present" }],
    {
      transfer: { fromLibraryId: libraries.lib1, toLibraryId: libraries.lib2, bookIds: [ids.beta] },
    },
  );

  await moveAndExpect(
    ctx,
    "file cross-library move back with rename",
    async () => {
      await movePath(hostLib2, "Incoming/Beta Moved.pdf", hostLib1, "Back/Beta Back.pdf");
    },
    [{ id: ids.beta, libraryId: libraries.lib1, relPath: "Back/Beta Back.pdf", status: "present" }],
    {
      transfer: { fromLibraryId: libraries.lib2, toLibraryId: libraries.lib1, bookIds: [ids.beta] },
    },
  );

  await moveAndExpect(
    ctx,
    "file parent folder rename",
    async () => {
      await movePath(hostLib1, "Author Three", hostLib1, "Author Three Renamed");
    },
    [{ id: ids.gamma, libraryId: libraries.lib1, relPath: "Author Three Renamed/Gamma.cbz", status: "present" }],
  );

  await moveAndExpect(
    ctx,
    "file batch parent folder cross-library move",
    async () => {
      await movePath(hostLib1, "Batch", hostLib2, "Batch Moved");
    },
    [
      { id: ids.batchOne, libraryId: libraries.lib2, relPath: "Batch Moved/One.epub", status: "present" },
      { id: ids.batchTwo, libraryId: libraries.lib2, relPath: "Batch Moved/Two.pdf", status: "present" },
    ],
    {
      transfer: { fromLibraryId: libraries.lib1, toLibraryId: libraries.lib2, bookIds: [ids.batchOne, ids.batchTwo] },
    },
  );

  await moveAndExpect(
    ctx,
    "file rapid two-step rename",
    async () => {
      await movePath(hostLib1, "Rapid.epub", hostLib1, "Rapid 1.epub");
      await sleep(150);
      await movePath(hostLib1, "Rapid 1.epub", hostLib1, "Rapid 2.epub");
    },
    [{ id: ids.rapid, libraryId: libraries.lib1, relPath: "Rapid 2.epub", status: "present" }],
  );

  await deleteAndRestoreFile(ctx, {
    label: "file delete and restore",
    bookId: ids.restore,
    libraryId: libraries.lib1,
    hostRoot: hostLib1,
    relPath: "Restore.epub",
    data: content("file-restore"),
  });

  await copyThenDeleteAndExpectTransfer(ctx, {
    label: "file copy-then-delete cross-library transfer",
    bookId: ids.copyDelete,
    fromLibraryId: libraries.lib1,
    toLibraryId: libraries.lib2,
    fromRoot: hostLib1,
    toRoot: hostLib2,
    relPath: "CopyDelete.epub",
  });

  await trueDelete(ctx, {
    label: "file true delete",
    bookId: ids.deleteMe,
    libraryId: libraries.lib1,
    hostRoot: hostLib1,
    relPath: "DeleteMe.epub",
  });

  await assertNoPresentDuplicateHashes(names.db);
  assertNoUnexpectedTransfers(events.events, [ids.deleteMe]);
}

async function runFolderModeMatrix(ctx) {
  const { names, hostLib1, hostLib2, libraries, ids } = ctx;

  await moveAndExpect(
    ctx,
    "folder book folder rename",
    async () => {
      await movePath(hostLib1, "Author One/Book Alpha", hostLib1, "Author One/Book Alpha Renamed");
    },
    [
      {
        id: ids.alpha,
        libraryId: libraries.lib1,
        relPath: "Author One/Book Alpha Renamed/alpha.epub",
        folderPath: "/books/lib1/Author One/Book Alpha Renamed",
        status: "present",
      },
    ],
  );

  await moveAndExpect(
    ctx,
    "folder nested book folder move",
    async () => {
      await movePath(hostLib1, "Author One/Book Alpha Renamed", hostLib1, "Author One/Subseries/Book Alpha Final");
    },
    [
      {
        id: ids.alpha,
        libraryId: libraries.lib1,
        relPath: "Author One/Subseries/Book Alpha Final/alpha.epub",
        folderPath: "/books/lib1/Author One/Subseries/Book Alpha Final",
        status: "present",
      },
    ],
  );

  await moveAndExpect(
    ctx,
    "folder cross-library move",
    async () => {
      await movePath(hostLib1, "Author Two/Book Beta", hostLib2, "Incoming/Book Beta");
    },
    [
      {
        id: ids.beta,
        libraryId: libraries.lib2,
        relPath: "Incoming/Book Beta/beta.pdf",
        folderPath: "/books/lib2/Incoming/Book Beta",
        status: "present",
      },
      {
        id: ids.beta,
        libraryId: libraries.lib2,
        relPath: "Incoming/Book Beta/metadata.opf",
        folderPath: "/books/lib2/Incoming/Book Beta",
        role: "metadata",
        status: "present",
      },
    ],
    {
      transfer: { fromLibraryId: libraries.lib1, toLibraryId: libraries.lib2, bookIds: [ids.beta] },
    },
  );

  await moveAndExpect(
    ctx,
    "folder cross-library move back with rename",
    async () => {
      await movePath(hostLib2, "Incoming/Book Beta", hostLib1, "Back/Beta Back");
    },
    [{ id: ids.beta, libraryId: libraries.lib1, relPath: "Back/Beta Back/beta.pdf", folderPath: "/books/lib1/Back/Beta Back", status: "present" }],
    {
      transfer: { fromLibraryId: libraries.lib2, toLibraryId: libraries.lib1, bookIds: [ids.beta] },
    },
  );

  await moveAndExpect(
    ctx,
    "folder content file rename",
    async () => {
      await movePath(hostLib1, "Author Three/Book Gamma/gamma.cbz", hostLib1, "Author Three/Book Gamma/gamma-renamed.cbz");
    },
    [
      {
        id: ids.gamma,
        libraryId: libraries.lib1,
        relPath: "Author Three/Book Gamma/gamma-renamed.cbz",
        folderPath: "/books/lib1/Author Three/Book Gamma",
        status: "present",
      },
    ],
  );

  await moveAndExpect(
    ctx,
    "folder parent author folder rename",
    async () => {
      await movePath(hostLib1, "Author Three", hostLib1, "Author Three Renamed");
    },
    [
      {
        id: ids.gamma,
        libraryId: libraries.lib1,
        relPath: "Author Three Renamed/Book Gamma/gamma-renamed.cbz",
        folderPath: "/books/lib1/Author Three Renamed/Book Gamma",
        status: "present",
      },
    ],
  );

  await moveAndExpect(
    ctx,
    "folder batch parent cross-library move",
    async () => {
      await movePath(hostLib1, "Batch", hostLib2, "Batch Moved");
    },
    [
      {
        id: ids.batchOne,
        libraryId: libraries.lib2,
        relPath: "Batch Moved/Book One/one.epub",
        folderPath: "/books/lib2/Batch Moved/Book One",
        status: "present",
      },
      {
        id: ids.batchTwo,
        libraryId: libraries.lib2,
        relPath: "Batch Moved/Book Two/two.pdf",
        folderPath: "/books/lib2/Batch Moved/Book Two",
        status: "present",
      },
    ],
    {
      transfer: { fromLibraryId: libraries.lib1, toLibraryId: libraries.lib2, bookIds: [ids.batchOne, ids.batchTwo] },
    },
  );

  await moveAndExpect(
    ctx,
    "folder rapid two-step folder rename",
    async () => {
      await movePath(hostLib1, "Rapid/Book Rapid", hostLib1, "Rapid/Book Rapid 1");
      await sleep(150);
      await movePath(hostLib1, "Rapid/Book Rapid 1", hostLib1, "Rapid/Book Rapid 2");
    },
    [
      {
        id: ids.rapid,
        libraryId: libraries.lib1,
        relPath: "Rapid/Book Rapid 2/rapid.epub",
        folderPath: "/books/lib1/Rapid/Book Rapid 2",
        status: "present",
      },
    ],
  );

  await deleteAndRestoreFolder(ctx, {
    label: "folder delete and restore",
    bookId: ids.restore,
    libraryId: libraries.lib1,
    hostRoot: hostLib1,
    folderRelPath: "Restore/Book Restore",
    fileRelPath: "Restore/Book Restore/restore.epub",
    data: content("folder-restore"),
  });

  await copyThenDeleteAndExpectTransfer(ctx, {
    label: "folder copy-then-delete cross-library transfer",
    bookId: ids.copyDelete,
    fromLibraryId: libraries.lib1,
    toLibraryId: libraries.lib2,
    fromRoot: hostLib1,
    toRoot: hostLib2,
    relPath: "CopyDelete/Book Copy/copy.epub",
    folderPath: "/books/lib2/CopyDelete/Book Copy",
  });

  await trueDelete(ctx, {
    label: "folder true delete",
    bookId: ids.deleteMe,
    libraryId: libraries.lib1,
    hostRoot: hostLib1,
    relPath: "Delete/Book Delete",
    expectRelPath: "Delete/Book Delete/delete.epub",
  });

  await assertNoPresentDuplicateHashes(names.db);
}

async function moveAndExpect(ctx, label, operation, expectations, options = {}) {
  const before = await checkpoint(ctx.names.db, ctx.events.events);
  await operation();
  await waitForExpectations(ctx.names.db, expectations, label);
  await sleep(SETTLE_MS);
  await waitForExpectations(ctx.names.db, expectations, `${label} after settle`);
  await assertNoPresentDuplicateHashes(ctx.names.db);
  await assertNoFalseMissing(
    ctx,
    before,
    expectations.map((item) => item.id),
    label,
  );
  if (options.transfer) {
    assertTransferred(ctx.events.events.slice(before.eventIndex), options.transfer, label);
  } else {
    assertNoTransferFor(
      ctx.events.events.slice(before.eventIndex),
      expectations.map((item) => item.id),
      label,
    );
  }
  console.log(`[${ctxMode(ctx)}] ok ${label}`);
}

async function deleteAndRestoreFile(ctx, input) {
  const beforeDelete = await checkpoint(ctx.names.db, ctx.events.events);
  await rm(join(input.hostRoot, input.relPath), { force: true });
  await waitForExpectations(
    ctx.names.db,
    [{ id: input.bookId, libraryId: input.libraryId, relPath: input.relPath, status: "missing" }],
    `${input.label} missing`,
  );
  await sleep(SETTLE_MS);
  assertMissingEvent(ctx.events.events.slice(beforeDelete.eventIndex), input.bookId, input.libraryId, input.label);
  await assertUnavailableIncreased(ctx.names.db, beforeDelete, input.label);

  const beforeRestore = await checkpoint(ctx.names.db, ctx.events.events);
  await writeFixture(input.hostRoot, input.relPath, input.data);
  await waitForExpectations(
    ctx.names.db,
    [{ id: input.bookId, libraryId: input.libraryId, relPath: input.relPath, status: "present" }],
    `${input.label} restored`,
  );
  await sleep(SETTLE_MS);
  assertRestoredEvent(ctx.events.events.slice(beforeRestore.eventIndex), input.bookId, input.libraryId, input.label);
  console.log(`[${ctxMode(ctx)}] ok ${input.label}`);
}

async function deleteAndRestoreFolder(ctx, input) {
  const beforeDelete = await checkpoint(ctx.names.db, ctx.events.events);
  await rm(join(input.hostRoot, input.folderRelPath), { recursive: true, force: true });
  await waitForExpectations(
    ctx.names.db,
    [{ id: input.bookId, libraryId: input.libraryId, relPath: input.fileRelPath, status: "missing" }],
    `${input.label} missing`,
  );
  await sleep(SETTLE_MS);
  assertMissingEvent(ctx.events.events.slice(beforeDelete.eventIndex), input.bookId, input.libraryId, input.label);
  await assertUnavailableIncreased(ctx.names.db, beforeDelete, input.label);

  const beforeRestore = await checkpoint(ctx.names.db, ctx.events.events);
  await writeFixture(input.hostRoot, input.fileRelPath, input.data);
  await waitForExpectations(
    ctx.names.db,
    [{ id: input.bookId, libraryId: input.libraryId, relPath: input.fileRelPath, status: "present" }],
    `${input.label} restored`,
  );
  await sleep(SETTLE_MS);
  assertRestoredEvent(ctx.events.events.slice(beforeRestore.eventIndex), input.bookId, input.libraryId, input.label);
  console.log(`[${ctxMode(ctx)}] ok ${input.label}`);
}

async function copyThenDeleteAndExpectTransfer(ctx, input) {
  const before = await checkpoint(ctx.names.db, ctx.events.events);
  await mkdir(dirname(join(input.toRoot, input.relPath)), { recursive: true });
  await copyFile(join(input.fromRoot, input.relPath), join(input.toRoot, input.relPath));
  await waitForCondition(
    async () => {
      const rows = await getRows(ctx.names.db);
      return rows.some((row) => row.library_id === input.toLibraryId && row.rel_path === input.relPath && row.status === "present");
    },
    `${input.label} duplicate imported`,
    WAIT_MS,
  );

  await rm(join(input.fromRoot, input.relPath), { force: true });
  const expectation = {
    id: input.bookId,
    libraryId: input.toLibraryId,
    relPath: input.relPath,
    folderPath: input.folderPath,
    status: "present",
  };
  await waitForExpectations(ctx.names.db, [expectation], input.label);
  await sleep(SETTLE_MS);
  await waitForExpectations(ctx.names.db, [expectation], `${input.label} after settle`);
  await assertNoPresentDuplicateHashes(ctx.names.db);
  await assertNoFalseMissing(ctx, before, [input.bookId], input.label);
  assertTransferred(
    ctx.events.events.slice(before.eventIndex),
    {
      fromLibraryId: input.fromLibraryId,
      toLibraryId: input.toLibraryId,
      bookIds: [input.bookId],
    },
    input.label,
  );
  console.log(`[${ctxMode(ctx)}] ok ${input.label}`);
}

async function trueDelete(ctx, input) {
  const before = await checkpoint(ctx.names.db, ctx.events.events);
  await rm(join(input.hostRoot, input.relPath), { recursive: true, force: true });
  await waitForExpectations(
    ctx.names.db,
    [
      {
        id: input.bookId,
        libraryId: input.libraryId,
        relPath: input.expectRelPath ?? input.relPath,
        status: "missing",
      },
    ],
    input.label,
  );
  await sleep(SETTLE_MS);
  assertMissingEvent(ctx.events.events.slice(before.eventIndex), input.bookId, input.libraryId, input.label);
  await assertUnavailableIncreased(ctx.names.db, before, input.label);
  console.log(`[${ctxMode(ctx)}] ok ${input.label}`);
}

function ctxMode(ctx) {
  return ctx.modeKey;
}

async function movePath(fromRoot, fromRel, toRoot, toRel) {
  const from = join(fromRoot, fromRel);
  const to = join(toRoot, toRel);
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
}

async function waitForInitialRows(dbName, mode, libraries) {
  const expected =
    mode.key === "file"
      ? [
          "Alpha.epub",
          "Space Dir/Beta.pdf",
          "Author Three/Gamma.cbz",
          "Batch/One.epub",
          "Batch/Two.pdf",
          "Rapid.epub",
          "Restore.epub",
          "CopyDelete.epub",
          "DeleteMe.epub",
        ]
      : [
          "Author One/Book Alpha/alpha.epub",
          "Author Two/Book Beta/beta.pdf",
          "Author Three/Book Gamma/gamma.cbz",
          "Batch/Book One/one.epub",
          "Batch/Book Two/two.pdf",
          "Rapid/Book Rapid/rapid.epub",
          "Restore/Book Restore/restore.epub",
          "CopyDelete/Book Copy/copy.epub",
          "Delete/Book Delete/delete.epub",
        ];
  await waitForCondition(
    async () => {
      const rows = await getRows(dbName);
      return expected.every((relPath) =>
        rows.some((row) => row.library_id === libraries.lib1 && row.rel_path === relPath && row.role === "content" && row.status === "present"),
      );
    },
    `${mode.key} initial scan`,
    90000,
  );
}

async function loadInitialIds(dbName, mode) {
  const rows = await getRows(dbName);
  const byRel = (relPath) => {
    const row = rows.find((item) => item.rel_path === relPath && item.role === "content");
    if (!row) throw new Error(`Missing initial row for ${relPath}`);
    return row.book_id;
  };
  if (mode.key === "file") {
    return {
      alpha: byRel("Alpha.epub"),
      beta: byRel("Space Dir/Beta.pdf"),
      gamma: byRel("Author Three/Gamma.cbz"),
      batchOne: byRel("Batch/One.epub"),
      batchTwo: byRel("Batch/Two.pdf"),
      rapid: byRel("Rapid.epub"),
      restore: byRel("Restore.epub"),
      copyDelete: byRel("CopyDelete.epub"),
      deleteMe: byRel("DeleteMe.epub"),
    };
  }
  return {
    alpha: byRel("Author One/Book Alpha/alpha.epub"),
    beta: byRel("Author Two/Book Beta/beta.pdf"),
    gamma: byRel("Author Three/Book Gamma/gamma.cbz"),
    batchOne: byRel("Batch/Book One/one.epub"),
    batchTwo: byRel("Batch/Book Two/two.pdf"),
    rapid: byRel("Rapid/Book Rapid/rapid.epub"),
    restore: byRel("Restore/Book Restore/restore.epub"),
    copyDelete: byRel("CopyDelete/Book Copy/copy.epub"),
    deleteMe: byRel("Delete/Book Delete/delete.epub"),
  };
}

async function waitForExpectations(dbName, expectations, label) {
  await waitForCondition(
    async () => {
      const rows = await getRows(dbName);
      return expectations.every((expectation) => rows.some((row) => rowMatches(row, expectation)));
    },
    label,
    WAIT_MS,
  );
}

function rowMatches(row, expectation) {
  if (row.book_id !== expectation.id) return false;
  if (row.library_id !== expectation.libraryId) return false;
  if (row.rel_path !== expectation.relPath) return false;
  if (row.status !== expectation.status) return false;
  if ((expectation.role ?? "content") !== row.role) return false;
  if (expectation.folderPath && row.folder_path !== expectation.folderPath) return false;
  return true;
}

async function checkpoint(dbName, events) {
  return {
    eventIndex: events.length,
    notifications: await getNotificationCounts(dbName),
  };
}

async function assertNoFalseMissing(ctx, before, bookIds, label) {
  const ids = new Set(bookIds);
  const missing = ctx.events.events
    .slice(before.eventIndex)
    .filter((entry) => entry.type === "book:missing" && entry.event.bookIds.some((id) => ids.has(id)));
  if (missing.length > 0) throw new Error(`${label}: unexpected book:missing ${JSON.stringify(missing)}`);

  const after = await getNotificationCounts(ctx.names.db);
  const beforeUnavailable = before.notifications.books_unavailable ?? 0;
  const afterUnavailable = after.books_unavailable ?? 0;
  if (afterUnavailable !== beforeUnavailable) {
    throw new Error(`${label}: unexpected books_unavailable notification count ${beforeUnavailable} -> ${afterUnavailable}`);
  }
}

async function assertUnavailableIncreased(dbName, before, label) {
  const after = await getNotificationCounts(dbName);
  const beforeUnavailable = before.notifications.books_unavailable ?? 0;
  const afterUnavailable = after.books_unavailable ?? 0;
  if (afterUnavailable <= beforeUnavailable) {
    throw new Error(`${label}: expected books_unavailable notification count to increase from ${beforeUnavailable}, got ${afterUnavailable}`);
  }
}

function assertTransferred(events, expected, label) {
  const seen = new Map(expected.bookIds.map((id) => [id, 0]));
  for (const entry of events) {
    if (entry.type !== "book:transferred") continue;
    if (entry.event.fromLibraryId !== expected.fromLibraryId || entry.event.toLibraryId !== expected.toLibraryId) continue;
    for (const id of entry.event.bookIds) {
      if (seen.has(id)) seen.set(id, seen.get(id) + 1);
    }
  }
  for (const [id, count] of seen) {
    if (count !== 1) {
      throw new Error(`${label}: expected exactly one transfer event for book ${id}, got ${count}. Events: ${JSON.stringify(events)}`);
    }
  }
}

function assertNoTransferFor(events, bookIds, label) {
  const ids = new Set(bookIds);
  const transfers = events.filter((entry) => entry.type === "book:transferred" && entry.event.bookIds.some((id) => ids.has(id)));
  if (transfers.length > 0) throw new Error(`${label}: unexpected transfer events ${JSON.stringify(transfers)}`);
}

function assertNoUnexpectedTransfers(events, bookIds) {
  const ids = new Set(bookIds);
  const transfers = events.filter((entry) => entry.type === "book:transferred" && entry.event.bookIds.some((id) => ids.has(id)));
  if (transfers.length > 0) throw new Error(`unexpected transfer events for deleted books ${JSON.stringify(transfers)}`);
}

function assertMissingEvent(events, bookId, libraryId, label) {
  const found = events.some((entry) => entry.type === "book:missing" && entry.event.libraryId === libraryId && entry.event.bookIds.includes(bookId));
  if (!found) throw new Error(`${label}: expected book:missing for book ${bookId}`);
}

function assertRestoredEvent(events, bookId, libraryId, label) {
  const found = events.some((entry) => entry.type === "book:restored" && entry.event.libraryId === libraryId && entry.event.bookIds.includes(bookId));
  if (!found) throw new Error(`${label}: expected book:restored for book ${bookId}`);
}

async function assertNoPresentDuplicateHashes(dbName) {
  const rows = await getRows(dbName);
  const byHash = new Map();
  for (const row of rows) {
    if (row.role !== "content" || row.status !== "present" || !row.file_hash) continue;
    const ids = byHash.get(row.file_hash) ?? new Set();
    ids.add(row.book_id);
    byHash.set(row.file_hash, ids);
  }
  const duplicates = [...byHash.entries()].filter(([, ids]) => ids.size > 1).map(([hash, ids]) => ({ hash, bookIds: [...ids] }));
  if (duplicates.length > 0) throw new Error(`present duplicate content hashes remain: ${JSON.stringify(duplicates)}`);
}

async function getRows(dbName) {
  const sql = `
    select coalesce(json_agg(t order by t.book_id, t.file_id), '[]'::json)
    from (
      select
        bf.role,
        b.status,
        b.id as book_id,
        bf.id as file_id,
        bf.rel_path,
        bf.file_hash,
        b.library_id,
        b.folder_path,
        l.name as library_name,
        bf.absolute_path
      from book_files bf
      inner join books b on b.id = bf.book_id
      inner join libraries l on l.id = b.library_id
    ) t
  `;
  return JSON.parse(await psql(dbName, sql));
}

async function getNotificationCounts(dbName) {
  const sql = `
    select coalesce(json_object_agg(type, count), '{}'::json)
    from (
      select type, count(*)::int as count
      from notifications
      group by type
    ) t
  `;
  return JSON.parse(await psql(dbName, sql));
}

async function psql(dbName, sql) {
  const { stdout } = await run("docker", ["exec", dbName, "psql", "-U", "bookorbit", "-d", "bookorbit", "-tA", "-c", sql], {
    timeout: 30000,
  });
  return stdout.trim();
}

async function api(baseUrl, path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} failed ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function waitForHealth(baseUrl) {
  await waitForCondition(
    async () => {
      try {
        const response = await fetch(`${baseUrl}/api/v1/health`);
        return response.ok;
      } catch {
        return false;
      }
    },
    `health ${baseUrl}`,
    90000,
  );
}

async function waitForPostgres(dbName) {
  await waitForCondition(
    async () => {
      const result = await run("docker", ["exec", dbName, "pg_isready", "-U", "bookorbit", "-d", "bookorbit"], {
        reject: false,
        timeout: 5000,
      });
      return result.exitCode === 0;
    },
    `postgres ${dbName}`,
    90000,
  );
}

async function waitForCondition(check, label, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function assertDockerAvailable() {
  await run("docker", ["version"], { timeout: 30000 });
}

async function printContainerLogs(containerName) {
  const result = await run("docker", ["logs", "--tail", "250", containerName], { reject: false, timeout: 30000 });
  if (result.stdout.trim()) console.error(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
}

async function cleanup(names, hostLib1, hostLib2) {
  await run("docker", ["rm", "-f", names.app], { reject: false });
  await run("docker", ["rm", "-f", names.db], { reject: false });
  await run("docker", ["volume", "rm", "-f", names.pgVolume, names.dataVolume], { reject: false });
  await run("docker", ["network", "rm", names.network], { reject: false });
  await rm(resolve(hostLib1, ".."), { recursive: true, force: true });
  await rm(resolve(hostLib2, ".."), { recursive: true, force: true });
  await removeEmptyRunRoot(hostRoots.lib1);
  await removeEmptyRunRoot(hostRoots.lib2);
}

async function removeEmptyRunRoot(root) {
  const runRoot = join(root, runId);
  try {
    const info = await stat(runRoot);
    if (!info.isDirectory()) return;
    await rm(runRoot, { recursive: true, force: true });
  } catch {
    return;
  }
}

async function run(command, commandArgs, options = {}) {
  try {
    const result = await execFileAsync(command, commandArgs, {
      cwd: options.cwd ?? repoRoot,
      timeout: options.timeout ?? 120000,
      maxBuffer: 1024 * 1024 * 20,
      ...(options.stdio ? { stdio: options.stdio } : {}),
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
    const exitCode = error.code ?? 1;
    if (options.reject === false) {
      return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode };
    }
    const stderr = error.stderr ? `\n${error.stderr}` : "";
    const stdout = error.stdout ? `\n${error.stdout}` : "";
    throw new Error(`${command} ${commandArgs.join(" ")} failed with ${exitCode}${stdout}${stderr}`);
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
