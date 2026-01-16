<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFoliate, type RelocateDetail } from './composables/useFoliate'
import { useReaderProgress } from './composables/useReaderProgress'
import { useReaderState } from './composables/useReaderState'
import { useReaderSettings } from './composables/useReaderSettings'
import { useVisibility } from './composables/useVisibility'
import { useBookmarks } from './composables/useBookmarks'
import { useAnnotations } from './composables/useAnnotations'
import { useToc } from './composables/useToc'
import { useSearch } from './composables/useSearch'
import { useReaderSelection } from './composables/useReaderSelection'
import ReaderHeader from './components/ReaderHeader.vue'
import ReaderFooter from './components/ReaderFooter.vue'
import ReaderSidebar from './components/ReaderSidebar.vue'
import ReaderSettingsPanel from './components/ReaderSettingsPanel.vue'
import SelectionPopup from './components/SelectionPopup.vue'
import ReaderSearchPanel from './components/ReaderSearchPanel.vue'
import NoteDialog from './components/NoteDialog.vue'
import PdfReaderView from './components/PdfReaderView.vue'
import CbzReaderView from './components/CbzReaderView.vue'
import type { ReaderState } from './composables/useReaderState'
import type { FoliateRenderer } from './composables/useFoliate'
import type { EpubReaderSettings } from '@projectx/types'

const route = useRoute()
const router = useRouter()
const bookId = Number(route.params.bookId)
const fileId = Number(route.params.fileId)
const fileFormat = (route.query.format as string) || 'epub'

const containerRef = ref<HTMLElement | null>(null)
const showSidebar = ref(false)
const showSettings = ref(false)
const showSearch = ref(false)
const searchInitialQuery = ref('')
const isFullscreen = ref(false)
const sectionFractions = ref<number[]>([])

const bookSettings = useReaderSettings(fileId, fileFormat)
// False when overrideBookFormatting is off and the book has no per-book delta.
// Prevents injecting any CSS so the book renders with its own embedded styles.
const shouldApplyStyles = ref(true)

const readerState = useReaderState()
const {
  state,
  activeMode,
  isDark,
  applyToRenderer,
  setFontSize,
  setLineHeight,
  setFontFamily,
  setMaxColumnCount,
  setGap,
  setMaxInlineSize,
  setMaxBlockSize,
  setJustify,
  setHyphenate,
  setIsDark,
  setThemeName,
  setFlow,
} = readerState

const progress = useReaderProgress(bookId, fileId)
const { cfi, chapterTitle, sectionIndex, totalSections, fraction, updateHeadsFeet } = progress

const visibility = useVisibility()
const { headerVisible, footerVisible, handleMiddleTap, showHeader, showFooter } = visibility

const bookmarks = useBookmarks()
const annotations = useAnnotations()

const toc = useToc()
const { chapters, expandedHrefs, activeHref, setChapters, setActiveHref, toggleExpand } = toc

const search = useSearch()
const { results: searchResults, isSearching, search: doSearch, clear: clearSearch } = search

const selection = useReaderSelection()

function onRelocateHandler(detail: RelocateDetail) {
  progress.onRelocate(detail)
  bookmarks.setCfi(detail?.cfi ?? null)
  toc.setActiveHref(detail?.tocItem?.href ?? '')
  const renderer = getRenderer()
  if (renderer) {
    updateHeadsFeet(renderer, activeMode.value)
  }
}

function onApplyStylesHandler(renderer: FoliateRenderer) {
  if (shouldApplyStyles.value) {
    applyToRenderer(renderer)
  }
}

function onMiddleTapHandler() {
  handleMiddleTap()
}

const {
  loading,
  error,
  open,
  prev,
  next,
  goTo,
  goToFraction,
  goToSection,
  getSectionFractions,
  getChapters,
  getRenderer,
  addAnnotation,
  addAnnotations,
  deleteAnnotation,
  setTextSelectedHandler,
  view: foliateView,
} = useFoliate(() => containerRef.value, onRelocateHandler, onApplyStylesHandler, onMiddleTapHandler)

setTextSelectedHandler(selection.show)

