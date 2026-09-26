import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('useCoverVersions', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-01T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function load() {
    const mod = await import('../useCoverVersions')
    return mod.useCoverVersions()
  }

  it('returns base thumbnail URL when no version is stored', async () => {
    const { coverUrl } = await load()
    expect(coverUrl(42)).toBe('/api/v1/books/42/thumbnail')
  })

  it('returns base cover URL when type is cover and no version is stored', async () => {
    const { coverUrl } = await load()
    expect(coverUrl(42, 'cover')).toBe('/api/v1/books/42/cover')
  })

  it('returns versioned thumbnail URL after bumpVersion', async () => {
    const { coverUrl, bumpVersion } = await load()
    bumpVersion(42)
    const now = Date.now()
    expect(coverUrl(42)).toBe(`/api/v1/books/42/thumbnail?t=${now}`)
  })

  it('returns versioned cover URL after bumpVersion', async () => {
    const { coverUrl, bumpVersion } = await load()
    bumpVersion(7)
    const now = Date.now()
    expect(coverUrl(7, 'cover')).toBe(`/api/v1/books/7/cover?t=${now}`)
  })

  it('uses a server-provided timestamp as a cover version', async () => {
    const { coverUrl } = await load()
    expect(coverUrl(42, 'thumbnail', '2026-05-01T12:00:00.000Z')).toBe('/api/v1/books/42/thumbnail?t=1777636800000')
  })

  it('preserves opaque server cover versions in the URL', async () => {
    const { coverUrl } = await load()
    expect(coverUrl(42, 'cover', 'ebook:2026-09-23T12:34:56.000Z:-')).toBe('/api/v1/books/42/cover?t=ebook%3A2026-09-23T12%3A34%3A56.000Z%3A-')
  })

  it('requests an explicit cover medium without losing the version', async () => {
    const { coverUrl } = await load()
    expect(coverUrl(42, 'cover', 'slot-version', 'audio')).toBe('/api/v1/books/42/cover?t=slot-version&medium=audio')
    expect(coverUrl(42, 'thumbnail', undefined, 'audio')).toBe('/api/v1/books/42/thumbnail?medium=audio')
  })

  it('combines local and server versions when both are present', async () => {
    const { coverUrl, bumpVersion } = await load()
    bumpVersion(42)
    const now = Date.now()
    expect(coverUrl(42, 'thumbnail', '2020-01-01T00:00:00.000Z')).toBe(`/api/v1/books/42/thumbnail?t=1577836800000-${now}`)
  })

  it('does not add ?t= to a different book that was not bumped', async () => {
    const { coverUrl, bumpVersion } = await load()
    bumpVersion(1)
    expect(coverUrl(2)).toBe('/api/v1/books/2/thumbnail')
  })

  it('getVersion returns undefined before any bump', async () => {
    const { getVersion } = await load()
    expect(getVersion(99)).toBeUndefined()
  })

  it('getVersion returns the stored timestamp after bumpVersion', async () => {
    const { getVersion, bumpVersion } = await load()
    bumpVersion(5)
    expect(getVersion(5)).toBe(Date.now())
  })

  it('bumpVersion with a later timestamp overwrites the earlier one', async () => {
    const { coverUrl, bumpVersion } = await load()
    bumpVersion(3)
    const t1 = Date.now()

    vi.advanceTimersByTime(1000)
    bumpVersion(3)
    const t2 = Date.now()

    expect(t2).toBeGreaterThan(t1)
    expect(coverUrl(3)).toBe(`/api/v1/books/3/thumbnail?t=${t2}`)
  })

  it('singleton: versions bumped in one composable instance are visible in another', async () => {
    const mod = await import('../useCoverVersions')
    const a = mod.useCoverVersions()
    const b = mod.useCoverVersions()

    a.bumpVersion(10)
    expect(b.coverUrl(10)).toBe(`/api/v1/books/10/thumbnail?t=${Date.now()}`)
  })

  it('persists bumped version to localStorage', async () => {
    const { bumpVersion } = await load()
    bumpVersion(11)
    const stored = JSON.parse(localStorage.getItem('cover-versions-v2') ?? '[]') as [number, number][]
    expect(stored).toContainEqual([11, Date.now()])
  })

  it('loads pre-existing versions from localStorage on init', async () => {
    const ts = Date.now()
    localStorage.setItem('cover-versions-v2', JSON.stringify([[20, ts]]))
    const { coverUrl } = await load()
    expect(coverUrl(20)).toBe(`/api/v1/books/20/thumbnail?t=${ts}`)
  })

  it('does not reuse cover bumps from the pre-slot storage key', async () => {
    localStorage.setItem('cover-versions', JSON.stringify([[20, Date.now()]]))
    const { coverUrl } = await load()
    expect(coverUrl(20)).toBe('/api/v1/books/20/thumbnail')
  })

  it('returns empty map when localStorage contains corrupt data', async () => {
    localStorage.setItem('cover-versions-v2', 'not-json')
    const { coverUrl } = await load()
    expect(coverUrl(1)).toBe('/api/v1/books/1/thumbnail')
  })

  it('handles localStorage setItem quota errors silently', async () => {
    const { bumpVersion, coverUrl } = await load()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => bumpVersion(7)).not.toThrow()
    expect(coverUrl(7)).toBe(`/api/v1/books/7/thumbnail?t=${Date.now()}`)
  })
})
