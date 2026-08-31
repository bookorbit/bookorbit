#!/usr/bin/env node
// Renumbers the MangaBaka migration to the end of the Drizzle journal and
// regenerates its snapshot after an upstream sync.
//
// Upstream adds migrations at the same index our MangaBaka migration occupies,
// so every sync conflicts in _journal.json (and the snapshot). This script
// resolves that conflict the same way the manual process did:
//
//   1. Resolve journal conflict markers (keep upstream entries, move MangaBaka last)
//   2. Renumber all entries and rename the MangaBaka SQL file to its new index
//   3. Delete the stale MangaBaka snapshot
//   4. Run `drizzle-kit generate` to produce a fresh snapshot from the schema
//   5. Drop the generated duplicate SQL, rename the generated snapshot to the
//      MangaBaka index, and fold its timestamp into the journal
//
// Usage (from repo root, after `git merge origin/main`):
//   node scripts/db/renumber-mangabaka-migration.mjs
//
// Options:
//   --migrations-dir <path>  migrations directory (default server/src/db/migrations)
//   --no-generate            skip drizzle-kit (for tests / dry inspection)
//   --dry-run                print actions without changing anything

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const MIGRATIONS_DIR = arg('--migrations-dir') ?? join(ROOT, 'server', 'src', 'db', 'migrations');
const NO_GENERATE = process.argv.includes('--no-generate');
const DRY_RUN = process.argv.includes('--dry-run');

const META_DIR = join(MIGRATIONS_DIR, 'meta');
const JOURNAL_PATH = join(META_DIR, '_journal.json');
const MANGABAKA_TAG = 'add_mangabaka_columns';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

function log(action, detail) {
  console.log(`[renumber-mangabaka] ${action}${detail ? `: ${detail}` : ''}`);
}

function apply(action, fn) {
  if (DRY_RUN) {
    log('would', action);
    return;
  }
  log('doing', action);
  fn();
}

// Resolve git conflict markers in the journal. Markers appear inside a JSON
// object (between the "version" and "breakpoints" lines of an entry), so the
// raw text is not valid JSON. Each side is completed by the surrounding normal
// segments, so we can reconstruct both full journals and merge them: keep
// upstream's (theirs) entries, then append our extra (MangaBaka) entries.
function resolveJournalConflicts(raw) {
  if (!raw.includes('<<<<<<<')) return JSON.parse(raw);

  const segments = [];
  let rest = raw;
  while (rest.includes('<<<<<<<')) {
    const headStart = rest.indexOf('<<<<<<<');
    const sepStart = rest.indexOf('=======', headStart);
    const endStart = rest.indexOf('>>>>>>>', sepStart);
    segments.push({ type: 'normal', text: rest.slice(0, headStart) });
    // Each marker line is "<<<<<<< <branch>" / "=======" / ">>>>>>> <branch>".
    // Consume the whole line (including the branch name and newline).
    const headLineEnd = rest.indexOf('\n', headStart);
    const sepLineEnd = rest.indexOf('\n', sepStart);
    const endLineEnd = rest.indexOf('\n', endStart);
    segments.push({ type: 'head', text: rest.slice(headLineEnd + 1, sepStart) });
    segments.push({ type: 'theirs', text: rest.slice(sepLineEnd + 1, endStart) });
    rest = endLineEnd === -1 ? '' : rest.slice(endLineEnd + 1);
  }
  segments.push({ type: 'normal', text: rest });

  const build = (side) => {
    let text = '';
    for (const seg of segments) {
      if (seg.type === 'normal' || seg.type === side) text += seg.text;
    }
    return JSON.parse(text);
  };

  const theirs = build('theirs');
  const ours = build('head');
  const theirsTags = new Set(theirs.entries.map((e) => e.tag));
  const extra = ours.entries.filter((e) => !theirsTags.has(e.tag));
  return { ...theirs, entries: [...theirs.entries, ...extra] };
}

function moveMangabakaToEnd(journal) {
  const mangabaka = journal.entries.find((e) => e.tag.includes(MANGABAKA_TAG));
  if (!mangabaka) throw new Error(`no migration matching *${MANGABAKA_TAG}* found in journal`);
  const rest = journal.entries.filter((e) => e.tag !== mangabaka.tag);
  return { ...journal, entries: [...rest, mangabaka] };
}

function renumber(journal) {
  return { ...journal, entries: journal.entries.map((e, i) => ({ ...e, idx: i })) };
}

function findMangabakaSql() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f.includes(MANGABAKA_TAG));
  if (files.length === 0) return null;
  if (files.length > 1) throw new Error(`multiple mangabaka migrations found: ${files.join(', ')}`);
  return join(MIGRATIONS_DIR, files[0]);
}

function snapshotHasMangabaka(snapshotPath) {
  if (!existsSync(snapshotPath)) return false;
  const snap = readJson(snapshotPath);
  const bm = snap.tables?.['public.book_metadata'];
  return bm?.columns?.mangabaka_id != null;
}