onMounted(async () => {
  const onFullscreenChange = () => {
    isFullscreen.value = !!document.fullscreenElement
  }
  document.addEventListener('fullscreenchange', onFullscreenChange)
  onUnmounted(() => document.removeEventListener('fullscreenchange', onFullscreenChange))

  await progress.load()

  // Only epub-group formats use the epub reader; PDF/CBZ are rendered by child components
  const isEpubFormat = !['pdf', 'cbz', 'cbr', 'cb7'].includes(fileFormat)
  if (isEpubFormat) {
    await bookSettings.load()
    const effective = bookSettings.effective.value as EpubReaderSettings
    if (effective.overrideBookFormatting) {
      shouldApplyStyles.value = true
      seedState(effective)
    } else if (bookSettings.isCustomized.value) {
      // Only apply the per-book delta - don't bleed global defaults like dark theme into the book
      shouldApplyStyles.value = true
      seedState(bookSettings.bookDelta.value as Partial<ReaderState>)
    } else {
      shouldApplyStyles.value = false
    }
  }

  await open(fileId, fileFormat, progress.cfi.value)
  setChapters(getChapters())
  sectionFractions.value = getSectionFractions()
  await bookmarks.load(bookId)
  await annotations.load(bookId)
  if (annotations.annotations.value.length > 0) {
    addAnnotations(annotations.annotations.value.map((a) => ({ cfi: a.cfi, color: a.color, style: a.style })))
  }
})

const epubSetters: Record<string, (v: unknown) => void> = {
  fontSize: (v) => setFontSize(v as number),
  lineHeight: (v) => setLineHeight(v as number),
  fontFamily: (v) => setFontFamily(v as string | null),
  maxColumnCount: (v) => setMaxColumnCount(v as number),
  gap: (v) => setGap(v as number),
  maxInlineSize: (v) => setMaxInlineSize(v as number),
  maxBlockSize: (v) => setMaxBlockSize(v as number),
  justify: (v) => setJustify(v as boolean),
  hyphenate: (v) => setHyphenate(v as boolean),
  isDark: (v) => setIsDark(v as boolean),
  themeName: (v) => setThemeName(v as string),
  flow: (v) => setFlow(v as 'paginated' | 'scrolled'),
}

// Applies settings to reactive refs (and renderer if open) without touching the delta.
// Used for initial seeding on mount.
function seedState(partial: Partial<ReaderState>) {
  for (const [key, value] of Object.entries(partial)) {
    epubSetters[key]?.(value)
  }
  const renderer = getRenderer()
  if (renderer) applyToRenderer(renderer)
}

// Applies a user-initiated change: updates reactive refs AND saves the changed field to delta.
// Also enables style injection from this point forward (user has opted in by changing something).
function applyUpdate(partial: Partial<ReaderState>) {
  shouldApplyStyles.value = true
  seedState(partial)
  bookSettings.updateBookSettings(partial)
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.()
  } else {
    document.documentElement.requestFullscreen?.()
  }
}

async function handleHighlight(color: string, style: string, note?: string) {
  const annotationCfi = selection.cfi.value
  if (!selection.text.value || !annotationCfi) return
  const created = await annotations.create(bookId, {
    cfi: annotationCfi,
    text: selection.text.value,
    color,
    style,
    note: note ?? null,
    chapterTitle: chapterTitle.value || null,
  })
  if (created) {
    addAnnotation(created.cfi, created.color, created.style)
  }
  selection.dismiss()
}

async function handleSaveNote(note: string) {
  await handleHighlight('#FACC15', 'highlight', note)
  selection.showNoteDialog.value = false
  selection.noteText.value = ''
}

function handleDeleteAnnotation(id: number) {
  const ann = annotations.annotations.value.find((a) => a.id === id)
  if (ann) {
    deleteAnnotation(ann.cfi)
    annotations.remove(bookId, id)
  }
  selection.dismiss()
}

function handleSidebarDeleteAnnotation(id: number) {
  const ann = annotations.annotations.value.find((a) => a.id === id)
  if (ann) {
    deleteAnnotation(ann.cfi)
    annotations.remove(bookId, id)
  }
}

function onSearchQuery(q: string) {
  if (!foliateView.value) return
  doSearch(foliateView.value, q)
}

async function openSearchWithText(text: string) {
  selection.dismiss()
  searchInitialQuery.value = text
  showSearch.value = true
  await nextTick()
  onSearchQuery(text)
}

function onSearchClear() {
  clearSearch(foliateView.value)
}

function navigateSearch(cfiTarget: string) {
  goTo(cfiTarget)
}
</script>

