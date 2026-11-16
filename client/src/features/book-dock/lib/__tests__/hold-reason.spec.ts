import { describe, expect, it } from 'vitest'
import { BOOK_DOCK_HOLD_REASONS } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { HOLD_REASON_ORDER, holdChipText, holdReasonLabel, holdStyle } from '../hold-reason'

const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {})

describe('hold reasons', () => {
  it('orders, words and styles every reason the server sends', () => {
    expect([...HOLD_REASON_ORDER].sort()).toEqual([...BOOK_DOCK_HOLD_REASONS].sort())
    for (const reason of BOOK_DOCK_HOLD_REASONS) {
      expect(holdReasonLabel(reason, t)).not.toContain('bookDock.')
      expect(holdStyle(reason).icon).toBeTruthy()
    }
  })

  it('reads an unknown reason as a plain wait', () => {
    expect(holdReasonLabel('newer_reason', t)).toBe('Waiting for review')
    expect(holdStyle('newer_reason').tone).toBe('grey')
  })

  it('puts the facts in the chip when the server sent them, and the short name when not', () => {
    expect(holdChipText({ holdReason: 'duplicate', holdDetail: { libraryName: 'Fiction' } }, t)).toBe('Already in Fiction')
    expect(holdChipText({ holdReason: 'unsupported_layout', holdDetail: { libraryName: 'Comics' } }, t)).toBe("Doesn't fit Comics")
    expect(holdChipText({ holdReason: 'low_confidence', holdDetail: null }, t)).toBe('Low match')
    expect(holdChipText({ holdReason: null, holdDetail: null }, t)).toBe('')
  })
})
