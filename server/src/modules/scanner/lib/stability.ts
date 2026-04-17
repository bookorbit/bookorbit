import { stat } from 'fs/promises';

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
