export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be greater than zero');
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Worker-pool map that keeps at most `limit` operations in flight and returns
 * results in input order. Preferred over chunked Promise.all when per-item cost
 * varies, because a slow item does not stall the whole chunk.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let index = nextIndex++; index < items.length; index = nextIndex++) {
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Two-stage pipeline: `ordered` runs for one item at a time in input order, and each item's
 * `parallel` stage runs for up to `limit` items at once, overlapping the ordered stage of the items
 * after it. An item whose ordered stage finished always gets its parallel stage. After any failure
 * no further item starts; the call waits for the stages already running, then rejects with the
 * first error.
 */
export async function pipelineWithConcurrency<T, S>(
  items: readonly T[],
  limit: number,
  ordered: (item: T, index: number) => Promise<S>,
  parallel: (staged: S, item: T, index: number) => Promise<void>,
): Promise<void> {
  const running = new Set<Promise<void>>();
  const slots = Math.max(1, limit);
  // Asserted rather than annotated: set from callbacks, so flow narrowing to null would be wrong.
  let failure = null as { error: unknown } | null;
  const fail = (error: unknown) => {
    failure ??= { error };
  };

  try {
    for (const [index, item] of items.entries()) {
      while (running.size >= slots && !failure) await Promise.race(running);
      if (failure) break;
      const staged = await ordered(item, index);
      const task: Promise<void> = parallel(staged, item, index)
        .catch(fail)
        .finally(() => running.delete(task));
      running.add(task);
    }
  } catch (error) {
    fail(error);
  } finally {
    await Promise.all(running);
  }
  if (failure) throw failure.error;
}
