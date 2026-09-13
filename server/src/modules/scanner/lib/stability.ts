import { readdir, stat } from 'fs/promises';
import { join } from 'path';

const POLL_INTERVAL_MS = 3_000;
const STABLE_DURATION_MS = 10_000;
const MAX_WAIT_MS = 60_000;

// Files older than this are assumed stable — skip polling entirely.
const RECENTLY_MODIFIED_THRESHOLD_MS = 60_000;

/**
 * Wait until a file's mtime stops changing for STABLE_DURATION_MS.
 * Handles slow copies, P2P downloads, and network writes.
 * Skips the check entirely for files that haven't been touched in the last minute.
 * Returns silently if the file disappears — the caller handles the missing case.
 */
export async function waitForStability(absolutePath: string, knownMtimeMs?: number): Promise<void> {
  try {
    const mtimeMs = knownMtimeMs ?? (await stat(absolutePath)).mtimeMs;
    if (Date.now() - mtimeMs > RECENTLY_MODIFIED_THRESHOLD_MS) return;
  } catch {
    return;
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  let lastMtime = 0;
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    try {
      const s = await stat(absolutePath);
      if (s.mtimeMs !== lastMtime) {
        lastMtime = s.mtimeMs;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= STABLE_DURATION_MS) {
        return;
      }
    } catch {
      return;
    }

    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/**
 * How much of a dropped folder a single settle check will read. A release is books plus artwork,
 * not a filesystem, and the point here is only to notice that the tree stopped growing.
 */
const DIRECTORY_MAX_DEPTH = 6;
const DIRECTORY_MAX_ENTRIES = 5_000;

interface DirectorySnapshot {
  entries: number;
  sizeBytes: number;
  latestMtimeMs: number;
}

/**
 * Wait until a directory tree stops growing: no new entries and no size changes for
 * STABLE_DURATION_MS. The file version of this watches one mtime, which says nothing about a
 * folder still receiving its twentieth track.
 *
 * Same shortcut as {@link waitForStability}: a tree whose newest file has not been touched in the
 * last minute is already settled, so a rescan of an idle dock costs one walk rather than a wait.
 * Returns silently if the directory disappears - the caller handles the missing case.
 */
export async function waitForDirectoryStability(absolutePath: string): Promise<void> {
  let previous = await snapshotDirectory(absolutePath);
  if (!previous) return;
  if (Date.now() - previous.latestMtimeMs > RECENTLY_MODIFIED_THRESHOLD_MS) return;

  const deadline = Date.now() + MAX_WAIT_MS;
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));

    const current = await snapshotDirectory(absolutePath);
    if (!current) return;

    if (current.entries !== previous.entries || current.sizeBytes !== previous.sizeBytes || current.latestMtimeMs !== previous.latestMtimeMs) {
      previous = current;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= STABLE_DURATION_MS) {
      return;
    }
  }
}

async function snapshotDirectory(root: string): Promise<DirectorySnapshot | null> {
  const snapshot: DirectorySnapshot = { entries: 0, sizeBytes: 0, latestMtimeMs: 0 };
  let reachable = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > DIRECTORY_MAX_DEPTH || snapshot.entries >= DIRECTORY_MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    reachable = true;

    for (const entry of entries) {
      if (++snapshot.entries > DIRECTORY_MAX_ENTRIES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      try {
        const info = await stat(full);
        snapshot.sizeBytes += info.size;
        snapshot.latestMtimeMs = Math.max(snapshot.latestMtimeMs, info.mtimeMs);
      } catch {
        // A file that vanished between the listing and the stat is a change like any other.
      }
    }
  };

  await walk(root, 0);
  return reachable ? snapshot : null;
}
