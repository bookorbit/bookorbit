/**
 * Path diff for Bulk Rename.
 *
 * A rename is almost always a small edit inside a long path: `Helen  Fitzgerald` becomes
 * `Helen FitzGerald`, or a series folder disappears. Printing the old and new paths side by
 * side hides that edit, so everything here exists to locate and mark it precisely.
 */

export type DiffOpKind = 'eq' | 'del' | 'ins'

export interface DiffOp {
  kind: DiffOpKind
  value: string
}

export type PathRowKind = 'eq' | 'edit' | 'del' | 'ins'

export interface PathRow {
  kind: PathRowKind
  /** Segment as it exists today. `null` for a segment that only exists after the rename. */
  from: string | null
  /** Segment as it will exist. `null` for a segment that is removed. */
  to: string | null
  /** Character-level runs for an edited segment. */
  ops?: DiffOp[]
}

/** Longest common subsequence, walked into an edit script. Inputs here are always short. */
function lcs<T>(a: readonly T[], b: readonly T[]): { kind: DiffOpKind; value: T }[] {
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  const ops: { kind: DiffOpKind; value: T }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'eq', value: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: 'del', value: a[i]! })
      i++
    } else {
      ops.push({ kind: 'ins', value: b[j]! })
      j++
    }
  }
  while (i < n) ops.push({ kind: 'del', value: a[i++]! })
  while (j < m) ops.push({ kind: 'ins', value: b[j++]! })
  return ops
}

function coalesce(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = []
  for (const op of ops) {
    const last = out[out.length - 1]
    if (last && last.kind === op.kind) last.value += op.value
    else out.push({ ...op })
  }
  return out
}

/** Words plus the separators between them, so a diff lands on boundaries a reader recognises. */
function tokenize(value: string): string[] {
  return value.match(/[^\s._\-()[\]{},:;'"!?&/]+|[\s._\-()[\]{},:;'"!?&/]+/g) ?? []
}

/** Rough similarity, used to decide whether a removed/added run is one edited word or two words. */
function isSimilar(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return a.trim() === b.trim()
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (long.length > 3 * short.length) return false
  const pool = [...short.toLowerCase()]
  let hits = 0
  for (const ch of long.toLowerCase()) {
    const at = pool.indexOf(ch)
    if (at !== -1) {
      pool.splice(at, 1)
      hits++
    }
  }
  return hits / long.length >= 0.55
}

/**
 * Diff of one path segment, at word level and refined to characters where a run of words was
 * edited in place.
 *
 * Character LCS alone finds alignments that are optimal but unreadable: reordering
 * `Katie Kitamura` into `Kitamura, Katie` comes out as confetti. Word diff alone is readable
 * but too coarse to show that `Fitzgerald` lost a single capital. Doing words first and
 * recursing into similar runs gives both.
 */
export function diffSegment(a: string, b: string): DiffOp[] {
  const words = lcs(tokenize(a), tokenize(b))
  const out: DiffOp[] = []

  let i = 0
  while (i < words.length) {
    if (words[i]!.kind === 'eq') {
      out.push({ kind: 'eq', value: words[i]!.value })
      i++
      continue
    }

    let j = i
    while (j < words.length && words[j]!.kind !== 'eq') j++
    const run = words.slice(i, j)
    let removed = run
      .filter((op) => op.kind === 'del')
      .map((op) => op.value)
      .join('')
    let added = run
      .filter((op) => op.kind === 'ins')
      .map((op) => op.value)
      .join('')

    // Peel any shared head and tail first: " (2007)." against "." is a deletion, not a swap.
    let head = 0
    while (head < removed.length && head < added.length && removed[head] === added[head]) head++
    let tail = 0
    while (tail < removed.length - head && tail < added.length - head && removed[removed.length - 1 - tail] === added[added.length - 1 - tail]) {
      tail++
    }
    const prefix = removed.slice(0, head)
    const suffix = removed.slice(removed.length - tail)
    removed = removed.slice(head, removed.length - tail)
    added = added.slice(head, added.length - tail)

    if (prefix) out.push({ kind: 'eq', value: prefix })
    if (removed && added) {
      if (isSimilar(removed, added)) {
        out.push(...lcs([...removed], [...added]).map((op) => ({ kind: op.kind, value: op.value })))
      } else {
        out.push({ kind: 'del', value: removed }, { kind: 'ins', value: added })
      }
    } else if (removed) {
      out.push({ kind: 'del', value: removed })
    } else if (added) {
      out.push({ kind: 'ins', value: added })
    }
    if (suffix) out.push({ kind: 'eq', value: suffix })

    i = j
  }

  return coalesce(out)
}

/**
 * Segment-level diff of two paths.
 *
 * Exact-match LCS is the wrong aligner here: when a folder level is dropped every remaining
 * segment also changes, so nothing matches and the result is a pile of unrelated adds and
 * removes. Anchoring on the exactly-equal head and tail and then pairing what is left from the
 * filename backwards recovers the real correspondence.
 */
export function diffPath(fromPath: string, toPath: string): PathRow[] {
  const a = splitSegments(fromPath)
  const b = splitSegments(toPath)

  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++

  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)

  const rows: PathRow[] = a.slice(0, head).map((value) => ({ kind: 'eq', from: value, to: value }))

  // Pair the middles from the end, because the filename is the stable anchor.
  const paired = Math.min(midA.length, midB.length)
  for (const value of midA.slice(0, midA.length - paired)) rows.push({ kind: 'del', from: value, to: null })
  for (const value of midB.slice(0, midB.length - paired)) rows.push({ kind: 'ins', from: null, to: value })
  for (let k = 0; k < paired; k++) {
    const from = midA[midA.length - paired + k]!
    const to = midB[midB.length - paired + k]!
    rows.push(from === to ? { kind: 'eq', from, to } : { kind: 'edit', from, to, ops: diffSegment(from, to) })
  }

  for (const value of a.slice(a.length - tail)) rows.push({ kind: 'eq', from: value, to: value })
  return rows
}

/** Path split into displayable segments, discarding the empty parts a leading or doubled slash produces. */
function splitSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0)
}

/** Normalise separators and drop a trailing slash, so two spellings of a path compare equal. */
function normalizePath(value: string): string {
  const collapsed = value.replace(/\\/g, '/').replace(/\/+/g, '/')
  return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed
}

/** Path with the library root removed, so every row starts at the part that can differ. */
export function stripRoot(path: string, roots: readonly string[]): string {
  const normalized = normalizePath(path)
  const match = roots
    .map(normalizePath)
    .sort((a, b) => b.length - a.length)
    .find((root) => normalized === root || normalized.startsWith(`${root}/`))

  if (!match) return normalized
  if (normalized === match) return '.'
  return normalized.slice(match.length + 1)
}
