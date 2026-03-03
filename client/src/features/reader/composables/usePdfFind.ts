import { ref } from 'vue'
import type { Ref } from 'vue'

export interface PdfFindState {
  query: string
  matchCase: boolean
  wholeWord: boolean
  highlightAll: boolean
  matchCount: number
  currentIndex: number
}

const MATCH_CLASS = 'pdf-find-match'
const CURRENT_CLASS = 'pdf-find-match-current'

export function usePdfFind(textLayerMap: Ref<Map<number, HTMLElement>>) {
  const query = ref('')
  const matchCase = ref(false)
  const wholeWord = ref(false)
  const highlightAll = ref(true)
  const matchCount = ref(0)
  const currentIndex = ref(0)

  let matches: HTMLElement[] = []

  function normalize(s: string) {
    return matchCase.value ? s : s.toLowerCase()
  }

  function isWordBoundary(text: string, start: number, len: number): boolean {
    const before = start === 0 ? ' ' : text[start - 1]
    const after = start + len >= text.length ? ' ' : text[start + len]
    return /\W/.test(before) && /\W/.test(after)
  }

  function clearHighlights() {
    for (const el of matches) {
      el.classList.remove(MATCH_CLASS, CURRENT_CLASS)
    }
    matches = []
  }

  function search() {
    clearHighlights()

    const q = normalize(query.value.trim())
    if (!q) {
      matchCount.value = 0
      currentIndex.value = 0
      return
    }

    const found: HTMLElement[] = []
    for (const [, layer] of textLayerMap.value) {
      const spans = Array.from(layer.querySelectorAll('span')) as HTMLElement[]
      for (const span of spans) {
        const text = normalize(span.textContent ?? '')
        if (!text.includes(q)) continue
        if (wholeWord.value && !isWordBoundary(text, text.indexOf(q), q.length)) continue
        found.push(span)
      }
    }

    matches = found
    matchCount.value = found.length

    if (found.length === 0) {
      currentIndex.value = 0
      return
    }

    currentIndex.value = Math.min(currentIndex.value, found.length - 1)

    for (const el of found) {
      el.classList.add(MATCH_CLASS)
    }
    scrollToMatch(currentIndex.value)
  }

  function scrollToMatch(idx: number) {
    for (const el of matches) el.classList.remove(CURRENT_CLASS)
    const el = matches[idx]
    if (!el) return
    el.classList.add(CURRENT_CLASS)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function next() {
    if (matchCount.value === 0) return
    currentIndex.value = (currentIndex.value + 1) % matchCount.value
    scrollToMatch(currentIndex.value)
  }

  function prev() {
    if (matchCount.value === 0) return
    currentIndex.value = (currentIndex.value - 1 + matchCount.value) % matchCount.value
    scrollToMatch(currentIndex.value)
  }

  function clear() {
    clearHighlights()
    query.value = ''
    matchCount.value = 0
    currentIndex.value = 0
  }

  return { query, matchCase, wholeWord, highlightAll, matchCount, currentIndex, search, next, prev, clear }
}

