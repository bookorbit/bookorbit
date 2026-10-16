// @vitest-environment node
import { PLACEHOLDER_COVER_STYLES } from '@bookorbit/types'
import { describe, expect, it } from 'vitest'
import { placeholderTier, renderPlaceholder, type PlaceholderInput, type PlaceholderStrings } from '.'
import { familyOf, paletteFor, weighted } from './palette'
import { hash, parseBook, rng } from './typeset'

const strings: PlaceholderStrings = {
  untitled: 'Untitled',
  volume: (n) => `Vol. ${n}`,
  family: (key) => key,
  list: new Intl.ListFormat('en', { style: 'short', type: 'conjunction' }),
}

const book: PlaceholderInput = {
  title: 'A Study in Scarlet',
  authors: ['Arthur Conan Doyle'],
  seriesName: 'Sherlock Holmes',
  seriesIndex: '1',
  genres: ['Mystery', 'Classics'],
  seed: 'study',
}

const SIZES = [
  { width: 36, height: 54 },
  { width: 64, height: 96 },
  { width: 134, height: 201 },
  { width: 272, height: 408 },
  { width: 156, height: 156 },
]

describe('renderPlaceholder', () => {
  it.each(PLACEHOLDER_COVER_STYLES)('draws %s at every size without throwing', (style) => {
    for (const size of SIZES) {
      const markup = renderPlaceholder(style, book, size, strings)
      expect(markup.startsWith('<svg')).toBe(true)
      expect(markup).toContain('aria-hidden="true"')
    }
  })

  it.each(PLACEHOLDER_COVER_STYLES)('escapes book text in %s', (style) => {
    const markup = renderPlaceholder(
      style,
      { ...book, title: '<img src=x onerror=alert(1)>', authors: ['"Quote" & <b>'] },
      { width: 200, height: 300 },
      strings,
    )
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('<b>')
    expect(markup).toContain('&lt;')
  })

  it.each(PLACEHOLDER_COVER_STYLES)('draws %s without any text for an empty title', (style) => {
    expect(renderPlaceholder(style, { ...book, title: '' }, { width: 134, height: 201 }, strings)).not.toContain('<text')
  })

  it('is deterministic for the same book', () => {
    const a = renderPlaceholder('bauhaus', book, { width: 134, height: 201 }, strings).replace(/pc[0-9a-z]+/g, '')
    const b = renderPlaceholder('bauhaus', book, { width: 134, height: 201 }, strings).replace(/pc[0-9a-z]+/g, '')
    expect(a).toBe(b)
  })

  it('switches to a monogram below 60px and drops extras below 100px', () => {
    expect(placeholderTier(40)).toBe('micro')
    expect(placeholderTier(80)).toBe('compact')
    expect(placeholderTier(134)).toBe('full')
  })
})

describe('palette', () => {
  it('reads the family from the first specific genre', () => {
    expect(familyOf(['Fiction', 'Fantasy', 'Romance'])).toBe('fantasy')
    expect(familyOf(['Fiction', 'Romance', 'Books'])).toBe('romance')
    expect(familyOf(['Fiction', 'Books'])).toBeNull()
  })

  const group = (input: Partial<PlaceholderInput>) => {
    const full = { title: null, seed: 'seed', ...input }
    return paletteFor(full, parseBook(full, strings))
  }

  it('groups a series, whoever wrote each volume', () => {
    const a = group({ title: 'Caliban Cove', authors: ['S.D. Perry'], seriesName: 'Resident Evil', seriesIndex: '2', seed: 'a' })
    const b = group({ title: 'Underworld', authors: ['Someone Else'], seriesName: 'Resident Evil', seriesIndex: '4', seed: 'b' })
    expect(a.group).toBe(b.group)
    expect(a.item).not.toBe(b.item)
  })

  it('finds the series inside the title too', () => {
    expect(group({ title: 'Blake Wilder FBI Mystery 9: Night at the Asylum', authors: ['Elle Gray'] }).group).toBe(
      group({ title: 'Blake Wilder FBI Mystery 2: The Silent Hour', authors: ['Elle Gray'] }).group,
    )
  })

  it("groups an author's standalones and separates different authors", () => {
    const one = group({ title: 'The Firm', authors: ['John Grisham'], seed: '1' })
    const two = group({ title: 'A Time to Kill', authors: ['Grisham, John'], seed: '2' })
    const other = group({ title: 'The Firm', authors: ['Someone Else'], seed: '1' })
    expect(one.group).toBe(two.group)
    expect(one.group).not.toBe(other.group)
  })

  it('falls back to the title when there is no series or author', () => {
    expect(group({ title: 'Arkham Asylum', seed: '1' }).group).toBe(group({ title: 'Arkham Asylum', seed: '2' }).group)
    expect(group({ title: 'Arkham Asylum' }).group).not.toBe(group({ title: 'Gotham' }).group)
  })

  it('keeps every cover but Paperback unchanged when genres arrive later', () => {
    const strip = (markup: string) => markup.replace(/pc[0-9a-z]+/g, '')
    for (const style of PLACEHOLDER_COVER_STYLES.filter((s) => s !== 'paperback')) {
      const before = renderPlaceholder(style, { ...book, genres: [] }, { width: 134, height: 201 }, strings)
      const after = renderPlaceholder(style, { ...book, genres: ['Horror', 'Thriller'] }, { width: 134, height: 201 }, strings)
      expect(strip(after)).toBe(strip(before))
    }
  })

  it('draws a fixed mix from the group generator', () => {
    const counts = { paper: 0, ink: 0, color: 0 }
    for (let i = 0; i < 3000; i++)
      counts[
        weighted(rng(hash(`author-${i}`)), [
          ['paper', 40],
          ['ink', 35],
          ['color', 25],
        ] as const)
      ]++
    expect(counts.paper / 3000).toBeCloseTo(0.4, 1)
    expect(counts.ink / 3000).toBeCloseTo(0.35, 1)
    expect(counts.color / 3000).toBeCloseTo(0.25, 1)
  })
})
