import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./renumber-mangabaka-migration.mjs', import.meta.url));

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const snapshot = (id, prevId) => JSON.stringify({ id, prevId, version: '7', dialect: 'postgresql', tables: {} });

// Build a fake migrations tree that mirrors the real post-merge state: a journal
// with conflict markers inside the MangaBaka entry (upstream added its own
// migration at the same index), the MangaBaka SQL file, and snapshots. Snapshot
// files are named by journal index (0000_snapshot.json, ...) like the real repo.
function makeMigrationsDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bookorbit-mig-renumber-'));
  const meta = path.join(dir, 'meta');
  mkdirSync(meta, { recursive: true });

  writeFileSync(path.join(meta, '0000_snapshot.json'), snapshot('id-0000', null));
  writeFileSync(path.join(meta, '0001_snapshot.json'), snapshot('id-0001', 'id-0000'));
  writeFileSync(path.join(meta, '0002_snapshot.json'), snapshot('id-0002-upstream', 'id-0001'));

  const conflictJournal = `{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 100,
      "tag": "0000_add_book_metadata_cover_updated_at",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "7",
      "when": 200,
      "tag": "0001_add_public_collections",
      "breakpoints": true
    },
    {
      "idx": 2,
      "version": "7",
<<<<<<< HEAD
      "when": 300,
      "tag": "0002_add_mangabaka_columns",
=======
      "when": 400,
      "tag": "0002_add_public_collections_extra",
>>>>>>> origin/main
      "breakpoints": true
    }
  ]
}
`;
  writeFileSync(path.join(meta, '_journal.json'), conflictJournal);

  writeFileSync(path.join(dir, '0002_add_mangabaka_columns.sql'), 'ALTER TABLE "book_metadata" ADD COLUMN "mangabaka_id" varchar(50);');
  writeFileSync(path.join(dir, '0002_add_public_collections_extra.sql'), 'ALTER TABLE "collections" ADD COLUMN "is_public" boolean;');

  return dir;
}

// Write conflict markers into the 0002 snapshot, mirroring the add/add conflict
// git produces when both sides created the same snapshot file.
function makeSnapshotConflict(dir) {
  const meta = path.join(dir, 'meta');
  const conflicted = `{
<<<<<<< HEAD
  "id": "id-0002-ours",
=======
  "id": "id-0002-upstream",
>>>>>>> origin/main
  "prevId": "id-0001",
  "version": "7",
  "dialect": "postgresql",
  "tables": {}
}
`;
  writeFileSync(path.join(meta, '0002_snapshot.json'), conflicted);
}

