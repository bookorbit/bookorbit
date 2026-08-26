// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { applyCommonStem, commonStem, splitExtension, stemTail } from '../filename-stem'

const audiobook = Array.from({ length: 34 }, (_, index) => `01. The Three-Body Problem (2014)-Part${String(index + 2).padStart(2, '0')}.mp3`)

describe('commonStem', () => {
  it('hoists the stem a multi-part audiobook repeats on every track', () => {
    expect(commonStem(audiobook)).toBe('01. The Three-Body Problem (2014)')
  })

  it('survives a single outlier that shares no part suffix', () => {
    expect(commonStem([...audiobook, '01. The Three-Body Problem (2014).mp3'])).toBe('01. The Three-Body Problem (2014)')
  })

  it('cuts back to a word boundary so rows read Part02 rather than 02', () => {
    const stem = commonStem(audiobook)
    expect(stemTail(audiobook[0], stem)).toBe('Part02.mp3')
  })

  it('cuts a stem that ends at a separator to the whole token', () => {
    const names = ['Show - Episode 01.mp3', 'Show - Episode 02.mp3', 'Show - Episode 03.mp3', 'Show - Episode 10.mp3']
    expect(commonStem(names)).toBe('Show - Episode')
    expect(stemTail(names[0], commonStem(names))).toBe('01.mp3')
  })

  it('refuses a stem when the tails would only be extensions', () => {
    expect(commonStem(['Ticktock - Dean Koontz.azw3', 'Ticktock - Dean Koontz.epub', 'Ticktock - Dean Koontz.mobi'])).toBe('')
  })

  it('refuses a stem whose tails are all the same word', () => {
    expect(commonStem(['Ticktock - Dean Koontz.azw3', 'Ticktock - Dean Koontz.epub', 'Ticktock - Dean Koontz.lit'])).toBe('')
  })

  it('leaves short lists alone', () => {
    expect(commonStem(['Book (2007).epub', 'Book (2007).mobi'])).toBe('')
  })

  it('leaves unrelated names alone', () => {
    expect(commonStem(['cover.jpg', 'metadata.opf', 'Ticktock.epub'])).toBe('')
  })
})

describe('applyCommonStem', () => {
  it('shortens the names the stem fits and leaves the outlier whole', () => {
    const { stem, names } = applyCommonStem([...audiobook, '01. The Three-Body Problem (2014).mp3'])

    expect(stem).toBe('01. The Three-Body Problem (2014)')
    expect(names[0]).toEqual({ display: 'Part02.mp3', stem })
    expect(names.at(-1)).toEqual({ display: '01. The Three-Body Problem (2014).mp3', stem: '' })
  })

  it('returns every name untouched when there is no stem', () => {
    const names = ['Ticktock - Dean Koontz.epub', 'Ticktock - Dean Koontz.mobi', 'cover.jpg']
    expect(applyCommonStem(names).names.map((entry) => entry.display)).toEqual(names)
  })
})

describe('splitExtension', () => {
  it('keeps the extension separable so it cannot be truncated away', () => {
    expect(splitExtension('Ticktock - Dean Koontz.epub')).toEqual({ base: 'Ticktock - Dean Koontz', extension: '.epub' })
  })

  it('handles a name with no extension', () => {
    expect(splitExtension('Audiobook')).toEqual({ base: 'Audiobook', extension: '' })
  })
})
