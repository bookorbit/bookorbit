import { dirname, sep } from 'path';

const MAX_FAILURE_REASON_LENGTH = 300;
const ABSOLUTE_PATH = /(?<![\w.~-])\/(?:[^\s'"`/:]+\/)+([^\s'"`/:]+)/g;
const FFMPEG_CONTEXT_PREFIX = /\[[^\]]*@ 0x[0-9a-f]+\]\s*/gi;

/**
 * The reason a file write failed, safe to store and show.
 *
 * It is kept in the write log, returned by the write-log API, and sent in notifications. A failed
 * external tool reports its whole command line, every metadata value included, ahead of its own
 * output, and filesystem errors name absolute server paths. Only the tool's own output and file
 * names survive, capped in length.
 */
export function describeWriteFailure(error: unknown, filePath: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const raw = message.startsWith('Command failed:') ? toolOutput(error) || 'external tool failed' : message;
  return redactPaths(raw, filePath).replace(FFMPEG_CONTEXT_PREFIX, '').replace(/\s+/g, ' ').trim().slice(0, MAX_FAILURE_REASON_LENGTH);
}

function toolOutput(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  if (typeof stderr === 'string') return stderr.trim();
  if (Buffer.isBuffer(stderr)) return stderr.toString('utf8').trim();
  return '';
}

/** The book's own folder disappears, leaving file names; any other absolute path keeps only its last segment. */
function redactPaths(text: string, filePath: string): string {
  return text
    .split(`${dirname(filePath)}${sep}`)
    .join('')
    .replace(ABSOLUTE_PATH, '$1');
}
