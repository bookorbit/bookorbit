// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookCoverSlot, BookDetail } from '@bookorbit/types'
import { coverFieldMedium, coverFit, coverLockField, coverTileState, editorTiles, faceMedium, isLegacyCover, otherMedium } from '../cover-slots'

type SlotBook = Pick<BookDetail, 'coverMedia' | 'covers' | 'coverSource' | 'coverVersion'>

function slot(source: BookCoverSlot['source'], updatedAt: string): BookCoverSlot {
  return { source, updatedAt, width: null, height: null }
}

function book(overrides: Partial<SlotBook> = {}): SlotBook {
  return { coverMedia: ['ebook', 'audio'], covers: { ebook: null, audio: null }, coverSource: null, coverVersion: 'v', ...overrides }
}

describe('cover slots', () => {
  it('names the other medium and each slot lock', () => {
    expect(otherMedium('ebook')).toBe('audio')
    expect(otherMedium('audio')).toBe('ebook')
    expect(coverLockField('ebook')).toBe('cover')
    expect(coverLockField('audio')).toBe('audioCover')
    expect(coverLockField(null)).toBe('cover')
  })

  it('picks the face by library shape, falling back to the filled slot', () => {
    const both = book({ covers: { ebook: slot('extracted', 'a'), audio: slot('extracted', 'b') } })
    expect(faceMedium(both, '2/3')).toBe('ebook')
    expect(faceMedium(both, '1/1')).toBe('audio')

    const audioOnly = book({ covers: { ebook: null, audio: slot('extracted', 'b') } })
    expect(faceMedium(audioOnly, '2/3')).toBe('audio')

    expect(faceMedium(book(), '1/1')).toBe('audio')
  })

  it('gives one tile per medium, and one unnamed tile for a book with no content files', () => {
    expect(editorTiles(book({ coverMedia: ['audio', 'ebook'] }))).toEqual(['ebook', 'audio'])
    expect(editorTiles(book({ coverMedia: ['audio'] }))).toEqual(['audio'])
    expect(editorTiles(book({ coverMedia: [] }))).toEqual([null])
  })

  it('sends a metadata cover to the ebook slot unless the book has no ebook', () => {
    expect(coverFieldMedium(book())).toBe('ebook')
    expect(coverFieldMedium(book({ coverMedia: ['audio'] }))).toBe('audio')
    expect(coverFieldMedium(book({ coverMedia: [] }))).toBeNull()
  })

  it('recognises a cover the upgrade has not moved into a slot', () => {
    expect(isLegacyCover(book({ coverSource: 'custom' }))).toBe(true)
    expect(isLegacyCover(book({ coverSource: 'custom', covers: { ebook: slot('custom', 'a'), audio: null } }))).toBe(false)
    expect(isLegacyCover(book())).toBe(false)
  })

  it('describes a filled slot from the slot itself', () => {
    const state = coverTileState(book({ coverSource: 'custom', covers: { ebook: null, audio: slot('custom', 'b') } }), 'audio', '2/3')
    expect(state).toEqual({ hasImage: true, source: 'custom', version: 'b' })
  })

  it('shows an empty slot as empty', () => {
    const state = coverTileState(book({ coverSource: 'extracted', covers: { ebook: slot('extracted', 'a'), audio: null } }), 'audio', '2/3')
    expect(state).toEqual({ hasImage: false, source: null, version: 'v' })
  })

  it('puts a legacy cover on the face tile of a two-slot book, and on the only tile otherwise', () => {
    const legacy = book({ coverSource: 'custom', coverVersion: 'legacy:1' })
    expect(coverTileState(legacy, 'ebook', '2/3').hasImage).toBe(true)
    expect(coverTileState(legacy, 'audio', '2/3').hasImage).toBe(false)
    expect(coverTileState(legacy, 'audio', '1/1')).toEqual({ hasImage: true, source: 'custom', version: 'legacy:1' })

    const audioOnly = book({ coverMedia: ['audio'], coverSource: 'extracted', coverVersion: 'legacy:1' })
    expect(coverTileState(audioOnly, 'audio', '2/3').hasImage).toBe(true)

    const noFiles = book({ coverMedia: [], coverSource: 'extracted' })
    expect(coverTileState(noFiles, null, '2/3').hasImage).toBe(true)
  })

  it('fits square art to the audio slot and portrait art to the ebook slot', () => {
    expect(coverFit('square', 'audio')).toBe('match')
    expect(coverFit('portrait', 'audio')).toBe('mismatch')
    expect(coverFit('portrait', 'ebook')).toBe('match')
    expect(coverFit('square', 'ebook')).toBe('mismatch')
    expect(coverFit('unknown', 'audio')).toBe('unknown')
  })
})
