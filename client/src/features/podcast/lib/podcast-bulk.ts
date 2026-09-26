export interface PodcastBulkOutcome {
  completed: number
  failed: number
}

/**
 * Runs `action` across `items` with bounded concurrency and counts outcomes instead of failing fast,
 * so a partially successful batch can be reported honestly. A rejected action counts as failed;
 * resolving `false` means the item was skipped because it already had the requested state.
 */
export async function runBoundedBatch<T>(
  items: readonly T[],
  concurrency: number,
  action: (item: T) => Promise<boolean>,
): Promise<PodcastBulkOutcome> {
  let completed = 0
  let failed = 0
  for (let index = 0; index < items.length; index += concurrency) {
    const results = await Promise.allSettled(items.slice(index, index + concurrency).map(action))
    for (const result of results) {
      if (result.status === 'rejected') failed++
      else if (result.value) completed++
    }
  }
  return { completed, failed }
}