<template>
  <PdfReaderView v-if="fileFormat === 'pdf'" :bookId="bookId" :fileId="fileId" />
  <CbzReaderView v-else-if="fileFormat === 'cbz' || fileFormat === 'cbr' || fileFormat === 'cb7'" :bookId="bookId" :fileId="fileId" />
  <div
    v-else
    class="fixed inset-0 overflow-hidden"
    :style="
      shouldApplyStyles ? { background: activeMode.bg, colorScheme: isDark ? 'dark' : 'light' } : { background: '#ffffff', colorScheme: 'light' }
    "
  >
    <div class="absolute top-0 left-0 right-0 z-40 h-20 pointer-events-auto" @mouseenter="showHeader()" />

    <ReaderHeader
      :chapterTitle="chapterTitle"
      :isBookmarked="bookmarks.isCurrentCfiBookmarked.value"
      class="transition-all duration-300"
      :class="headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
      @back="router.back()"
      @toggleSidebar="showSidebar = !showSidebar"
      @toggleSearch="showSearch = !showSearch"
      @toggleBookmark="bookmarks.toggle(bookId, cfi ?? '', chapterTitle)"
      @toggleSettings="showSettings = !showSettings"
      @toggleFullscreen="toggleFullscreen"
    />

    <div class="absolute inset-0">
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center z-10" :style="{ background: activeMode.bg }">
        <div class="flex flex-col items-center gap-3">
          <div
            class="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            :style="{ borderColor: activeMode.fg, borderTopColor: 'transparent' }"
          />
          <p class="text-sm" :style="{ color: activeMode.fg, opacity: 0.6 }">Loading book…</p>
        </div>
      </div>

      <div v-if="error && !loading" class="absolute inset-0 flex items-center justify-center z-10 p-8" :style="{ background: activeMode.bg }">
        <div class="text-center max-w-sm">
          <p class="text-sm font-medium mb-2" :style="{ color: activeMode.fg }">Failed to load book</p>
          <p class="text-xs opacity-60" :style="{ color: activeMode.fg }">{{ error }}</p>
        </div>
      </div>

      <div ref="containerRef" class="absolute inset-0" />
    </div>

    <ReaderFooter
      :fraction="fraction"
      :sectionIndex="sectionIndex"
      :totalSections="totalSections"
      :sectionFractions="sectionFractions"
      class="transition-all duration-300"
      :class="footerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'"
      @prevSection="goToSection(sectionIndex - 1)"
      @nextSection="goToSection(sectionIndex + 1)"
      @seek="goToFraction($event)"
    />

    <div class="absolute bottom-0 left-0 right-0 z-40 h-20 pointer-events-auto" @mouseenter="showFooter()" />

    <ReaderSidebar
      v-if="showSidebar"
      :chapters="chapters"
      :bookmarks="bookmarks.bookmarks.value"
      :annotations="annotations.annotations.value"
      :activeHref="activeHref"
      :expandedHrefs="expandedHrefs"
      @close="showSidebar = false"
      @navigateChapter="
        (href) => {
          goTo(href)
          showSidebar = false
        }
      "
      @deleteBookmark="(id) => bookmarks.remove(bookId, id)"
      @deleteAnnotation="handleSidebarDeleteAnnotation"
      @toggleExpand="toggleExpand"
    />

    <ReaderSearchPanel
      v-if="showSearch"
      :results="searchResults"
      :isSearching="isSearching"
      :initialQuery="searchInitialQuery"
      @search="onSearchQuery"
      @clear="onSearchClear"
      @navigate="navigateSearch($event)"
      @close="
        () => {
          onSearchClear()
          searchInitialQuery = ''
          showSearch = false
        }
      "
    />

    <ReaderSettingsPanel v-if="showSettings" :state="state" @update="applyUpdate" @close="showSettings = false" />

    <NoteDialog
      v-if="selection.showNoteDialog.value"
      :selectedText="selection.text.value"
      :modelValue="selection.noteText.value"
      @update:modelValue="selection.noteText.value = $event"
      @save="handleSaveNote"
      @cancel="selection.showNoteDialog.value = false"
    />

    <SelectionPopup
      :visible="selection.visible.value"
      :position="selection.position.value"
      :showBelow="selection.showBelow.value"
      :selectedText="selection.text.value"
      :overlappingAnnotationId="selection.overlappingAnnotationId.value"
      @copy="selection.dismiss()"
      @highlight="handleHighlight"
      @search="() => openSearchWithText(selection.text.value)"
      @note="selection.openNoteDialog()"
      @deleteAnnotation="handleDeleteAnnotation"
      @dismiss="selection.dismiss()"
    />
  </div>
</template>
