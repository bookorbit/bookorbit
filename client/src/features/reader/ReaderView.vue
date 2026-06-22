<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useFoliate, type RelocateDetail } from './epub/composables/useFoliate'
import type { SelectionDetail } from './epub/composables/useFoliateSelection'
import { useReaderProgress } from './shared/composables/useReaderProgress'
import { useReadingSession } from './shared/composables/useReadingSession'
import { useReaderState } from './epub/composables/useReaderState'
import { useReaderSettings } from './shared/composables/useReaderSettings'
import { useCustomFonts } from './epub/composables/useCustomFonts'
import { useVisibility } from './shared/composables/useVisibility'
import { useWakeLock } from './shared/composables/useWakeLock'
import { useBookmarks } from './epub/composables/useBookmarks'
import { useAnnotations } from './epub/composables/useAnnotations'
import { useToc } from './epub/composables/useToc'
import { useSearch, type FoliateView } from './epub/composables/useSearch'
import { useReaderSelection } from './epub/composables/useReaderSelection'
import { useReaderKeyboardShortcuts } from './epub/composables/useReaderKeyboardShortcuts'
import ReaderHeader from './epub/components/ReaderHeader.vue'
import ReaderFooter from './epub/components/ReaderFooter.vue'
import ReaderSidebar from './epub/components/ReaderSidebar.vue'
import ReaderSettingsPanel from './epub/components/ReaderSettingsPanel.vue'
import SelectionPopup from './epub/components/SelectionPopup.vue'
import ReaderSearchPanel from './epub/components/ReaderSearchPanel.vue'
import NoteDialog from './epub/components/NoteDialog.vue'
import DictionaryPopover from './epub/components/DictionaryPopover.vue'
import TranslationPopover from './epub/components/TranslationPopover.vue'
import TranslationSheet from './epub/components/TranslationSheet.vue'
import KeyboardShortcutsModal from './epub/components/KeyboardShortcutsModal.vue'
import PdfV4ReaderView from './pdf-v4/PdfV4ReaderView.vue'
import CbzReaderView from './cbz/CbzReaderView.vue'
import AudiobookReaderView from './audiobook/AudiobookReaderView.vue'
import type { ReaderState } from './epub/composables/useReaderState'
import type { FoliateLocationContext, FoliateRenderer } from './epub/composables/useFoliate'
import type { EpubReaderSettings } from '@bookorbit/types'
import { cfiRangesOverlap } from './epub/utils'
import { getFormatGroup } from '@bookorbit/types'

const route = useRoute()
const router = useRouter()
const bookId = Number(route.params.bookId)
const fileId = Number(route.params.fileId)
const fileFormat = (route.query.format as string) || 'epub'
const isAudioFormat = getFormatGroup(fileFormat) === 'audio'
const isPdfFormat = fileFormat === 'pdf'
const isComicFormat = fileFormat === 'cbz' || fileFormat === 'cbr' || fileFormat === 'cb7'
const isPeekMode = computed(() => {
  const mode = route.query.mode
  return (Array.isArray(mode) ? mode[0] : mode) === 'peek'
})
const trackingEnabled = computed(() => !isPeekMode.value)

const containerRef = ref<HTMLElement | null>(null)
const showSidebar = ref(false)
const showSettings = ref(false)
const showSearch = ref(false)
const searchInitialQuery = ref('')
const isFullscreen = ref(false)
const sectionFractions = ref<number[]>([])
const sidebarLocationMetaByCfi = ref<Record<string, { chapterTitle: string | null; percentage: number | null }>>({})
let sidebarLocationResolveSeq = 0

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

const { onActivity, elapsedMinutes } = useReadingSession(
  fileId,
  () => ({
    percentage: progress.percentage.value,
    cfi: progress.cfi.value,
    pageNumber: progress.pageNumber.value,
  }),
  { trackingEnabled },
)

const progress = useReaderProgress(bookId, fileId, elapsedMinutes, 0, { trackingEnabled })
const { cfi, chapterTitle, sectionIndex, totalSections, fraction, locationTotal, footerMode, cycleFooterMode, updateHeadsFeet } = progress

const visibility = useVisibility()
const { headerVisible, footerVisible, handleMiddleTap, setVisibilityLock } = visibility

useWakeLock()

const bookmarks = useBookmarks()
const annotations = useAnnotations()

