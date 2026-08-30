import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./renumber-mangabaka-migration.mjs', import.meta.url));

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const snapshot = (id, prevId) => JSON.stringify({ id, prevId, version: '7', dialect: 'postgresql', tables: {} });

// Build a fake migrations tree that mirrors the real post-merge state: a journal
// with conflict markers inside the MangaBaka entry (upstream added its own
// migration at the same index), the MangaBaka SQL file, and snapshots.
function makeMigrationsDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bookorbit-mig-renumber-'));
  const meta = path.join(dir, 'meta');
  mkdirSync(meta, { recursive: true });

  writeFileSync(path.join(meta, '0080_snapshot.json'), snapshot('id-0080', 'id-0079'));
  writeFileSync(path.join(meta, '0081_snapshot.json'), snapshot('id-0081', 'id-0080'));
  writeFileSync(path.join(meta, '0082_snapshot.json'), snapshot('id-0082-upstream', 'id-0081'));

  const conflictJournal = `{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 80,
      "version": "7",
      "when": 100,
      "tag": "0080_add_book_metadata_cover_updated_at",
      "breakpoints": true
    },
    {
      "idx": 81,
      "version": "7",
      "when": 200,
      "tag": "0081_add_public_collections",
      "breakpoints": true
    },
    {
      "idx": 82,
      "version": "7",
<<<<<<< HEAD
      "when": 300,
      "tag": "0082_add_mangabaka_columns",
=======
      "when": 400,
      "tag": "0082_add_public_collections_extra",
>>>>>>> origin/main
      "breakpoints": true
    }
  ]
}
`;
  writeFileSync(path.join(meta, '_journal.json'), conflictJournal);

  writeFileSync(path.join(dir, '0082_add_mangabaka_columns.sql'), 'ALTER TABLE "book_metadata" ADD COLUMN "mangabaka_id" varchar(50);');
  writeFileSync(path.join(dir, '0082_add_public_collections_extra.sql'), 'ALTER TABLE "collections" ADD COLUMN "is_public" boolean;');

  return dir;
}

const runScript = (dir, extraArgs = []) =>
  execFileSync('node', [scriptPath, '--migrations-dir', dir, '--no-generate', ...extraArgs], { encoding: 'utf8' });

test('resolves the journal conflict and moves MangaBaka to the end', () => {
  const dir = makeMigrationsDir();
  try {
    const out = runScript(dir);
    assert.match(out, /renumbered to 0003_add_mangabaka_columns/);

    const journal = readJson(path.join(dir, 'meta', '_journal.json'));
    assert.equal(journal.entries.length, 4);
    assert.equal(journal.entries[0].idx, 0);
    assert.equal(journal.entries[1].idx, 1);
    assert.equal(journal.entries[2].idx, 2);
    assert.equal(journal.entries[2].tag, '0082_add_public_collections_extra');
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
    runScript(dir);
    assert.ok(existsSync(path.join(dir, '0003_add_mangabaka_columns.sql')));
    assert.ok(!existsSync(path.join(dir, '0082_add_mangabaka_columns.sql')));
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