// A fake `pnpm` on PATH that simulates what drizzle-kit does: after the script
// writes the journal without MangaBaka, it appends a generated entry with a fresh
// timestamp plus a SQL file and snapshot, so the script can fold them in.
function makeFakePnpm(dir) {
  const bin = mkdtempSync(path.join(tmpdir(), 'bookorbit-mig-bin-'));
  const fake = path.join(bin, 'pnpm');
  const fakeDrizzle = path.join(bin, 'fake-drizzle.mjs');
  writeFileSync(
    fakeDrizzle,
    `import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.MIGRATIONS_DIR;
const meta = join(dir, 'meta');
const journal = JSON.parse(readFileSync(join(meta, '_journal.json'), 'utf8'));
const idx = journal.entries.length;
const prefix = String(idx).padStart(4, '0');
const when = Date.now();
const tag = prefix + '_generated_test';
journal.entries.push({ idx, version: '7', when, tag, breakpoints: true });
writeFileSync(join(meta, '_journal.json'), JSON.stringify(journal, null, 2) + '\\n');
writeFileSync(join(dir, tag + '.sql'), 'ALTER TABLE "book_metadata" ADD COLUMN "mangabaka_id" varchar(50);');
const prev = JSON.parse(readFileSync(join(meta, String(idx - 1).padStart(4, '0') + '_snapshot.json'), 'utf8'));
const snap = { id: 'gen-' + idx, prevId: prev.id, version: '7', dialect: 'postgresql', tables: {} };
writeFileSync(join(meta, prefix + '_snapshot.json'), JSON.stringify(snap, null, 2) + '\\n');
`,
  );
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
if [[ "$*" == *"@bookorbit/types"*"build"* ]]; then
  exit 0
fi
if [[ "$*" == *"exec"*"drizzle-kit"*"generate"* ]]; then
  node "${fakeDrizzle}"
  exit 0
fi
exit 1
`,
  );
  chmodSync(fake, 0o755);
  return bin;
}

const runScript = (dir, extraArgs = [], env = {}) =>
  execFileSync('node', [scriptPath, '--migrations-dir', dir, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

test('resolves the journal conflict and moves MangaBaka to the end', () => {
  const dir = makeMigrationsDir();
  try {
    const out = runScript(dir, ['--no-generate']);
    assert.match(out, /renumbered to 0003_add_mangabaka_columns/);

    const journal = readJson(path.join(dir, 'meta', '_journal.json'));
    assert.equal(journal.entries.length, 4);
    assert.equal(journal.entries[0].idx, 0);
    assert.equal(journal.entries[1].idx, 1);
    assert.equal(journal.entries[2].idx, 2);
    assert.equal(journal.entries[2].tag, '0002_add_public_collections_extra');
    assert.equal(journal.entries[3].idx, 3);
    assert.equal(journal.entries[3].tag, '0003_add_mangabaka_columns');
    assert.equal(journal.entries[3].when, 300);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renames the MangaBaka SQL file to its new index', () => {
  const dir = makeMigrationsDir();
  try {
    runScript(dir, ['--no-generate']);
    assert.ok(existsSync(path.join(dir, '0003_add_mangabaka_columns.sql')));
    assert.ok(!existsSync(path.join(dir, '0002_add_mangabaka_columns.sql')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dry-run makes no changes', () => {
  const dir = makeMigrationsDir();
  try {
    const before = readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8');
    runScript(dir, ['--dry-run']);
    const after = readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8');
    assert.equal(after, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolves the add/add snapshot conflict by keeping upstream side', () => {
  const dir = makeMigrationsDir();
  try {
    makeSnapshotConflict(dir);
    runScript(dir, ['--no-generate']);

    const resolved = readFileSync(path.join(dir, 'meta', '0002_snapshot.json'), 'utf8');
    assert.ok(!resolved.includes('<<<<<<<'), 'snapshot conflict markers must be gone');
    const snap = readJson(path.join(dir, 'meta', '0002_snapshot.json'));
    assert.equal(snap.id, 'id-0002-upstream', 'upstream snapshot must win the add/add conflict');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invokes drizzle-kit via pnpm exec, not a pnpm script name', () => {
  const source = readFileSync(scriptPath, 'utf8');
  // Regression: the script used to call `pnpm --filter server drizzle-kit generate`,
  // which fails because the server has no such script (it is `db:generate`).
  assert.match(source, /'exec', 'drizzle-kit', 'generate'/);
  assert.doesNotMatch(source, /'--filter', 'server', 'drizzle-kit', 'generate'/);
});

test('full run folds a fresh timestamp so journal ordering stays strict', () => {
  const dir = makeMigrationsDir();
  const bin = makeFakePnpm(dir);
  try {
    runScript(dir, [], { PATH: `${bin}:${process.env.PATH}`, MIGRATIONS_DIR: dir });

    const journal = readJson(path.join(dir, 'meta', '_journal.json'));
    assert.equal(journal.entries.length, 4);
    const last = journal.entries[journal.entries.length - 1];
    assert.equal(last.tag, '0003_add_mangabaka_columns');
    // The generated timestamp must be newer than upstream's newest entry.
    assert.ok(last.when > journal.entries[journal.entries.length - 2].when, 'MangaBaka timestamp must be newest');

    // Strictly increasing timestamps across the whole journal.
    for (let i = 1; i < journal.entries.length; i += 1) {
      assert.ok(
        journal.entries[i].when > journal.entries[i - 1].when,
        `entry ${i} (${journal.entries[i].tag}) must have a later timestamp than entry ${i - 1}`,
      );
    }

    // The generated duplicate SQL is gone and the snapshot is at the MangaBaka index.
    assert.ok(!existsSync(path.join(dir, '0003_generated_test.sql')));
    assert.ok(existsSync(path.join(dir, '0003_add_mangabaka_columns.sql')));
    assert.ok(existsSync(path.join(dir, 'meta', '0003_snapshot.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});