const toc = useToc()
const { chapters, expandedHrefs, activeHref, setChapters, toggleExpand } = toc

const search = useSearch()
const { results: searchResults, isSearching, search: doSearch, clear: clearSearch } = search

const selection = useReaderSelection()

function closeAnyPanel() {
  if (showSearch.value) {
    closeSearch()
  } else if (showSidebar.value) {
    showSidebar.value = false
  } else if (showSettings.value) {
    showSettings.value = false
  } else {
    handleMiddleTap()
  }
}

const { showHelpModal } = useReaderKeyboardShortcuts({
  toggleSidebar: () => {
    showSidebar.value = !showSidebar.value
  },
  toggleSearch: () => {
    showSearch.value = !showSearch.value
  },
  toggleBookmark: () => {
    bookmarks.toggle(bookId, cfi.value ?? '', chapterTitle.value)
  },
  toggleFullscreen,
  cycleFooterMode,
  closePanel: closeAnyPanel,
  goToStart: () => goToFraction(0),
  goToEnd: () => goToFraction(1),
})

function toggleHelpModal() {
  showHelpModal.value = !showHelpModal.value
}

async function startTrackedReading() {
  const query = { ...route.query }
  delete query.mode
  await router.replace({ name: 'reader', params: route.params, query })
  await nextTick()
  await progress.save()
  onActivity()
}

const chapterStartFraction = computed(() => {
  const fracs = sectionFractions.value
  const idx = sectionIndex.value
  return fracs[idx] ?? 0
})

const chapterEndFraction = computed(() => {
  const fracs = sectionFractions.value
  const idx = sectionIndex.value
  return fracs[idx + 1] ?? 1
})

const showDictionary = ref(false)
const dictionaryWord = ref('')
const dictionaryPosition = ref({ x: 0, y: 0, showBelow: false })

const showTranslation = ref(false)
const translationText = ref('')
const translationPosition = ref({ x: 0, y: 0, showBelow: false })
const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

function handleDefine() {
  dictionaryWord.value = selection.text.value
  dictionaryPosition.value = {
    x: selection.position.value.x,
    y: selection.position.value.y,
    showBelow: selection.showBelow.value,
  }
  selection.dismiss()
  showDictionary.value = true
}

function handleTranslate() {
  translationText.value = selection.text.value
  translationPosition.value = {
    x: selection.position.value.x,
    y: selection.position.value.y,
    showBelow: selection.showBelow.value,
  }
  selection.dismiss()
  showTranslation.value = true
}

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
  getLocationContext,
  getRenderer,
  addAnnotation,
  addAnnotations,
  deleteAnnotation,
  setTextSelectedHandler,
  setAnnotationClickHandler,
  view: foliateView,
  bookLanguage,
} = useFoliate(() => containerRef.value, onRelocateHandler, onApplyStylesHandler, onMiddleTapHandler)

function handleTextSelected(detail: SelectionDetail) {
  const selCfi = detail.cfi
  const match = selCfi ? (annotations.annotations.value.find((a) => a.cfi != null && cfiRangesOverlap(selCfi, a.cfi)) ?? null) : null
  selection.show(detail, match?.id ?? null)
}

function handleAnnotationClick(cfi: string, popupPosition: { x: number; y: number; showBelow: boolean }) {
  const ann = annotations.annotations.value.find((a) => a.cfi === cfi)
  if (!ann) return
  selection.show({ text: ann.text, cfi, popupPosition }, ann.id)
}

