/**
 * Ids in the user's stored order, with every id the stored order does not mention placed after its
 * nearest default predecessor. A row added in a later release then lands beside the rows it ships
 * next to instead of at the end, and stale ids for rows that no longer exist drop out.
 */
export function arrangeIds(defaults: readonly string[], stored: readonly string[] = []): string[] {
  const known = new Set(defaults)
  const result = stored.filter((id, index) => known.has(id) && stored.indexOf(id) === index)
  defaults.forEach((id, index) => {
    if (result.includes(id)) return
    let at = 0
    for (let previous = index - 1; previous >= 0; previous--) {
      const position = result.indexOf(defaults[previous] as string)
      if (position !== -1) {
        at = position + 1
        break
      }
    }
    result.splice(at, 0, id)
  })
  return result
}

/**
 * Writes a reordered subset back into the full order. Ids outside the subset (rows a permission
 * hides right now) keep their slots, so reordering what is on screen never scrambles what is not.
 */
export function mergeSubsetOrder(full: readonly string[], subset: readonly string[]): string[] {
  const inSubset = new Set(subset)
  let next = 0
  return full.map((id) => (inSubset.has(id) ? (subset[next++] as string) : id))
}

export type SidebarBlockKind = 'nav' | 'list'

export interface SidebarRun<T> {
  kind: SidebarBlockKind
  blocks: T[]
}

/**
 * Splits the arranged groups into runs of one kind. A separator goes between runs, so nav groups
 * read as one block and list sections as another wherever the user moves them.
 */
export function groupRuns<T extends { kind: SidebarBlockKind }>(blocks: readonly T[]): SidebarRun<T>[] {
  const runs: SidebarRun<T>[] = []
  for (const block of blocks) {
    const last = runs[runs.length - 1]
    if (last && last.kind === block.kind) last.blocks.push(block)
    else runs.push({ kind: block.kind, blocks: [block] })
  }
  return runs
}
