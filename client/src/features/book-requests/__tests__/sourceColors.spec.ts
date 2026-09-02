// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { INDEXER_COLORS } from '@bookorbit/types'
import { isIndexerColor, protocolChipClass, sourceChipClass, sourceDotClass } from '../sourceColors'

describe('sourceColors', () => {
  it('gives every colour in the palette its own token', () => {
    const tokens = INDEXER_COLORS.map((color) => sourceChipClass(color))

    expect(new Set(tokens).size).toBe(INDEXER_COLORS.length)
  })

  /** The state every source starts in, and the one the picker showed before colours existed. */
  it('leaves an unassigned source neutral', () => {
    expect(sourceChipClass(null)).toContain('text-muted-foreground')
    expect(sourceDotClass(null)).not.toContain('--pill-source')
  })

  /**
   * A row written by a newer build can name a hue this one has never heard of. Falling through to
   * neutral keeps that source readable; indexing the map blindly would have produced `undefined`
   * as a class and a chip with no border at all.
   */
  it('falls back to neutral for a colour it does not know', () => {
    expect(isIndexerColor('chartreuse')).toBe(false)
    expect(sourceChipClass('chartreuse' as never)).toBe(sourceChipClass(null))
  })

  it('keeps the two protocol hues out of the palette an operator can assign', () => {
    const assignable = INDEXER_COLORS.map((color) => sourceChipClass(color)).join(' ')

    expect(assignable).not.toContain('--pill-torrent')
    expect(assignable).not.toContain('--pill-direct')
    expect(protocolChipClass(true)).not.toBe(protocolChipClass(false))
  })
})