setTextSelectedHandler(handleTextSelected)
setAnnotationClickHandler(handleAnnotationClick)

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
  if (effective.footerDisplayMode !== undefined) {
    footerMode.value = effective.footerDisplayMode
  }
  if (effective.overrideBookFormatting) {
    shouldApplyStyles.value = true
    seedState(effective)
  } else if (bookSettings.isCustomized.value) {
    shouldApplyStyles.value = true
    seedState(bookSettings.bookDelta.value as Partial<ReaderState>)
  } else {
    shouldApplyStyles.value = false
  }

  const hadProgress = progress.percentage.value > 0
  await open(bookId, fileId, fileFormat, progress.cfi.value, hadProgress ? progress.percentage.value / 100 : undefined)
  setChapters(getChapters())
  sectionFractions.value = getSectionFractions()
  await bookmarks.load(bookId)
  await annotations.load(bookId)
  const drawableAnnotations = annotations.annotations.value.filter((a): a is typeof a & { cfi: string } => a.cfi != null)
  if (drawableAnnotations.length > 0) {
    addAnnotations(drawableAnnotations.map((a) => ({ cfi: a.cfi, color: a.color, style: a.style })))
  }
  void hydrateSidebarLocationMeta()

  const deepLinkCfi = typeof route.query.cfi === 'string' ? route.query.cfi : null
  if (deepLinkCfi) {
    try {
      await goTo(deepLinkCfi)
    } catch {
      toast.error('Could not open the linked highlight position')
    }
  }

  if (hadProgress) {
    const pct = Math.round(progress.percentage.value)
    const label = chapterTitle.value || `Chapter ${sectionIndex.value + 1}`
    toast.info(`Resumed at ${pct}% - ${label}`, { duration: 2500 })
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

watch(
  () => footerMode.value,
  (mode) => {
    bookSettings.updateBookSettings({ footerDisplayMode: mode })
    const renderer = getRenderer()
    if (renderer) {
      updateHeadsFeet(renderer, activeMode.value)
    }
  },
)

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
    bookFileId: fileId,
    text: selection.text.value,
    color,
    style,
    note: note ?? null,
    chapterTitle: chapterTitle.value || null,
  })
  if (created?.cfi) {
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
    if (ann.cfi) deleteAnnotation(ann.cfi)
    annotations.remove(bookId, id)
  }
  selection.dismiss()
}

function handleSidebarDeleteAnnotation(id: number) {
  const ann = annotations.annotations.value.find((a) => a.id === id)
  if (ann) {
    if (ann.cfi) deleteAnnotation(ann.cfi)
    annotations.remove(bookId, id)
  }
}

function handleSidebarDeleteBookmark(id: number) {
  bookmarks.remove(bookId, id)
}

function getSidebarCfiTargets(): string[] {
  const targets = new Set<string>()
  for (const bm of bookmarks.bookmarks.value) {
    if (bm.cfi) targets.add(bm.cfi)
  }
  for (const ann of annotations.annotations.value) {
    if (ann.cfi) targets.add(ann.cfi)
  }
  return Array.from(targets)
}

function pruneSidebarLocationMeta(targets: string[]) {
  const targetSet = new Set(targets)
  const next: Record<string, { chapterTitle: string | null; percentage: number | null }> = {}
  for (const [cfiKey, meta] of Object.entries(sidebarLocationMetaByCfi.value)) {
    if (targetSet.has(cfiKey)) {
      next[cfiKey] = meta
    }
  }
  if (Object.keys(next).length === Object.keys(sidebarLocationMetaByCfi.value).length) return
  sidebarLocationMetaByCfi.value = next
}

function toSidebarLocationMeta(context: FoliateLocationContext): { chapterTitle: string | null; percentage: number | null } {
  const percentage =
    typeof context.fraction === 'number' && Number.isFinite(context.fraction) ? Math.max(0, Math.min(100, Math.round(context.fraction * 100))) : null
  return { chapterTitle: context.chapterTitle, percentage }
}

