export function stripFragment(href: string): string {
  return href.split('#')[0]!
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function getCfiBody(cfi: string): string | null {
  const match = cfi.match(/epubcfi\(([^)]+)\)/i)
  return match?.[1] ?? null
}

export function formatCfiLocation(cfi: string | null | undefined): string | null {
  if (!cfi) return null

  const body = getCfiBody(cfi)
  if (!body) return null

  const spineStepMatch = body.match(/\/6\/(\d+)/)
  if (spineStepMatch) {
    const spineStep = Number(spineStepMatch[1])
    if (Number.isFinite(spineStep) && spineStep > 0) {
      return `Loc ${Math.max(1, Math.round(spineStep / 2))}`
    }
  }

  const compact = body.replace(/\s+/g, '')
  if (!compact) return null
  return `CFI ${compact.slice(0, 24)}${compact.length > 24 ? '...' : ''}`
}

export function getCfiSortKey(cfi: string | null | undefined): bigint | null {
  if (!cfi) return null
  const body = getCfiBody(cfi)
  if (!body) return null

  const numbers =
    body
      .match(/\d+/g)
      ?.map((value) => Number(value))
      .filter((value) => Number.isFinite(value)) ?? []
  if (numbers.length === 0) return null

  const normalized = numbers
    .slice(0, 8)
    .map((value) => Math.max(0, Math.floor(value)).toString().padStart(6, '0'))
    .join('')

  if (!normalized) return null
  return BigInt(normalized)
}

export function findNearestCfi<T extends { cfi: string | null | undefined }>(items: T[], currentCfi: string | null | undefined): T | null {
  const currentKey = getCfiSortKey(currentCfi)
  if (currentKey == null) return null

  let nearest: T | null = null
  let nearestDistance: bigint | null = null

  for (const item of items) {
    const key = getCfiSortKey(item.cfi)
    if (key == null) continue
    const distance = key >= currentKey ? key - currentKey : currentKey - key
    if (nearestDistance == null || distance < nearestDistance) {
      nearest = item
      nearestDistance = distance
    }
  }

  return nearest
}

interface CfiRange {
  spineStep: number
  startKey: bigint
  endKey: bigint
}

function pathToSortKey(path: string): bigint {
  const nums =
    path
      .replace(/\[[^\]]*\]/g, '')
      .match(/\d+/g)
      ?.map(Number)
      .filter(Number.isFinite) ?? []
  if (!nums.length) return 0n
  return BigInt(
    nums
      .slice(0, 8)
      .map((n) => Math.max(0, Math.floor(n)).toString().padStart(6, '0'))
      .join(''),
  )
}

function parseCfiRange(cfi: string): CfiRange | null {
  const body = getCfiBody(cfi)
  if (!body) return null

  const firstComma = body.indexOf(',')
  if (firstComma === -1) return null
  const secondComma = body.indexOf(',', firstComma + 1)
  if (secondComma === -1) return null

  const parentPath = body.slice(0, firstComma)
  const startRel = body.slice(firstComma + 1, secondComma)
  const endRel = body.slice(secondComma + 1)

  const spineMatch = parentPath.match(/\/6\/(\d+)/)
  const spineStep = spineMatch ? Number(spineMatch[1]) : -1

  const bangIdx = parentPath.indexOf('!')
  const contentBase = bangIdx !== -1 ? parentPath.slice(bangIdx + 1) : ''

  return {
    spineStep,
    startKey: pathToSortKey(contentBase + startRel),
    endKey: pathToSortKey(contentBase + endRel),
  }
}

export function cfiRangesOverlap(a: string, b: string): boolean {
  const ra = parseCfiRange(a)
  const rb = parseCfiRange(b)
  if (!ra || !rb) return false
  if (ra.spineStep !== rb.spineStep) return false
  return ra.startKey <= rb.endKey && ra.endKey >= rb.startKey
}

export function cfiRangesMatch(a: string, b: string): boolean {
  const ra = parseCfiRange(a)
  const rb = parseCfiRange(b)
  if (!ra || !rb) return false
  return ra.spineStep === rb.spineStep && ra.startKey === rb.startKey && ra.endKey === rb.endKey
}

export function findMatchingCfiRange<T extends { cfi: string | null | undefined }>(items: T[], selectedCfi: string | null | undefined): T | null {
  if (!selectedCfi) return null
  return items.find((item) => item.cfi != null && cfiRangesMatch(selectedCfi, item.cfi)) ?? null
}
