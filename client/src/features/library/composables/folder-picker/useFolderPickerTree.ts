import { computed, ref, watch } from 'vue'
import type { FolderListing, FolderListingEntry } from '@bookorbit/types'
import { normalizeFolderPath } from '../folder-paths'
import { ancestorsWithin, isAtOrInside, isInside, leafName } from './folder-picker-rules'
import type { FolderPickerData } from './useFolderPickerData'

export interface TreeRow {
  key: string
  /** `more`: a folder listed only in part, which says how to reach the rest. */
  type: 'folder' | 'new' | 'loading' | 'more'
  /** The folder itself; for the other rows, the folder they sit in. */
  path: string
  depth: number
  entry: FolderListingEntry
  /** A find match rather than a parent shown for context. */
  hit?: boolean
}

export type TreeSort = 'name' | 'books'

const segments = (path: string) => normalizeFolderPath(path).split('/').filter(Boolean)

function comparePaths(a: string, b: string): number {
  const left = segments(a)
  const right = segments(b)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = left[i]!.localeCompare(right[i]!, undefined, { sensitivity: 'base' })
    if (order !== 0) return order
  }
  return left.length - right.length
}

/**
 * The folder tree as flat rows for a virtual list, from the listings loaded so far. `pinned` lists
 * folders that stay reachable even under a hidden system folder: the ones picked or already read.
 */
export function useFolderPickerTree(data: FolderPickerData, pinned: () => string[] = () => []) {
  const expanded = ref<Set<string>>(new Set())
  const focus = ref<string | null>(null)
  const sort = ref<TreeSort>('name')
  const hideEmpty = ref(false)
  const showSystem = ref(false)
  const newFolderParent = ref<string | null>(null)
  /** Matching paths while finding by name; null when not finding. */
  const findResults = ref<string[] | null>(null)
  const findTruncated = ref(false)

  const root = computed(() => normalizeFolderPath(data.places.value?.root ?? '/'))

  const entries = computed(() => {
    const index = new Map<string, FolderListingEntry>()
    for (const listing of data.listings.values()) for (const entry of listing.entries) index.set(normalizeFolderPath(entry.path), entry)
    return index
  })

  function entryFor(path: string): FolderListingEntry {
    const key = normalizeFolderPath(path)
    return entries.value.get(key) ?? { name: leafName(key), path: key, mount: false, system: false, appData: false, hasChildren: null }
  }

  // A listing is sorted by name once; re-sorting thousands of rows on every keypress would lag.
  const nameOrder = new WeakMap<FolderListing, FolderListingEntry[]>()
  function byName(listing: FolderListing): FolderListingEntry[] {
    let sorted = nameOrder.get(listing)
    if (!sorted) {
      sorted = [...listing.entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      nameOrder.set(listing, sorted)
    }
    return sorted
  }

  /** Book files in a folder, or undefined while unknown: an unfinished count of zero is not an empty folder. */
  function knownFiles(path: string): number | undefined {
    const summary = data.summaries.get(normalizeFolderPath(path))
    if (!summary || (summary.truncated && summary.files === 0)) return undefined
    return summary.files
  }

  function visibleChildren(path: string): FolderListingEntry[] {
    const listing = data.listings.get(normalizeFolderPath(path))
    if (!listing) return []
    // Read only for the few entries that would otherwise be hidden, so focus moves do not re-sort the tree.
    let kept: string[] | null = null
    const keep = (entry: FolderListingEntry) => {
      kept ??= [focus.value, newFolderParent.value, ...pinned()].filter((folder): folder is string => !!folder)
      return kept.some((folder) => isAtOrInside(folder, entry.path))
    }
    const shown = byName(listing).filter(
      (entry) => ((showSystem.value || !entry.system) && (!hideEmpty.value || knownFiles(entry.path) !== 0)) || keep(entry),
    )
    if (sort.value !== 'books') return shown
    return [...shown].sort((a, b) => (knownFiles(b.path) ?? -1) - (knownFiles(a.path) ?? -1))
  }

  /** Whether a folder can be opened: known from its listing once loaded, else from its parent's listing. */
  function hasChildren(path: string): boolean {
    const listing = data.listings.get(normalizeFolderPath(path))
    if (listing) return visibleChildren(path).length > 0
    return entryFor(path).hasChildren !== false
  }

  const rows = computed<TreeRow[]>(() => {
    const out: TreeRow[] = []
    if (findResults.value) {
      const hits = new Set(findResults.value.map(normalizeFolderPath))
      const shown = new Set<string>()
      for (const hit of hits) {
        if (!isInside(hit, root.value)) continue
        shown.add(hit)
        for (const parent of ancestorsWithin(hit, root.value)) shown.add(parent)
      }
      const base = segments(root.value).length
      for (const path of [...shown].sort(comparePaths)) {
        out.push({ key: path, type: 'folder', path, depth: segments(path).length - base - 1, entry: entryFor(path), hit: hits.has(path) })
      }
      return out
    }
    const walk = (path: string, depth: number) => {
      if (newFolderParent.value === path) out.push({ key: `new:${path}`, type: 'new', path, depth, entry: entryFor(path) })
      for (const entry of visibleChildren(path)) {
        const child = normalizeFolderPath(entry.path)
        out.push({ key: child, type: 'folder', path: child, depth, entry })
        if (!expanded.value.has(child)) continue
        if (data.listings.has(child)) walk(child, depth + 1)
        else out.push({ key: `loading:${child}`, type: 'loading', path: child, depth: depth + 1, entry })
      }
      if (data.listings.get(path)?.truncated) out.push({ key: `more:${path}`, type: 'more', path, depth, entry: entryFor(path) })
    }
    walk(root.value, 0)
    return out
  })

  /** The one row reached with Tab: the focused folder, or the first one before anything is focused. */
  const tabStop = computed(() => {
    let first: string | null = null
    for (const row of rows.value) {
      if (row.type !== 'folder') continue
      if (row.path === focus.value) return row.path
      first ??= row.path
    }
    return first
  })

  const hiddenSystemCount = computed(() => {
    const listing = data.listings.get(root.value)
    if (showSystem.value || !listing) return 0
    return listing.entries.filter((entry) => entry.system).length - visibleChildren(root.value).filter((entry) => entry.system).length
  })

  function setExpanded(path: string, open: boolean) {
    const key = normalizeFolderPath(path)
    if (expanded.value.has(key) === open) return
    const next = new Set(expanded.value)
    if (open) next.add(key)
    else next.delete(key)
    expanded.value = next
  }

  /** Opens every folder above `path` and focuses it. */
  function reveal(path: string) {
    const key = normalizeFolderPath(path)
    expanded.value = new Set([...expanded.value, ...ancestorsWithin(key, root.value)])
    focus.value = key
  }

  // Listings load as their folders open.
  watch(
    [expanded, root, () => data.places.value],
    () => {
      if (!data.places.value) return
      void data.ensureListing(root.value)
      for (const path of expanded.value) if (!data.listings.has(path)) void data.ensureListing(path)
    },
    { immediate: true },
  )

  return {
    root,
    expanded,
    focus,
    sort,
    hideEmpty,
    showSystem,
    newFolderParent,
    findResults,
    findTruncated,
    rows,
    tabStop,
    hiddenSystemCount,
    entryFor,
    visibleChildren,
    hasChildren,
    setExpanded,
    reveal,
  }
}

export type FolderPickerTree = ReturnType<typeof useFolderPickerTree>