async function hydrateSidebarLocationMeta() {
  const targets = getSidebarCfiTargets()
  pruneSidebarLocationMeta(targets)
  if (targets.length === 0) return

  const unresolved = targets.filter((target) => !sidebarLocationMetaByCfi.value[target])
  if (unresolved.length === 0) return

  const requestSeq = ++sidebarLocationResolveSeq
  const entries = await Promise.all(
    unresolved.map(async (target) => {
      try {
        const context = await getLocationContext(target)
        return [target, toSidebarLocationMeta(context)] as const
      } catch {
        return [target, { chapterTitle: null, percentage: null }] as const
      }
    }),
  )

  if (requestSeq !== sidebarLocationResolveSeq) return
  sidebarLocationMetaByCfi.value = { ...sidebarLocationMetaByCfi.value, ...Object.fromEntries(entries) }
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

async function navigateFromSidebar(cfiTarget: string) {
  const goToPromise = goTo(cfiTarget)
  if (!goToPromise) return
  const navigated = await Promise.resolve(goToPromise)
    .then(() => true)
    .catch(() => false)
  if (!navigated) return
  showSidebar.value = false
}

function navigateAnnotationChapterFromSidebar(chapterIndex: number) {
  const goToPromise = goToSection(chapterIndex)
  if (!goToPromise) return
  void Promise.resolve(goToPromise)
    .then(() => {
      showSidebar.value = false
    })
    .catch(() => undefined)
}

function navigateChapterFromSidebar(href: string) {
  goTo(href)
  showSidebar.value = false
}

function closeSearch() {
  onSearchClear()
  searchInitialQuery.value = ''
  showSearch.value = false
}

watch(showSidebar, (open) => {
  if (open) {
    void hydrateSidebarLocationMeta()
  }
})

watch(
  () => [bookmarks.bookmarks.value.map((bm) => bm.cfi).join('|'), annotations.annotations.value.map((ann) => ann.cfi).join('|')],
  () => {
    if (showSidebar.value) {
      void hydrateSidebarLocationMeta()
    }
  },
)
</script>

<template>
  <PdfV4ReaderView v-if="isPdfFormat" :bookId="bookId" :fileId="fileId" :peek-mode="isPeekMode" />
  <CbzReaderView v-else-if="isComicFormat" :bookId="bookId" :fileId="fileId" :peek-mode="isPeekMode" />
  <AudiobookReaderView v-else-if="isAudioFormat" :bookId="bookId" :fileId="fileId" :peek-mode="isPeekMode" />
  <div
    v-else
    class="fixed inset-0 overflow-hidden"
    :style="
      shouldApplyStyles ? { background: activeMode.bg, colorScheme: isDark ? 'dark' : 'light' } : { background: '#ffffff', colorScheme: 'light' }
    "
  >
    <ReaderHeader
      :chapterTitle="chapterTitle"
      :isBookmarked="bookmarks.isCurrentCfiBookmarked.value"
      :settings-open="showSettings"
      :footerMode="footerMode"
      :peek-mode="isPeekMode"
      class="transition-all duration-300"
      :class="headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
      @back="router.back()"
      @toggleSidebar="showSidebar = !showSidebar"
      @toggleSearch="showSearch = !showSearch"
      @toggleBookmark="bookmarks.toggle(bookId, cfi ?? '', chapterTitle)"
      @update:settings-open="setSettingsOpen"
      @toggleFullscreen="toggleFullscreen"
      @toggleHelp="toggleHelpModal"
      @cycleFooterMode="cycleFooterMode"
      @startReading="startTrackedReading"
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
      :chapterStartFraction="chapterStartFraction"
      :chapterEndFraction="chapterEndFraction"
      :locationTotal="locationTotal"
      class="transition-all duration-300"
      :class="footerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'"
      @prevSection="goToSection(sectionIndex - 1)"
      @nextSection="goToSection(sectionIndex + 1)"
      @seek="goToFraction($event)"
    />

    <ReaderSidebar
      v-if="showSidebar"
      :chapters="chapters"
      :bookmarks="bookmarks.bookmarks.value"
      :annotations="annotations.annotations.value"
      :currentCfi="cfi"
      :locationMetaByCfi="sidebarLocationMetaByCfi"
      :activeHref="activeHref"
      :expandedHrefs="expandedHrefs"
      @close="showSidebar = false"
      @navigateChapter="navigateChapterFromSidebar"
      @navigateBookmark="navigateFromSidebar"
      @navigateAnnotation="navigateFromSidebar"
      @navigateAnnotationChapter="navigateAnnotationChapterFromSidebar"
      @deleteBookmark="handleSidebarDeleteBookmark"
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
      @translate="handleTranslate"
      @define="handleDefine"
      @note="selection.openNoteDialog()"
      @deleteAnnotation="handleDeleteAnnotation"
      @dismiss="selection.dismiss()"
    />

    <DictionaryPopover
      v-if="showDictionary"
      :word="dictionaryWord"
      :position="dictionaryPosition"
      :lang="bookLanguage"
      @close="showDictionary = false"
    />

    <TranslationPopover
      v-if="showTranslation && !isMobile"
      :text="translationText"
      :position="translationPosition"
      @close="showTranslation = false"
    />

    <TranslationSheet v-if="showTranslation && isMobile" :text="translationText" @close="showTranslation = false" />

    <KeyboardShortcutsModal v-if="showHelpModal" @close="showHelpModal = false" />
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