function verifyChain() {
  const journal = readJson(JOURNAL_PATH);
  const entries = journal.entries;
  for (let i = 0; i < entries.length; i += 1) {
    const prefix = String(i).padStart(4, '0');
    const snapPath = join(META_DIR, `${prefix}_snapshot.json`);
    if (!existsSync(snapPath)) throw new Error(`missing snapshot ${prefix}_snapshot.json for ${entries[i].tag}`);
  }
  // The script only guarantees the MangaBaka snapshot chains to the previous
  // one; earlier links are upstream's and may have pre-existing breaks.
  const last = entries[entries.length - 1];
  const lastPrefix = String(last.idx).padStart(4, '0');
  const prevPrefix = String(last.idx - 1).padStart(4, '0');
  const prev = readJson(join(META_DIR, `${prevPrefix}_snapshot.json`));
  const cur = readJson(join(META_DIR, `${lastPrefix}_snapshot.json`));
  if (cur.prevId !== prev.id) {
    throw new Error(`snapshot chain broken at ${lastPrefix}: prevId ${cur.prevId} != ${prev.id}`);
  }
  log('ok', `journal has ${entries.length} entries, MangaBaka snapshot chains to ${prevPrefix}`);
}

function main() {
  if (!existsSync(JOURNAL_PATH)) throw new Error(`journal not found: ${JOURNAL_PATH}`);

  const raw = readFileSync(JOURNAL_PATH, 'utf8');
  const hadConflicts = raw.includes('<<<<<<<');
  let journal = resolveJournalConflicts(raw);
  journal = moveMangabakaToEnd(journal);
  journal = renumber(journal);

  const mangabaka = journal.entries.find((e) => e.tag.includes(MANGABAKA_TAG));
  const prefix = String(mangabaka.idx).padStart(4, '0');
  const newTag = `${prefix}_add_mangabaka_columns`;
  const snapshotPath = join(META_DIR, `${prefix}_snapshot.json`);

  if (hadConflicts) log('info', 'journal had conflict markers; resolved by moving MangaBaka last');

  // Rename the SQL file to its new index.
  const oldSql = findMangabakaSql();
  const newSql = join(MIGRATIONS_DIR, `${newTag}.sql`);
  if (oldSql && oldSql !== newSql) {
    apply(`rename ${oldSql} -> ${newSql}`, () => renameSync(oldSql, newSql));
  }

  // Update the journal tag to match the new index.
  if (mangabaka.tag !== newTag) {
    apply(`retag journal entry ${mangabaka.tag} -> ${newTag}`, () => {
      mangabaka.tag = newTag;
    });
  }

  // If the snapshot is already valid and MangaBaka is last, nothing to regenerate.
  const isLast = mangabaka.idx === journal.entries.length - 1;
  if (isLast && snapshotHasMangabaka(snapshotPath)) {
    apply(`write journal (${journal.entries.length} entries)`, () => writeJson(JOURNAL_PATH, journal));
    log('ok', `MangaBaka migration already last at ${newTag} with a valid snapshot`);
    verifyChain();
    return;
  }

  // Delete the stale snapshot so drizzle-kit sees the schema delta.
  if (existsSync(snapshotPath)) {
    apply(`delete stale snapshot ${snapshotPath}`, () => rmSync(snapshotPath));
  }

  if (NO_GENERATE || DRY_RUN) {
    apply(`write journal (${journal.entries.length} entries)`, () => writeJson(JOURNAL_PATH, journal));
    log('ok', `MangaBaka migration renumbered to ${newTag} (snapshot not regenerated; run without --no-generate to finish)`);
    return;
  }

  // Build types (schema imports @bookorbit/types) then let drizzle-kit diff the schema.
  log('info', 'building @bookorbit/types and running drizzle-kit generate');
  execFileSync('pnpm', ['--filter', '@bookorbit/types', 'build'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('pnpm', ['--filter', 'server', 'drizzle-kit', 'generate'], { cwd: ROOT, stdio: 'inherit' });

  // drizzle-kit appended a generated entry at the end; fold it into MangaBaka.
  const generated = readJson(JOURNAL_PATH);
  const generatedEntry = generated.entries[generated.entries.length - 1];
  if (!generatedEntry || generatedEntry.tag === newTag) {
    throw new Error('drizzle-kit did not generate a new migration; schema may already be in sync');
  }
  const generatedPrefix = String(generatedEntry.idx).padStart(4, '0');
  const generatedSql = join(MIGRATIONS_DIR, `${generatedEntry.tag}.sql`);
  const generatedSnapshot = join(META_DIR, `${generatedPrefix}_snapshot.json`);

  apply(`delete generated duplicate SQL ${generatedSql}`, () => rmSync(generatedSql));
  apply(`rename generated snapshot ${generatedSnapshot} -> ${snapshotPath}`, () => renameSync(generatedSnapshot, snapshotPath));
  apply(`fold generated timestamp into journal entry ${newTag}`, () => {
    mangabaka.when = generatedEntry.when;
    journal.entries = journal.entries.filter((e) => e.tag !== generatedEntry.tag);
    writeJson(JOURNAL_PATH, journal);
  });

  log('ok', `MangaBaka migration renumbered to ${newTag} with regenerated snapshot`);
  verifyChain();
}

try {
  main();
} catch (err) {
  console.error(`[renumber-mangabaka] error: ${err.message}`);
  process.exitCode = 1;
}
