import { describe, it, expect } from 'vitest'
import { resolveLucideIcon } from '../utils/resolveLucideIcon'
import {
  ArrowLeftRight,
  BookHeart,
  BookOpen,
  BookX,
  Flame,
  Gauge,
  Gavel,
  HelpCircle,
  Medal,
  Orbit,
  Palette,
  PenTool,
  Rabbit,
  Smartphone,
  Star,
  StarHalf,
  ThumbsDown,
  Trophy,
} from 'lucide-vue-next'

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

  it('resolves the new achievement icons without falling back to HelpCircle', () => {
    expect(resolveLucideIcon('gauge')).toBe(Gauge)
    expect(resolveLucideIcon('rabbit')).toBe(Rabbit)
    expect(resolveLucideIcon('book-heart')).toBe(BookHeart)
    expect(resolveLucideIcon('book-x')).toBe(BookX)
    expect(resolveLucideIcon('gavel')).toBe(Gavel)
    expect(resolveLucideIcon('star')).toBe(Star)
    expect(resolveLucideIcon('star-half')).toBe(StarHalf)
    expect(resolveLucideIcon('medal')).toBe(Medal)
    expect(resolveLucideIcon('thumbs-down')).toBe(ThumbsDown)
    expect(resolveLucideIcon('pen-tool')).toBe(PenTool)
    expect(resolveLucideIcon('palette')).toBe(Palette)
    expect(resolveLucideIcon('smartphone')).toBe(Smartphone)
    expect(resolveLucideIcon('orbit')).toBe(Orbit)
    expect(resolveLucideIcon('arrow-left-right')).toBe(ArrowLeftRight)
  })
})
