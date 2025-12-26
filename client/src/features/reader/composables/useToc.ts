import { ref } from 'vue'
import { stripFragment } from '../utils'

export interface TocItem {
  label: string
  href: string
  subitems?: TocItem[]
}

function mapTocItems(items: any[]): TocItem[] {
  return items.map((item) => ({
    label: item.label ?? item.title ?? '',
    href: item.href ?? '',
    subitems: item.subitems?.length ? mapTocItems(item.subitems) : undefined,
  }))
}

export function useToc() {
  const chapters = ref<TocItem[]>([])
  const expandedHrefs = ref<Set<string>>(new Set())
  const activeHref = ref<string>('')

  function setChapters(toc: any[]) {
    chapters.value = mapTocItems(toc ?? [])
  }

  function setActiveHref(href: string) {
    activeHref.value = href
  }

  function toggleExpand(href: string) {
    const set = new Set(expandedHrefs.value)
    if (set.has(href)) {
      set.delete(href)
    } else {
      set.add(href)
    }
    expandedHrefs.value = set
  }

  function isExpanded(href: string): boolean {
    return expandedHrefs.value.has(href)
  }

  function isActive(href: string): boolean {
    return stripFragment(activeHref.value) === stripFragment(href)
  }

  return {
    chapters,
    expandedHrefs,
    activeHref,
    setChapters,
    setActiveHref,
    toggleExpand,
    isExpanded,
    isActive,
  }
}
