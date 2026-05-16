import { describe, it, expect } from 'vitest'
import { resolveLucideIcon } from '../utils/resolveLucideIcon'
import { BookOpen, HelpCircle, Trophy, Flame } from 'lucide-vue-next'

describe('resolveLucideIcon', () => {
  it('resolves kebab-case icon name to component', () => {
    const icon = resolveLucideIcon('book-open')
    expect(icon).toBe(BookOpen)
  })

  it('returns HelpCircle for unknown icon', () => {
    const icon = resolveLucideIcon('nonexistent-icon-name')
    expect(icon).toBe(HelpCircle)
  })

  it('handles single-word icon names', () => {
    expect(resolveLucideIcon('trophy')).toBe(Trophy)
  })

  it('handles multi-segment icon names', () => {
    expect(resolveLucideIcon('flame')).toBe(Flame)
  })
})
