import { describe, expect, it } from 'vitest'
import { LUCIDE_ICON_FILES, LUCIDE_VERSION } from 'virtual:lucide-icon-index'
import { LUCIDE_PICKER_NAMES } from 'virtual:lucide-icon-names'
import { lucideCatalogHref, lucideIconHref, resolveLucideIconFile } from './lucide-icons'

// Collection icons the released iOS app writes; they must keep resolving on the web.
const IOS_COLLECTION_ICONS = [
  'FolderOpen',
  'Star',
  'Heart',
  'BookOpen',
  'Bookmark',
  'Library',
  'Sparkles',
  'Tag',
  'Gift',
  'Flame',
  'Crown',
  'Coffee',
  'Moon',
  'Sun',
  'Headphones',
  'Glasses',
  'GraduationCap',
  'Briefcase',
  'Globe',
  'Zap',
  'Compass',
  'Map',
  'Ghost',
  'Rocket',
]

describe('resolveLucideIconFile', () => {
  it('maps a component name to its icon file', () => {
    expect(resolveLucideIconFile('FolderOpen')).toBe('folder-open')
    expect(resolveLucideIconFile('ArrowDown01')).toBe('arrow-down-0-1')
  })

  it('maps the old name of a renamed icon to the current file', () => {
    expect(resolveLucideIconFile('AlertTriangle')).toBe('triangle-alert')
  })

  it('accepts the Icon-suffixed and Lucide-prefixed export forms', () => {
    expect(resolveLucideIconFile('FolderOpenIcon')).toBe('folder-open')
    expect(resolveLucideIconFile('LucideFolderOpen')).toBe('folder-open')
  })

  it.each([null, undefined, '', 'NotAnIcon1234', 'folder-open', 'custom:my-star', 'Icon', 'LUCIDE_CONTEXT'])('resolves %s to nothing', (name) => {
    expect(resolveLucideIconFile(name)).toBeNull()
  })

  it('resolves every name the picker offers', () => {
    const files = new Set(LUCIDE_ICON_FILES)
    const unresolved = LUCIDE_PICKER_NAMES.filter((name) => !files.has(resolveLucideIconFile(name) ?? ''))
    expect(LUCIDE_PICKER_NAMES.length).toBeGreaterThan(LUCIDE_ICON_FILES.length)
    expect(unresolved).toEqual([])
  })

  it('resolves every collection icon the iOS app stores', () => {
    expect(IOS_COLLECTION_ICONS.filter((name) => resolveLucideIconFile(name) === null)).toEqual([])
  })
})

describe('icon hrefs', () => {
  it('point into the folder for the bundled Lucide version', () => {
    expect(lucideIconHref('folder-open')).toBe(`/assets/lucide/${LUCIDE_VERSION}/folder-open.svg#folder-open`)
    expect(lucideCatalogHref('folder-open')).toBe(`/assets/lucide/${LUCIDE_VERSION}/catalog.svg#folder-open`)
  })
})
