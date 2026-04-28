<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFoliate, type RelocateDetail } from './epub/composables/useFoliate'
import { useReaderProgress } from './shared/composables/useReaderProgress'
import { useReadingSession } from './shared/composables/useReadingSession'
import { useReaderState } from './epub/composables/useReaderState'
import { useReaderSettings } from './shared/composables/useReaderSettings'
import { useCustomFonts } from './epub/composables/useCustomFonts'
import { useVisibility } from './shared/composables/useVisibility'
import { useBookmarks } from './epub/composables/useBookmarks'
import { useAnnotations } from './epub/composables/useAnnotations'
import { useToc } from './epub/composables/useToc'
import { useSearch, type FoliateView } from './epub/composables/useSearch'
import { useReaderSelection } from './epub/composables/useReaderSelection'
import ReaderHeader from './epub/components/ReaderHeader.vue'
import ReaderFooter from './epub/components/ReaderFooter.vue'
import ReaderSidebar from './epub/components/ReaderSidebar.vue'
import ReaderSettingsPanel from './epub/components/ReaderSettingsPanel.vue'
import SelectionPopup from './epub/components/SelectionPopup.vue'
import ReaderSearchPanel from './epub/components/ReaderSearchPanel.vue'
import NoteDialog from './epub/components/NoteDialog.vue'
import PdfReaderView from './pdf/PdfReaderView.vue'
import CbzReaderView from './cbz/CbzReaderView.vue'
import AudiobookReaderView from './audiobook/AudiobookReaderView.vue'
import type { ReaderState } from './epub/composables/useReaderState'
import type { FoliateRenderer } from './epub/composables/useFoliate'
import type { EpubReaderSettings } from '@bookorbit/types'
import { getFormatGroup } from '@bookorbit/types'

const route = useRoute()
const router = useRouter()
const bookId = Number(route.params.bookId)
const fileId = Number(route.params.fileId)
const fileFormat = (route.query.format as string) || 'epub'
const isAudioFormat = getFormatGroup(fileFormat) === 'audio'
const isPdfFormat = fileFormat === 'pdf'
const isComicFormat = fileFormat === 'cbz' || fileFormat === 'cbr' || fileFormat === 'cb7'

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
  setFontFaceCSS,
} = readerState

const customFonts = useCustomFonts()

const progress = useReaderProgress(bookId, fileId)
const { cfi, chapterTitle, sectionIndex, totalSections, fraction, updateHeadsFeet } = progress

const { onActivity } = useReadingSession(fileId, () => ({
  percentage: progress.percentage.value,
  cfi: progress.cfi.value,
  pageNumber: progress.pageNumber.value,
}))

const visibility = useVisibility()
const { headerVisible, footerVisible, handleMiddleTap, showHeader, showFooter, setVisibilityLock } = visibility

const bookmarks = useBookmarks()
const annotations = useAnnotations()

const toc = useToc()
const { chapters, expandedHrefs, activeHref, setChapters, toggleExpand } = toc

const search = useSearch()
const { results: searchResults, isSearching, search: doSearch, clear: clearSearch } = search

const selection = useReaderSelection()

function onRelocateHandler(detail: RelocateDetail) {
  progress.onRelocate(detail)
  onActivity()
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

  // Specialized readers own their own progress/settings/loading lifecycle.
  if (isAudioFormat || isPdfFormat || isComicFormat) return

  await customFonts.fetchFonts()
  setFontFaceCSS(customFonts.generateFontFaceCSS())

  await progress.load()

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

  await open(bookId, fileId, fileFormat, progress.cfi.value)
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

function setSettingsOpen(open: boolean) {
  showSettings.value = open
}

watch(showSettings, (open) => {
  setVisibilityLock(open)
})

watch(
  () => customFonts.fonts.value,
  () => {
    setFontFaceCSS(customFonts.generateFontFaceCSS())
    const renderer = getRenderer()
    if (renderer && shouldApplyStyles.value) applyToRenderer(renderer)
  },
)

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
  doSearch(foliateView.value as FoliateView, q)
}

async function openSearchWithText(text: string) {
  selection.dismiss()
  searchInitialQuery.value = text
  showSearch.value = true
  await nextTick()
  onSearchQuery(text)
}

function onSearchClear() {
  clearSearch(foliateView.value as FoliateView | null)
}

function navigateSearch(cfiTarget: string) {
  goTo(cfiTarget)
}

function closeSearch() {
  onSearchClear()
  searchInitialQuery.value = ''
  showSearch.value = false
}
</script>

<template>
  <PdfReaderView v-if="isPdfFormat" :bookId="bookId" :fileId="fileId" />
  <CbzReaderView v-else-if="isComicFormat" :bookId="bookId" :fileId="fileId" />
  <AudiobookReaderView v-else-if="isAudioFormat" :bookId="bookId" :fileId="fileId" />
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
      :settings-open="showSettings"
      class="transition-all duration-300"
      :class="headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
      @back="router.back()"
      @toggleSidebar="showSidebar = !showSidebar"
      @toggleSearch="showSearch = !showSearch"
      @toggleBookmark="bookmarks.toggle(bookId, cfi ?? '', chapterTitle)"
      @update:settings-open="setSettingsOpen"
      @toggleFullscreen="toggleFullscreen"
    >
      <template #settingsPanel>
        <ReaderSettingsPanel :state="state" :customFonts="customFonts" @update="applyUpdate" />
      </template>
    </ReaderHeader>

    <Transition name="bookmark-fade">
      <div v-if="bookmarks.isCurrentCfiBookmarked.value" class="absolute left-8 z-30 pointer-events-none" aria-hidden="true">
        <div class="w-7 h-14 bg-primary" style="clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)" />
      </div>
    </Transition>

    <div class="absolute inset-0">
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center z-10 bg-background">
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p class="text-sm text-muted-foreground">Loading book…</p>
        </div>
      </div>

      <div v-if="error && !loading" class="absolute inset-0 flex items-center justify-center z-10 p-8 bg-background">
        <div class="text-center max-w-sm">
          <p class="text-sm font-medium mb-2 text-foreground">Failed to load book</p>
          <p class="text-xs text-muted-foreground">{{ error }}</p>
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
      @close="closeSearch"
    />

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

<style scoped>
.bookmark-fade-enter-active,
.bookmark-fade-leave-active {
  transition: opacity 0.2s ease;
}
.bookmark-fade-enter-from,
.bookmark-fade-leave-to {
  opacity: 0;
}
</style>
