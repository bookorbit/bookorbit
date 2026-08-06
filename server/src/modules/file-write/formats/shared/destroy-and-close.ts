import type { Writable } from 'stream';

/**
 * Destroys a write stream and resolves once it has actually closed.
 *
 * Needed before unlinking a temp file the stream owns: on Windows an open handle
 * makes the unlink fail, and best-effort cleanup would swallow that and leave the
 * partial file behind.
 */
export async function destroyAndClose(output: Writable): Promise<void> {
  if ((output as Writable & { closed?: boolean }).closed) return;

  await new Promise<void>((resolve) => {
    // Resolve only from 'close'. An 'error' can arrive first, and resolving on it would let
    // the caller unlink while the handle is still open, which is the exact failure this
    // helper exists to prevent. Node still emits 'close' after 'error' once the stream is
    // destroyed, so the error listener only needs to stop the event going unhandled.
    output.once('close', () => resolve());
    output.once('error', () => {});

    if (typeof output.destroy === 'function') output.destroy();
    else resolve();
  });
}
