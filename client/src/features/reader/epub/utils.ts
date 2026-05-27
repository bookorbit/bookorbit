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
