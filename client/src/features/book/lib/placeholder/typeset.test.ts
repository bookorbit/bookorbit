// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { authorCandidates, cleanAuthor, fitBlock, parseBook, splitAuthors, type PlaceholderInput, type PlaceholderStrings } from './typeset'

const strings: PlaceholderStrings = {
  untitled: 'Untitled',
  volume: (n) => `Vol. ${n}`,
  family: (key) => key,
  list: new Intl.ListFormat('en', { style: 'short', type: 'conjunction' }),
}

const parse = (input: Partial<PlaceholderInput>) => parseBook({ title: null, seed: 'seed', ...input }, strings)
const SANS = { family: 'sans-serif', weight: 700 }

describe('parseBook', () => {
  it('lifts a trailing series parenthetical and turns a genre subtitle into a kicker', () => {
    const p = parse({ title: 'Delta: Rescue: A MacKenzie Family Novella (The MacKenzie Family)' })
    expect(p.main).toBe('Delta: Rescue')
    expect(p.kicker).toBe('A MacKenzie Family Novella')
    expect(p.series).toEqual({ name: 'The MacKenzie Family', index: null })
  })

  it('splits "Series 9: Title" into the series and the title', () => {
    const p = parse({ title: 'Blake Wilder FBI Mystery 9: Night at the Asylum' })
    expect(p.main).toBe('Night at the Asylum')
    expect(p.series).toEqual({ name: 'Blake Wilder FBI Mystery', index: '9' })
  })

  it('does not mistake a one-word name with a number for a series', () => {
    const p = parse({ title: 'Apollo 13: The Inside Story' })
    expect(p.main).toBe('Apollo 13')
    expect(p.subtitle).toBe('The Inside Story')
    expect(p.series).toBeNull()
  })

  it('keeps a title whose only colon follows a single word', () => {
    expect(parse({ title: '2001: A Space Odyssey' }).main).toBe('2001: A Space Odyssey')
  })

  it('shows a bare volume under its series', () => {
    const p = parse({ title: 'Vol. 12', seriesName: 'Delicious in Dungeon', seriesIndex: '12' })
    expect(p.main).toBe('Delicious in Dungeon')
    expect(p.volume).toBe('12')
    expect(p.series).toBeNull()
  })

  it('splits an issue number off a title that restates the series', () => {
    const p = parse({ title: 'Absolute Batman 018', seriesName: 'Absolute Batman', seriesIndex: '18' })
    expect(p.main).toBe('Absolute Batman')
    expect(p.volume).toBe('18')
  })

  it('merges a subtitle that repeats the one in the title', () => {
    const p = parse({ title: 'Social Engineering: The Art of Human Hacking', subtitle: 'The Art of Human Hacking' })
    expect(p.main).toBe('Social Engineering')
    expect(p.subtitle).toBe('The Art of Human Hacking')
  })

  it('drops a subtitle that only restates the series', () => {
    expect(parse({ title: 'Beartown', subtitle: 'Beartown, Book #1', seriesName: 'Beartown', seriesIndex: '1' }).subtitle).toBeNull()
  })

  it('falls back to the untitled label, and draws art alone for an empty title', () => {
    expect(parse({ title: null }).main).toBe('Untitled')
    expect(parse({ title: '' }).bare).toBe(true)
    expect(parse({ title: null }).bare).toBe(false)
  })

  it('detects right-to-left and CJK titles', () => {
    expect(parse({ title: 'ألف ليلة وليلة' }).script).toBe('rtl')
    expect(parse({ title: 'ハルコさんの彼氏' }).script).toBe('cjk')
  })
})

describe('authors', () => {
  it('flips sort-form names but keeps suffixes', () => {
    expect(cleanAuthor('Moore, Stephen L.')).toBe('Stephen L. Moore')
    expect(cleanAuthor('Kitamura,Katie')).toBe('Katie Kitamura')
    expect(cleanAuthor('King, Jr.')).toBe('King, Jr.')
    expect(cleanAuthor('The Pragmatic Bookshelf (62902)')).toBe('The Pragmatic Bookshelf')
  })

  it('splits several authors stored in one field', () => {
    expect(splitAuthors(['Marco Tranquillin, Valliappa Lakshmanan, and Firat Tekiner'])).toEqual([
      'Marco Tranquillin',
      'Valliappa Lakshmanan',
      'Firat Tekiner',
    ])
  })

  it('offers shorter credits as fallbacks', () => {
    expect(authorCandidates(parse({ authors: ['A', 'B'] }), strings.list)).toEqual(['A & B', 'A +1'])
    expect(authorCandidates(parse({ authors: ['A', 'B', 'C', 'D', 'E'] }), strings.list)).toEqual(['A & B +3', 'A +4'])
  })

  it('uses a preformatted credit as is when the list is unknown', () => {
    expect(authorCandidates(parse({ credit: 'Ezra Klein, Derek Thompson' }), strings.list)).toEqual(['Ezra Klein, Derek Thompson'])
  })
})

describe('fitBlock', () => {
  it('never splits an ordinary word across lines', () => {
    for (const title of ['Abundance', 'Angelmaker', 'Between Two Fires']) {
      const fit = fitBlock(title, SANS, { w: 100, h: 200 }, { min: 14, max: 60 })
      expect(fit.lines.some((line) => line.endsWith('-'))).toBe(false)
    }
  })

  it('stays inside the box unless it had to truncate', () => {
    for (const title of ['Run', 'A Discovery of Witches', 'An American Divorce', 'The Southern Book Club Guide to Slaying Vampires']) {
      const fit = fitBlock(title, SANS, { w: 300, h: 200 }, { min: 10, max: 90 })
      expect(fit.truncated).toBe(false)
      expect(fit.width).toBeLessThanOrEqual(300.001)
      expect(fit.height).toBeLessThanOrEqual(200.001)
    }
  })

  it('avoids ending a line on a small word', () => {
    const fit = fitBlock('A Discovery of Witches', SANS, { w: 200, h: 300 }, { min: 10, max: 60 })
    expect(fit.lines.slice(0, -1).some((line) => /\b(of|a|the)$/i.test(line))).toBe(false)
  })

  it('hyphenates only a word longer than any line can hold', () => {
    const fit = fitBlock('Supercalifragilisticexpialidocious', SANS, { w: 100, h: 200 }, { min: 10, max: 60 })
    expect(fit.L).toBeGreaterThan(1)
    expect(fit.lines[0]?.endsWith('-')).toBe(true)
  })

  it('truncates with an ellipsis rather than overflowing', () => {
    const fit = fitBlock('A Very Long Title That Will Never Fit In This Tiny Box At All', SANS, { w: 60, h: 30 }, { min: 12, max: 20, maxLines: 2 })
    expect(fit.truncated).toBe(true)
    expect(fit.lines.at(-1)?.endsWith('…')).toBe(true)
  })
})
