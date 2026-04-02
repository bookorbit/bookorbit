import { describe, expect, it } from 'vitest'
import { useToc } from '../useToc'

describe('useToc', () => {
  it('maps raw TOC items with label/title fallback and nested subitems', () => {
    const toc = useToc()

    toc.setChapters([
      {
        title: 'Part I',
        href: 'part1.xhtml',
        subitems: [
          { label: 'Chapter 1', href: 'ch1.xhtml#start' },
          { title: 'Chapter 2', href: 'ch2.xhtml' },
        ],
      },
      {
        href: 'untitled.xhtml',
      },
    ])

    expect(toc.chapters.value).toEqual([
      {
        label: 'Part I',
        href: 'part1.xhtml',
        subitems: [
          { label: 'Chapter 1', href: 'ch1.xhtml#start' },
          { label: 'Chapter 2', href: 'ch2.xhtml', subitems: undefined },
        ],
      },
      {
        label: '',
        href: 'untitled.xhtml',
        subitems: undefined,
      },
    ])
  })

  it('toggles expanded hrefs immutably', () => {
    const toc = useToc()

    const before = toc.expandedHrefs.value
    toc.toggleExpand('ch1.xhtml')

    expect(toc.isExpanded('ch1.xhtml')).toBe(true)
    expect(toc.expandedHrefs.value).not.toBe(before)

    const expanded = toc.expandedHrefs.value
    toc.toggleExpand('ch1.xhtml')

    expect(toc.isExpanded('ch1.xhtml')).toBe(false)
    expect(toc.expandedHrefs.value).not.toBe(expanded)
  })

  it('matches active href ignoring URL fragments', () => {
    const toc = useToc()

    toc.setActiveHref('chapter-1.xhtml#frag-a')

    expect(toc.isActive('chapter-1.xhtml#frag-b')).toBe(true)
    expect(toc.isActive('chapter-2.xhtml#frag-b')).toBe(false)
  })
})
