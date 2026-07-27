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
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };

    output.once('close', done);
    output.once('error', done);

    if (typeof output.destroy === 'function') output.destroy();
    else done();
  });
}
