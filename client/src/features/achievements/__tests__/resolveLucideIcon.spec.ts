import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveLucideIcon } from '../utils/resolveLucideIcon'
import {
  ArrowLeftRight,
  BookHeart,
  BookMarked,
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
} from '@lucide/vue'

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

  it('resolves book-marked, which lucide ships only as an alias', () => {
    expect(resolveLucideIcon('book-marked')).toBe(BookMarked)
  })

  it('resolves every icon the server seeds, so no achievement draws the fallback', () => {
    const seed = readFileSync(resolve(process.cwd(), '../server/src/modules/achievement/seed/achievement-seed.ts'), 'utf8')
    const names = [...new Set([...seed.matchAll(/iconName: '([^']+)'/g)].map((match) => match[1]!))]

    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => resolveLucideIcon(name) === HelpCircle)).toEqual([])
  })
})
