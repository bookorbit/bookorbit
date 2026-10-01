export type WordDiffKind = 'same' | 'removed' | 'added'

export interface WordDiffPart {
  kind: WordDiffKind
  text: string
}

export interface WordDiff {
  /** The old text, with the words the new one drops marked `removed`. */
  before: WordDiffPart[]
  /** The new text, with the words it adds marked `added`. */
  after: WordDiffPart[]
  /** Shared words over the longer side's word count, from 0 to 1. */
  similarity: number
}

/** Past this many table cells a diff costs more than it tells; two long descriptions are shown plain. */
const MAX_CELLS = 1_600_000

const TOKEN = /\S+|\s+/g
const isWord = (token: string) => /\S/.test(token)

function push(parts: WordDiffPart[], kind: WordDiffKind, text: string) {
  const last = parts[parts.length - 1]
  if (last && last.kind === kind) last.text += text
  else parts.push({ kind, text })
}

/**
 * A word-level diff by longest common subsequence. Whitespace always reads as unchanged, so a
 * highlight never starts or ends on a space. Returns null when the texts are too long to compare.
 */
export function wordDiff(before: string, after: string): WordDiff | null {
  const a = before.match(TOKEN) ?? []
  const b = after.match(TOKEN) ?? []
  const n = a.length
  const m = b.length
  if (n * m > MAX_CELLS) return null

  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const left: WordDiffPart[] = []
  const right: WordDiffPart[] = []
  let shared = 0
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(left, 'same', a[i]!)
      push(right, 'same', b[j]!)
      if (isWord(a[i]!)) shared += 1
      i += 1
      j += 1
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push(left, isWord(a[i]!) ? 'removed' : 'same', a[i]!)
      i += 1
    } else {
      push(right, isWord(b[j]!) ? 'added' : 'same', b[j]!)
      j += 1
    }
  }
  for (; i < n; i++) push(left, isWord(a[i]!) ? 'removed' : 'same', a[i]!)
  for (; j < m; j++) push(right, isWord(b[j]!) ? 'added' : 'same', b[j]!)

  const words = Math.max(a.filter(isWord).length, b.filter(isWord).length)
  return { before: left, after: right, similarity: words ? shared / words : 1 }
}
