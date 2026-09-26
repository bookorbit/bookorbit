<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useFoliate, type RelocateDetail } from './epub/composables/useFoliate'
import type { SelectionDetail } from './epub/composables/useFoliateSelection'
import { useReaderProgress } from './shared/composables/useReaderProgress'
import { useReadingSession } from './shared/composables/useReadingSession'
import { useReaderPageTitle } from './shared/composables/useReaderPageTitle'
import { useReaderState } from './epub/composables/useReaderState'
import { useReaderSettings } from './shared/composables/useReaderSettings'
import { useCustomFonts } from './epub/composables/useCustomFonts'
import { useVisibility } from './shared/composables/useVisibility'
import { useWakeLock } from './shared/composables/useWakeLock'
import { useFullscreen } from './shared/composables/useFullscreen'
import { useBookmarks } from './epub/composables/useBookmarks'
import { useAnnotations } from './epub/composables/useAnnotations'
import { useReaderAnnotationActions } from './epub/composables/useReaderAnnotationActions'
import { useToc } from './epub/composables/useToc'
import { useSearch, type FoliateView } from './epub/composables/useSearch'
import { useReaderSelection } from './epub/composables/useReaderSelection'
import { useReaderSidebarPin } from './epub/composables/useReaderSidebarPin'
import { useReaderKeyboardShortcuts } from './epub/composables/useReaderKeyboardShortcuts'
import { useFoliateTts } from '@/features/tts/composables/useFoliateTts'
import { useTtsPlayer } from '@/features/tts/composables/useTtsPlayer'
import { useTtsMiniPlayerUi } from '@/features/tts/composables/useTtsMiniPlayerUi'
import { useTtsPreferences } from '@/features/tts/composables/useTtsPreferences'
import { useTtsPosition } from '@/features/tts/composables/useTtsPosition'
import { useTtsKeyboard } from '@/features/tts/composables/useTtsKeyboard'
import { getProviders, getVoices } from '@/features/tts/api/tts.api'
import { useMediaOverlay } from './media-overlay/composables/useMediaOverlay'
import { resolveMediaOverlayResume, type MediaOverlayResumePosition } from './media-overlay/lib/media-overlay-resume'
import { injectMediaOverlayHighlightCss, MEDIA_OVERLAY_DEFAULT_ACTIVE_CLASS } from './media-overlay/lib/media-overlay-highlight'
import { startMediaOverlayWithFallback } from './media-overlay/lib/media-overlay-start'
import { mediaOverlayEntriesOverlapping } from './media-overlay/lib/media-overlay-range'
import TtsResumePrompt from '@/features/tts/components/TtsResumePrompt.vue'
import ReaderHeader from './epub/components/ReaderHeader.vue'
import ReaderFooter from './epub/components/ReaderFooter.vue'
import ReaderSidebar from './epub/components/ReaderSidebar.vue'
import ReaderSettingsPanel from './epub/components/ReaderSettingsPanel.vue'
import SelectionPopup from './epub/components/SelectionPopup.vue'
import ReaderSearchPanel from './epub/components/ReaderSearchPanel.vue'
import NoteDialog from './shared/components/NoteDialog.vue'
import DictionaryPopover from './epub/components/DictionaryPopover.vue'
import TranslationPopover from './epub/components/TranslationPopover.vue'
import TranslationSheet from './epub/components/TranslationSheet.vue'
import KeyboardShortcutsModal from './epub/components/KeyboardShortcutsModal.vue'
import CbzReaderView from './cbz/CbzReaderView.vue'
import AudiobookReaderView from './audiobook/AudiobookReaderView.vue'
import type { ReaderState } from './epub/composables/useReaderState'
import type { FoliateLocationContext, FoliateRenderer } from './epub/composables/useFoliate'
import type { BookDetail, EpubMediaOverlayPlaylist, EpubReaderSettings } from '@bookorbit/types'
import { findMatchingCfiRange } from './epub/utils'
import { getFormatGroup } from '@bookorbit/types'
import { resolveReaderResumeTarget } from '@/lib/reading-checkpoint'
import { api } from '@/lib/api'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const PdfV4ReaderView = defineAsyncComponent(() => import('./pdf-v4/PdfV4ReaderView.vue'))

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { coverUrl } = useCoverVersions()
const bookId = Number(route.params.bookId)
const fileId = Number(route.params.fileId)
const fileFormat = (route.query.format as string) || 'epub'
useReaderPageTitle(bookId)
const normalizedFileFormat = fileFormat.toLowerCase()
const isAudioFormat = getFormatGroup(fileFormat) === 'audio'
const isPdfFormat = fileFormat === 'pdf'
const isComicFormat = fileFormat === 'cbz' || fileFormat === 'cbr' || fileFormat === 'cb7'
const isPeekMode = computed(() => {
  const mode = route.query.mode
  return (Array.isArray(mode) ? mode[0] : mode) === 'peek'
})
const trackingEnabled = computed(() => !isPeekMode.value)
const isTtsAvailable = normalizedFileFormat === 'epub'

const containerRef = ref<HTMLElement | null>(null)
const showSidebar = ref(false)
const showSettings = ref(false)
const showSearch = ref(false)
const showTapZones = ref(false)
const searchInitialQuery = ref('')
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
  setParagraphSpacing,
  setLetterSpacing,
  setWordSpacing,
  setTextIndent,
  setFontFamily,
  setFontWeight,
  setFontStyle,
  setMaxColumnCount,
  setGap,
  setMaxInlineSize,
  setMaxBlockSize,
  setJustify,
  setHyphenate,
  setIsDark,
  setThemeName,
  setFlow,
  setFixedLayoutSpread,
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

const progress = useReaderProgress(bookId, fileId, elapsedMinutes, 0, {
  trackingEnabled,
})
const { cfi, chapterTitle, sectionIndex, totalSections, fraction, locationTotal, footerMode, cycleFooterMode, updateHeadsFeet } = progress

const visibility = useVisibility()
const { headerVisible, footerVisible, isPinned, handleMiddleTap, togglePinned, hideOverlays, setVisibilityLock } = visibility
const { toggleFullscreen } = useFullscreen()

useWakeLock()

const bookmarks = useBookmarks()
const annotations = useAnnotations()

const toc = useToc()
const { chapters, expandedHrefs, activeHref, setChapters, toggleExpand } = toc

const search = useSearch()
const { results: searchResults, isSearching, search: doSearch, clear: clearSearch } = search

const selection = useReaderSelection()
const { isSidebarPinned, toggleSidebarPinned, shouldCloseAfterNavigation } = useReaderSidebarPin(fileId)

function closeAnyPanel() {
  if (showTapZones.value) {
    showTapZones.value = false
  } else if (showSearch.value) {
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
  goToStart: () => navigateToFraction(0),
  goToEnd: () => navigateToFraction(1),
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

const bookMeta = ref<BookDetail | null>(null)

const {
  foliateReady,
  setFoliateSource,
  clearFoliateSource,
  getServerTextBlocks,
  getVisibleRange,
  getBlockIndexForRange,
  highlightBlock,
  showResumeHighlightFromCfi,
  showResumeHighlightFromBlock,
  clearHighlight,
} = useFoliateTts()
const { startPlayback, isActive, currentBook, currentBlockIndex, currentChapterIndex, playbackState, primeAudioContext } = useTtsPlayer()
const { setExpanded: setMiniPlayerExpanded, setReaderFooterVisible } = useTtsMiniPlayerUi()
const { loadBookPreferences, loadUserPreferences, defaultProviderId, defaultVoiceId, defaultSpeed } = useTtsPreferences()
const ttsPosition = useTtsPosition()
const mediaOverlay = useMediaOverlay()
let mediaOverlayStartId = 0

const isMediaOverlayAvailable = computed(() => isTtsAvailable && hasMediaOverlay.value)
const isTtsActive = computed(() => isActive.value && currentBook.value?.bookFileId === fileId)
const isNavigationLocked = computed(
  () => (isTtsActive.value && playbackState.value === 'playing') || (mediaOverlay.isActive.value && mediaOverlay.isPlaying.value),
)

useTtsKeyboard(() => mediaOverlay.isActive.value, {
  togglePlayPause: mediaOverlay.toggle,
  prevBlock: mediaOverlay.prevSentence,
  nextBlock: mediaOverlay.nextSentence,
  increaseSpeed: mediaOverlay.increaseRate,
  decreaseSpeed: mediaOverlay.decreaseRate,
})
const isOverlayFooterVisible = computed(() => footerVisible.value && !showTapZones.value)
const showTtsResumePrompt = ref(false)
const clearingSavedTtsPosition = ref(false)
const pendingTtsChapterNavigation = ref<number | null>(null)
const isTtsRelocating = ref(false)
const lastNavigationBlockedToastAt = ref(0)
let initialOpenCompleted = false
let pendingManualNavigationClearsMediaOverlay = false
let pendingManualNavigationClearTimer: ReturnType<typeof setTimeout> | null = null
let mediaOverlayPlaylistPromise: Promise<EpubMediaOverlayPlaylist | null> | null = null

function withTtsRelocation(fn: () => void | Promise<void>) {
  isTtsRelocating.value = true
  const res = fn()
  if (res instanceof Promise) {
    void res.finally(() => {
      setTimeout(() => {
        isTtsRelocating.value = false
      }, 150)
    })
  } else {
    setTimeout(() => {
      isTtsRelocating.value = false
    }, 150)
  }
}

function ensureTtsAvailable(): boolean {
  if (isTtsAvailable) return true
  toast.error('TTS currently supports EPUB files only')
  return false
}

function applySavedTtsResumeHighlight() {
  if (!isTtsAvailable) return
  if (!foliateReady.value || isTtsActive.value) return
  const saved = ttsPosition.savedPosition.value
  if (!saved?.cfi) return

  // Clear any stale TTS marker before applying the current saved one.
  clearHighlight()

  if (showResumeHighlightFromCfi(saved.cfi)) return

  const match = /^tts:(\d+):(\d+)$/.exec(saved.cfi)
  if (!match) return
  const savedChapterIdx = parseInt(match[1]!, 10)
  const savedBlockIdx = parseInt(match[2]!, 10)
  void showResumeHighlightFromBlock(savedChapterIdx, savedBlockIdx, sectionIndex.value)
}

// The most recently loaded chapter document, used to re-mark the resume sentence
// after narration stops (foliate clears its own highlight on stop).
let currentChapterDoc: Document | null = null

// The sentence statically highlighted to show where narration will resume from.
// Tracked so it can be cleared once foliate takes over highlighting on play.
let resumeNarrationHighlight: { el: Element; cls: string } | null = null

function clearResumeNarrationHighlight() {
  if (resumeNarrationHighlight) {
    resumeNarrationHighlight.el.classList.remove(resumeNarrationHighlight.cls)
    resumeNarrationHighlight = null
  }
}

// On (re)load, mark the saved resume sentence in the freshly loaded chapter so the
// user can see where playback will pick up. No-op while narration is active -
// foliate owns the highlight then.
function showResumeNarrationHighlight(doc: Document) {
  clearResumeNarrationHighlight()
  if (mediaOverlay.isActive.value) return
  const saved = getCurrentNarrationPos()
  const id = saved?.fragment.split('#')[1]
  if (!id) return
  const el = doc.getElementById(id)
  if (!el) return
  const cls = getMediaActiveClass() ?? MEDIA_OVERLAY_DEFAULT_ACTIVE_CLASS
  el.classList.add(cls)
  resumeNarrationHighlight = { el, cls }
}

function onChapterLoadHandler(doc: Document, viewEl: HTMLElement) {
  currentChapterDoc = doc
  setFoliateSource(doc, viewEl)
  if (getMediaOverlay()) {
    injectMediaOverlayHighlightCss(doc, getMediaActiveClass())
    showResumeNarrationHighlight(doc)
  }
}

function syncFoliateHighlightToCurrentBlock() {
  if (currentChapterIndex.value !== sectionIndex.value) {
    clearHighlight()
    return
  }
  highlightBlock(currentBlockIndex.value)
}

// Re-run the highlight sync whenever TTS becomes active, the chapter document
// reloads (foliateReady toggles), or the visible chapter changes. sectionIndex
// only changes on chapter boundaries, so this also catches the moment a TTS
// chapter navigation settles.
watch([isTtsActive, foliateReady, sectionIndex], () => {
  if (!isTtsActive.value || !foliateReady.value) {
    pendingTtsChapterNavigation.value = null
    return
  }
  withTtsRelocation(() => {
    syncFoliateHighlightToCurrentBlock()
  })
})

watch([foliateReady, isTtsActive, sectionIndex, () => ttsPosition.savedPosition.value?.cfi], ([ready, active, , savedCfi], previous) => {
  if (!ready || active || !savedCfi) return
  // On explicit TTS stop/close, keep the current sentence highlight in place
  // instead of immediately re-resolving from persisted state.
  const wasActive = previous?.[1] ?? false
  if (wasActive && !active) return
  applySavedTtsResumeHighlight()
})

// Keep the Foliate overlay in lockstep with TTS block changes.
watch([currentChapterIndex, currentBlockIndex], ([chapterIdx]) => {
  if (!isTtsActive.value || !foliateReady.value) return

  withTtsRelocation(async () => {
    // Keep the visual reader chapter aligned with the TTS chapter before
    // highlighting; otherwise chapter rollover can jump backwards. The highlight
    // for the new chapter is applied by the foliateReady/sectionIndex watcher
    // once navigation settles and the new document's block ranges are ready.
    if (sectionIndex.value !== chapterIdx) {
      if (pendingTtsChapterNavigation.value !== chapterIdx) {
        pendingTtsChapterNavigation.value = chapterIdx
        await goToSection(chapterIdx)
      }
      return
    }
    pendingTtsChapterNavigation.value = null
    syncFoliateHighlightToCurrentBlock()
  })
})

/**
 * Nothing is narrated until a provider is configured, so an unset preference falls through to
 * whichever provider the server lists first rather than to a built-in default.
 */
async function resolveProviderAndVoice() {
  const effectivePrefs = await loadBookPreferences(bookId)
  const speed = effectivePrefs.speed ?? defaultSpeed.value ?? 1.0
  const resolvedProviderId = effectivePrefs.providerId ?? defaultProviderId.value ?? (await firstAvailableProviderId())
  if (!resolvedProviderId) return { providerId: '', voiceId: '', speed }

  let voiceId = effectivePrefs.voiceId ?? defaultVoiceId.value ?? ''
  if (!voiceId.trim()) {
    const voices = await getVoices(resolvedProviderId)
    voiceId = voices[0]?.id ?? ''
  }
  return { providerId: resolvedProviderId, voiceId, speed }
}

async function firstAvailableProviderId(): Promise<string | null> {
  const providers = await getProviders().catch(() => [])
  return providers[0]?.id ?? null
}

async function buildTtsBook(): Promise<{
  bookId: number
  bookFileId: number
  title: string
  author: string | null
  coverUrl: string | null
  totalChapters: number
} | null> {
  if (!bookMeta.value) {
    toast.error('Book metadata not loaded yet')
    return null
  }
  return {
    bookId,
    bookFileId: fileId,
    title: bookMeta.value.title ?? chapterTitle.value ?? 'Book',
    author: bookMeta.value.authors?.[0]?.name ?? null,
    coverUrl: bookMeta.value.coverSource ? coverUrl(bookId, 'cover', bookMeta.value.coverVersion, 'audio') : null,
    totalChapters: totalSections.value,
  }
}

async function handleStartTts() {
  if (!ensureTtsAvailable()) return
  primeAudioContext()

  showSettings.value = false
  showTapZones.value = false
  hideOverlays(true)

  if (isTtsActive.value) {
    setMiniPlayerExpanded(true)
    return
  }

  await ttsPosition.loadPosition(fileId)
  if (ttsPosition.savedPosition.value?.cfi) {
    showTtsResumePrompt.value = true
    await nextTick()
    applySavedTtsResumeHighlight()
    return
  }

  await handlePlayFromCurrentPage()
}

// The headphones button drives embedded narration when the book has media
// overlays, otherwise it falls back to synthesized TTS.
function handleStartListen() {
  if (isMediaOverlayAvailable.value) {
    void handleStartMediaOverlay()
    return
  }
  void handleStartTts()
}

const narrationPosKey = `bo:mo-pos:${fileId}`

function saveNarrationPos(section: number, fragment: string) {
  try {
    localStorage.setItem(narrationPosKey, JSON.stringify({ section, fragment, updatedAt: Date.now() }))
  } catch {
    // localStorage may be unavailable (private mode); resume is best-effort.
  }
}

function loadSavedNarrationPos(): { section: number; fragment: string } | null {
  try {
    const raw = localStorage.getItem(narrationPosKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.section === 'number' && typeof parsed?.fragment === 'string') return parsed
  } catch {
    // Ignore malformed/blocked storage.
  }
  return null
}

function hasAnyServerProgress(): boolean {
  return (
    !!progress.cfi.value ||
    progress.pageNumber.value != null ||
    progress.percentage.value > 0 ||
    (progress.positionSeconds.value != null && progress.positionSeconds.value > 0) ||
    !!progress.mediaOverlayFragment.value ||
    progress.mediaOverlaySectionIndex.value != null
  )
}

function getCurrentNarrationPos(): MediaOverlayResumePosition | null {
  if (progress.mediaOverlayFragment.value && progress.mediaOverlaySectionIndex.value !== null) {
    return { section: progress.mediaOverlaySectionIndex.value, fragment: progress.mediaOverlayFragment.value }
  }
  return null
}

async function loadMediaOverlayPlaylist(): Promise<EpubMediaOverlayPlaylist | null> {
  if (!mediaOverlayPlaylistPromise) {
    mediaOverlayPlaylistPromise = api(`/api/v1/epub/${bookId}/media-overlay?fileId=${fileId}`)
      .then((res) => (res.ok ? (res.json() as Promise<EpubMediaOverlayPlaylist>) : null))
      .catch(() => null)
  }
  return mediaOverlayPlaylistPromise
}

async function resolveSavedNarrationPos(): Promise<MediaOverlayResumePosition | null> {
  const current = getCurrentNarrationPos()
  if (current) return current

  if (progress.mediaOverlayFragment.value || (progress.positionSeconds.value != null && progress.positionSeconds.value > 0)) {
    const playlist = await loadMediaOverlayPlaylist()
    if (playlist) {
      const resolved = resolveMediaOverlayResume(playlist, {
        fragment: progress.mediaOverlayFragment.value,
        sectionIndex: progress.mediaOverlaySectionIndex.value,
        positionSeconds: progress.positionSeconds.value,
      })
      if (resolved) {
        progress.setMediaOverlayProgress(resolved.fragment, resolved.section, progress.positionSeconds.value)
        saveNarrationPos(resolved.section, resolved.fragment)
        return resolved
      }
    }
  }

  if (hasAnyServerProgress()) return null

  const local = loadSavedNarrationPos()
  if (local) {
    progress.setMediaOverlayProgress(local.fragment, local.section)
    return local
  }
  return null
}

// Persist the exact narrated sentence so playback can resume there after reload.
watch(
  () => mediaOverlay.currentFragment.value,
  (fragment) => {
    if (!mediaOverlay.isActive.value || !fragment) return
    saveNarrationPos(sectionIndex.value, fragment)
    progress.setMediaOverlayProgress(fragment, sectionIndex.value)
  },
)

// When narration is stopped (mini player closed), foliate clears its highlight.
// Re-mark the last sentence so the resume point stays visible.
watch(
  () => mediaOverlay.isActive.value,
  (active, wasActive) => {
    if (wasActive && !active && currentChapterDoc) showResumeNarrationHighlight(currentChapterDoc)
  },
)

// Starts media-overlay narration in `sectionIdx` at the first <par> that
// `matches` accepts; if none plays, it falls back to the start of the section
// instead of staying silent.
async function beginNarration(sectionIdx: number, matches: ((item: { text: string }) => boolean) | null) {
  const startId = ++mediaOverlayStartId
  const mo = getMediaOverlay()
  if (!mo) {
    toast.error('This book has no embedded narration')
    return
  }
  const book = await buildTtsBook()
  if (!book) return

  clearResumeNarrationHighlight()

  await mediaOverlay.start(
    mo,
    () => startMediaOverlayWithFallback(mo, sectionIdx, matches, () => startId === mediaOverlayStartId && mediaOverlay.isActive.value),
    book,
  )
}

async function handleStartMediaOverlay() {
  showSettings.value = false
  showTapZones.value = false
  hideOverlays(true)

  if (mediaOverlay.isActive.value) {
    mediaOverlay.toggle()
    return
  }

  const saved = await resolveSavedNarrationPos()
  if (saved) {
    await beginNarration(saved.section, (item) => item.text === saved.fragment)
    return
  }

  // No saved sentence: start from the first narrated sentence on the current page.
  const visible = getVisibleRange()
  await beginNarration(sectionIndex.value, visible ? mediaOverlayEntriesOverlapping(visible) : null)
}

async function handleReadFromHere() {
  if (!ensureTtsAvailable()) return
  const range = selection.selectionRange.value

  // Embedded narration takes precedence: play the pre-recorded audio from the
  // selected sentence rather than synthesizing TTS.
  if (isMediaOverlayAvailable.value) {
    selection.dismiss()
    showSettings.value = false
    showTapZones.value = false
    hideOverlays(true)
    await beginNarration(sectionIndex.value, range ? mediaOverlayEntriesOverlapping(range) : null)
    return
  }

  primeAudioContext()
  selection.dismiss()
  const book = await buildTtsBook()
  if (!book) return
  try {
    const { providerId, voiceId, speed } = await resolveProviderAndVoice()
    if (!voiceId.trim()) {
      toast.error('No TTS voices are available for the selected provider')
      return
    }
    const chapterIdx = sectionIndex.value
    // Map the selection directly to its paragraph index. The block ranges come
    // from the same segmentation the server uses, so this index matches the
    // audio block exactly - no fuzzy text matching.
    const blockIndex = range ? getBlockIndexForRange(range) : -1
    const startBlock = blockIndex >= 0 ? blockIndex : 0
    await startPlayback(book, providerId, voiceId, speed, (chapterIndex) => getServerTextBlocks(fileId, chapterIndex), chapterIdx, startBlock)
  } catch {
    toast.error('Failed to start TTS playback')
  }
}

async function handleResumeTts() {
  if (!ensureTtsAvailable()) return
  primeAudioContext()
  showTtsResumePrompt.value = false
  const saved = ttsPosition.savedPosition.value
  if (!saved) {
    await handleStartTts()
    return
  }
  const match = /^tts:(\d+):(\d+)$/.exec(saved.cfi)
  const chapterIdx = match ? parseInt(match[1]!, 10) : (saved.chapterIndex ?? sectionIndex.value)
  const blockIdx = match ? parseInt(match[2]!, 10) : 0
  const book = await buildTtsBook()
  if (!book) return
  try {
    const { providerId, voiceId, speed } = await resolveProviderAndVoice()
    if (!voiceId.trim()) {
      toast.error('No TTS voices are available for the selected provider')
      return
    }
    await startPlayback(book, providerId, voiceId, speed, (chapterIndex) => getServerTextBlocks(fileId, chapterIndex), chapterIdx, blockIdx)
  } catch {
    toast.error('Failed to resume TTS playback')
  }
}

function dismissResumePrompt() {
  showTtsResumePrompt.value = false
  clearHighlight()
}

async function handleClearSavedTtsPosition() {
  if (clearingSavedTtsPosition.value) return
  clearingSavedTtsPosition.value = true
  try {
    await ttsPosition.clearPosition(fileId)
    showTtsResumePrompt.value = false
    clearHighlight()
  } catch {
    toast.error('Failed to clear saved TTS position')
  } finally {
    clearingSavedTtsPosition.value = false
  }
}

async function handlePlayFromCurrentPage() {
  if (!ensureTtsAvailable()) return
  primeAudioContext()
  showTtsResumePrompt.value = false
  const book = await buildTtsBook()
  if (!book) return
  try {
    const { providerId, voiceId, speed } = await resolveProviderAndVoice()
    if (!voiceId.trim()) {
      toast.error('No TTS voices are available for the selected provider')
      return
    }
    const chapterIdx = sectionIndex.value
    // The range cached from the last relocate event is the most reliable source
    // of the currently visible position; map it to its paragraph index.
    const blockIndex = getBlockIndexForRange(getVisibleRange())
    const startBlock = blockIndex >= 0 ? blockIndex : 0
    await startPlayback(book, providerId, voiceId, speed, (chapterIndex) => getServerTextBlocks(fileId, chapterIndex), chapterIdx, startBlock)
  } catch {
    toast.error('Failed to start TTS playback')
  }
}

function onRelocateHandler(detail: RelocateDetail) {
  progress.onRelocate(detail)
  if (initialOpenCompleted && !mediaOverlay.isActive.value && !isTtsRelocating.value && pendingManualNavigationClearsMediaOverlay) {
    progress.clearMediaOverlayProgress()
    pendingManualNavigationClearsMediaOverlay = false
    if (pendingManualNavigationClearTimer) {
      clearTimeout(pendingManualNavigationClearTimer)
      pendingManualNavigationClearTimer = null
    }
  }
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
    applyToRenderer(renderer, isFixedLayout.value ? { flow: 'paginated' } : undefined)
  }
}

function onMiddleTapHandler() {
  handleMiddleTap()
}

function canRunManualNavigation(): boolean {
  if (!isNavigationLocked.value) {
    markManualNavigation()
    return true
  }

  const now = Date.now()
  if (now - lastNavigationBlockedToastAt.value >= 1200) {
    lastNavigationBlockedToastAt.value = now
    toast.info(mediaOverlay.isActive.value ? 'Pause narration to navigate pages.' : 'Pause TTS playback to navigate pages.')
  }

  return false
}

function markManualNavigation() {
  pendingManualNavigationClearsMediaOverlay = true
  if (pendingManualNavigationClearTimer) clearTimeout(pendingManualNavigationClearTimer)
  pendingManualNavigationClearTimer = setTimeout(() => {
    pendingManualNavigationClearsMediaOverlay = false
    pendingManualNavigationClearTimer = null
  }, 2_500)
}

function handleBlockedPageInteraction() {
  canRunManualNavigation()
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
  redrawAnnotation,
  setTextSelectedHandler,
  setSelectionInteractionStartHandler,
  setAnnotationClickHandler,
  view: foliateView,
  bookLanguage,
  isFixedLayout,
  hasMediaOverlay,
  getMediaOverlay,
  getMediaActiveClass,
} = useFoliate(() => containerRef.value, onRelocateHandler, onApplyStylesHandler, onMiddleTapHandler, onChapterLoadHandler, canRunManualNavigation)

const { handleHighlight, handleOpenNoteDialog, handleSaveNote } = useReaderAnnotationActions({
  bookId,
  fileId,
  chapterTitle,
  annotations,
  selection,
  addAnnotation,
  redrawAnnotation,
})

function handleTextSelected(detail: SelectionDetail) {
  const match = findMatchingCfiRange(annotations.annotations.value, detail.cfi)
  selection.show(detail, match?.id ?? null)
}

function handleAnnotationClick(cfi: string, popupPosition: { x: number; y: number; showBelow: boolean }) {
  const ann = annotations.annotations.value.find((a) => a.cfi === cfi)
  if (!ann) return
  selection.show({ text: ann.text, cfi, range: null, popupPosition }, ann.id)
}

setTextSelectedHandler(handleTextSelected)
setSelectionInteractionStartHandler(selection.dismiss)
setAnnotationClickHandler(handleAnnotationClick)

onUnmounted(clearFoliateSource)

onMounted(async () => {
  // Specialized readers own their own progress/settings/loading lifecycle.
  if (isAudioFormat || isPdfFormat || isComicFormat) return

  void Promise.all([
    api(`/api/v1/books/${bookId}`)
      .then((r) => r.json() as Promise<BookDetail>)
      .then((b) => {
        bookMeta.value = b
      })
      .catch(() => {}),
    ...(isTtsAvailable ? [loadUserPreferences().catch(() => {})] : []),
  ])

  await customFonts.fetchAllFonts()
  await refreshFontFaces()

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

  const deepLinkCfi = typeof route.query.cfi === 'string' ? route.query.cfi : null
  const hadProgress = progress.percentage.value > 0
  const resumeTarget = resolveReaderResumeTarget(deepLinkCfi ? undefined : route.query.checkpoint, progress.cfi.value, progress.percentage.value)
  const savedNarration = await resolveSavedNarrationPos()
  await open(bookId, fileId, fileFormat, {
    cfi: resumeTarget.cfi,
    fallbackFraction: resumeTarget.fraction,
    fixedLayoutSpread: state.value.fixedLayoutSpread,
    mediaOverlayFragment: savedNarration?.fragment,
    mediaOverlaySectionIndex: savedNarration?.section,
    preferMediaOverlay: savedNarration != null,
  })
  initialOpenCompleted = true
  setChapters(getChapters())
  sectionFractions.value = getSectionFractions()
  await bookmarks.load(bookId)
  await annotations.load(bookId)
  const drawableAnnotations = annotations.annotations.value.filter((a): a is typeof a & { cfi: string } => a.cfi != null)
  if (drawableAnnotations.length > 0) {
    addAnnotations(
      drawableAnnotations.map((a) => ({
        cfi: a.cfi,
        color: a.color,
        style: a.style,
      })),
    )
  }
  void hydrateSidebarLocationMeta()

  if (deepLinkCfi) {
    try {
      await goTo(deepLinkCfi)
    } catch {
      toast.error(t('reader.toast.linkedHighlightError'))
    }
  }

  const resumedPercentage = resumeTarget.checkpointPercentage ?? (hadProgress ? progress.percentage.value : null)
  if (resumedPercentage !== null) {
    const pct = Math.round(resumedPercentage)
    const label = chapterTitle.value || t('reader.chapterNumber', { number: sectionIndex.value + 1 })
    toast.info(t('reader.toast.resumed', { pct, label }), { duration: 2500 })
  }

  if (isTtsAvailable) {
    // Load saved TTS position and show its marker immediately on open.
    await ttsPosition.loadPosition(fileId)
    if (ttsPosition.hasSavedPosition.value) {
      await nextTick()
      applySavedTtsResumeHighlight()
    }
  }
})

const epubSetters: Record<string, (v: unknown) => void> = {
  fontSize: (v) => setFontSize(v as number),
  lineHeight: (v) => setLineHeight(v as number),
  paragraphSpacing: (v) => setParagraphSpacing(v as number),
  letterSpacing: (v) => setLetterSpacing(v as number | null),
  wordSpacing: (v) => setWordSpacing(v as number | null),
  textIndent: (v) => setTextIndent(v as number | null),
  fontFamily: (v) => setFontFamily(v as string | null),
  fontWeight: (v) => setFontWeight(v as number),
  fontStyle: (v) => setFontStyle(v as EpubReaderSettings['fontStyle']),
  maxColumnCount: (v) => setMaxColumnCount(v as number),
  gap: (v) => setGap(v as number),
  maxInlineSize: (v) => setMaxInlineSize(v as number),
  maxBlockSize: (v) => setMaxBlockSize(v as number),
  justify: (v) => setJustify(v as boolean),
  hyphenate: (v) => setHyphenate(v as boolean),
  isDark: (v) => setIsDark(v as boolean),
  themeName: (v) => setThemeName(v as string),
  flow: (v) => setFlow(v as 'paginated' | 'scrolled'),
  fixedLayoutSpread: (v) => setFixedLayoutSpread(v as EpubReaderSettings['fixedLayoutSpread']),
}

// Applies settings to reactive refs (and renderer if open) without touching the delta.
// Used for initial seeding on mount.
function seedState(partial: Partial<ReaderState>) {
  for (const [key, value] of Object.entries(partial)) {
    epubSetters[key]?.(value)
  }
  const renderer = getRenderer()
  if (renderer) applyToRenderer(renderer, isFixedLayout.value ? { flow: 'paginated' } : undefined)
}

async function reopenEpubAtCurrentLocation() {
  const fallbackFraction = fraction.value > 0 ? fraction.value : progress.percentage.value > 0 ? progress.percentage.value / 100 : undefined
  await open(bookId, fileId, fileFormat, null, fallbackFraction, {
    fixedLayoutSpread: state.value.fixedLayoutSpread,
  })
  setChapters(getChapters())
  sectionFractions.value = getSectionFractions()
}

// Applies a user-initiated change: updates reactive refs AND saves the changed field to delta.
// Also enables style injection from this point forward (user has opted in by changing something).
async function applyUpdate(partial: Partial<ReaderState>) {
  const shouldReopenForSpread = partial.fixedLayoutSpread !== undefined && partial.fixedLayoutSpread !== state.value.fixedLayoutSpread
  shouldApplyStyles.value = true
  seedState(partial)
  bookSettings.updateBookSettings(partial)
  if (shouldReopenForSpread) {
    await reopenEpubAtCurrentLocation()
  }
}

// Drops this book's overrides and falls back to the reader defaults. The renderer keeps
// injecting styles so the change is visible immediately rather than only after a reopen.
async function resetSettings() {
  const previousSpread = state.value.fixedLayoutSpread
  bookSettings.resetBookSettings()
  shouldApplyStyles.value = true
  seedState(bookSettings.effective.value as EpubReaderSettings)
  if (state.value.fixedLayoutSpread !== previousSpread) {
    await reopenEpubAtCurrentLocation()
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
  () => isNavigationLocked.value,
  (locked) => {
    if (!locked) return
    selection.dismiss()
    showDictionary.value = false
    showTranslation.value = false
  },
)

watch(
  () => isOverlayFooterVisible.value,
  (visible) => {
    setReaderFooterVisible(visible)
  },
  { immediate: true },
)

// Only the selected family is held in memory, so the blob URLs backing the injected
// CSS have to be refreshed whenever either the selection or the font list changes.
async function refreshFontFaces() {
  await customFonts.ensureCssFamilyLoaded(state.value.fontFamily)
  setFontFaceCSS(customFonts.generateFontFaceCSS())
  const renderer = getRenderer()
  if (renderer && shouldApplyStyles.value) applyToRenderer(renderer, isFixedLayout.value ? { flow: 'paginated' } : undefined)
}

watch(() => [customFonts.fonts.value, customFonts.serverFonts.value], refreshFontFaces)

watch(() => state.value.fontFamily, refreshFontFaces)

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

function toSidebarLocationMeta(context: FoliateLocationContext): {
  chapterTitle: string | null
  percentage: number | null
} {
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
  sidebarLocationMetaByCfi.value = {
    ...sidebarLocationMetaByCfi.value,
    ...Object.fromEntries(entries),
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

function navigateToTarget(target: string | number) {
  if (!canRunManualNavigation()) return undefined
  return goTo(target)
}

function navigateToFraction(targetFraction: number) {
  if (!canRunManualNavigation()) return undefined
  return goToFraction(targetFraction)
}

function navigateToSection(targetSection: number) {
  if (!canRunManualNavigation()) return undefined
  return goToSection(targetSection)
}

function navigateSearch(cfiTarget: string) {
  navigateToTarget(cfiTarget)
}

function closeSidebarAfterNavigation() {
  if (shouldCloseAfterNavigation()) {
    showSidebar.value = false
  }
}

async function navigateFromSidebar(cfiTarget: string) {
  const goToPromise = navigateToTarget(cfiTarget)
  if (!goToPromise) return
  const navigated = await Promise.resolve(goToPromise)
    .then(() => true)
    .catch(() => false)
  if (!navigated) return
  closeSidebarAfterNavigation()
}

function navigateAnnotationChapterFromSidebar(chapterIndex: number) {
  const goToPromise = navigateToSection(chapterIndex)
  if (!goToPromise) return
  void Promise.resolve(goToPromise)
    .then(() => {
      closeSidebarAfterNavigation()
    })
    .catch(() => undefined)
}

function navigateChapterFromSidebar(href: string) {
  void navigateFromSidebar(href)
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

onUnmounted(() => {
  mediaOverlayStartId++
  if (pendingManualNavigationClearTimer) clearTimeout(pendingManualNavigationClearTimer)
  setReaderFooterVisible(false)
  mediaOverlay.stop()
})
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
      :isTtsActive="isTtsActive || (mediaOverlay.isActive.value && mediaOverlay.isPlaying.value)"
      :isTtsAvailable="isTtsAvailable"
      :isMediaOverlay="isMediaOverlayAvailable"
      :isPinned="isPinned"
      :showTapZones="showTapZones"
      class="transition-all duration-300"
      :class="headerVisible && !showTapZones ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
      @back="router.back()"
      @toggleSidebar="showSidebar = !showSidebar"
      @toggleSearch="showSearch = !showSearch"
      @toggleBookmark="bookmarks.toggle(bookId, cfi ?? '', chapterTitle)"
      @update:settings-open="setSettingsOpen"
      @toggleFullscreen="toggleFullscreen"
      @toggleHelp="toggleHelpModal"
      @cycleFooterMode="cycleFooterMode"
      @startReading="startTrackedReading"
      @startTts="handleStartListen"
      @togglePin="togglePinned"
      @toggleTapZones="showTapZones = !showTapZones"
    >
      <template #settingsPanel>
        <ReaderSettingsPanel
          :state="state"
          :customFonts="customFonts"
          :is-fixed-layout="isFixedLayout"
          :can-reset="bookSettings.isCustomized.value"
          @update="applyUpdate"
          @reset="resetSettings"
        />
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
          <p class="text-sm text-muted-foreground">
            {{ t('reader.loadingBook') }}
          </p>
        </div>
      </div>

      <div v-if="error && !loading" class="absolute inset-0 flex items-center justify-center z-10 p-8 bg-background">
        <div class="text-center max-w-sm">
          <p class="text-sm font-medium mb-2 text-foreground">
            {{ t('reader.failedToLoadBook') }}
          </p>
          <p class="text-xs text-muted-foreground">{{ error }}</p>
        </div>
      </div>

      <div ref="containerRef" class="absolute inset-0" />
      <div
        v-if="isNavigationLocked"
        class="absolute inset-0 z-[40] touch-none"
        @pointerdown.stop.prevent="handleBlockedPageInteraction"
        @touchstart.stop.prevent="handleBlockedPageInteraction"
        @click.stop.prevent="handleBlockedPageInteraction"
      />

      <!-- Tap/Click Zones Reference Overlay -->
      <Transition name="fade">
        <div v-if="showTapZones" class="absolute inset-0 z-20 pointer-events-none flex select-none">
          <!-- Floating Exit Button -->
          <button
            class="absolute top-4 right-4 z-50 px-3.5 py-2 rounded-xl bg-background/90 text-foreground border border-border/80 shadow-lg hover:bg-background pointer-events-auto flex items-center gap-2 text-xs font-semibold cursor-pointer transition-all duration-200 active:scale-95 animate-pulse"
            @click="showTapZones = false"
            title="Close Guide"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="lucide lucide-x text-primary"
            >
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
            <span>Exit Guide</span>
          </button>

          <!-- Mobile Guide -->
          <div v-if="isMobile" class="w-full h-full flex flex-col items-center justify-center bg-primary/[0.24] backdrop-blur-[4px] p-6 text-center">
            <div
              class="flex flex-col items-center gap-4 p-6 max-w-sm rounded-2xl bg-background/90 border border-border/70 shadow-2xl text-muted-foreground"
            >
              <div class="flex gap-4 items-center">
                <span class="p-3 rounded-full bg-primary/10 text-primary">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="lucide lucide-touchpad"
                  >
                    <rect width="20" height="20" x="2" y="2" rx="2" />
                    <path d="M12 14v4" />
                    <path d="M10 16h4" />
                    <circle cx="12" cy="8" r="2" />
                  </svg>
                </span>
                <span class="p-3 rounded-full bg-primary/10 text-primary">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="lucide lucide-hand"
                  >
                    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
                    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
                    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v4.5" />
                    <path
                      d="M6 14.5V11a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v7.5A8.5 8.5 0 0 0 10.5 27h3A8.5 8.5 0 0 0 22 18.5V14a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v.5"
                    />
                  </svg>
                </span>
              </div>
              <div>
                <h3 class="text-sm font-semibold tracking-wide uppercase text-foreground mb-1">Mobile Interactions</h3>
                <p class="text-xs text-muted-foreground mb-4">Optimized for handheld touch reading</p>
                <div class="space-y-3 text-left">
                  <div class="flex items-start gap-2.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                    <div>
                      <p class="text-xs font-medium text-foreground">Tap Anywhere</p>
                      <p class="text-[10px] text-muted-foreground">Toggles the header and footer overlays</p>
                    </div>
                  </div>
                  <div class="flex items-start gap-2.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                    <div>
                      <p class="text-xs font-medium text-foreground">Swipe Left / Right</p>
                      <p class="text-[10px] text-muted-foreground">Turns pages smoothly forward or backward</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Desktop Guide -->
          <div v-else class="w-full h-full flex flex-col">
            <!-- Top Zone (64px) -->
            <div
              class="h-16 w-full flex items-center justify-center border-b-2 border-dashed border-primary/40 bg-primary/[0.18] backdrop-blur-[3px] shrink-0"
            >
              <div
                class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/90 border border-border/70 shadow-md text-muted-foreground text-center animate-pulse"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="lucide lucide-menu text-primary"
                >
                  <line x1="4" x2="20" y1="12" y2="12" />
                  <line x1="4" x2="20" y1="6" y2="6" />
                  <line x1="4" x2="20" y1="18" y2="18" />
                </svg>
                <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Toggle Header</span>
                <span class="text-[10px] text-muted-foreground">Click top edge (y &lt; 64px)</span>
              </div>
            </div>

            <!-- Central Content Area -->
            <div class="flex-1 w-full flex min-h-0">
              <!-- Left Zone (30%) -->
              <div class="w-[30%] h-full flex flex-col items-center justify-center border-r-2 border-dashed border-primary/40 bg-primary/[0.08]">
                <div
                  class="flex flex-col items-center gap-2 p-4 mx-2 rounded-xl bg-background/90 border border-border/70 shadow-md text-muted-foreground animate-pulse text-center"
                >
                  <span class="p-2 rounded-full bg-primary/10 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="lucide lucide-chevron-left"
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </span>
                  <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Previous Page</span>
                  <span class="text-[10px] text-muted-foreground max-w-[120px]">Click left 30%</span>
                </div>
              </div>

              <!-- Middle Zone (40%) -->
              <div class="w-[40%] h-full flex flex-col items-center justify-center border-r-2 border-dashed border-primary/40 bg-transparent">
                <div
                  class="flex flex-col items-center gap-2 p-4 mx-2 rounded-xl bg-background/90 border border-border/70 text-muted-foreground text-center shadow-md animate-pulse"
                >
                  <span class="p-2 rounded-full bg-primary/10 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="lucide lucide-menu"
                    >
                      <line x1="4" x2="20" y1="12" y2="12" />
                      <line x1="4" x2="20" y1="6" y2="6" />
                      <line x1="4" x2="20" y1="18" y2="18" />
                    </svg>
                  </span>
                  <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Toggle Header & Footer</span>
                  <span class="text-[10px] text-muted-foreground max-w-[120px]">Click center 40%</span>
                </div>
              </div>

              <!-- Right Zone (30%) -->
              <div class="w-[30%] h-full flex flex-col items-center justify-center bg-primary/[0.08]">
                <div
                  class="flex flex-col items-center gap-2 p-4 mx-2 rounded-xl bg-background/90 border border-border/70 shadow-md text-muted-foreground animate-pulse text-center"
                >
                  <span class="p-2 rounded-full bg-primary/10 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="lucide lucide-chevron-right"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                  <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Next Page</span>
                  <span class="text-[10px] text-muted-foreground max-w-[120px]">Click right 30%</span>
                </div>
              </div>
            </div>

            <!-- Bottom Zone (64px) -->
            <div
              class="h-16 w-full flex items-center justify-center border-t-2 border-dashed border-primary/40 bg-primary/[0.18] backdrop-blur-[3px] shrink-0"
            >
              <div
                class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/90 border border-border/70 shadow-md text-muted-foreground text-center animate-pulse"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="lucide lucide-menu text-primary"
                >
                  <line x1="4" x2="20" y1="12" y2="12" />
                  <line x1="4" x2="20" y1="6" y2="6" />
                  <line x1="4" x2="20" y1="18" y2="18" />
                </svg>
                <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Toggle Footer</span>
                <span class="text-[10px] text-muted-foreground">Click bottom edge (y &gt; height - 64px)</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <ReaderFooter
      :fraction="fraction"
      :sectionIndex="sectionIndex"
      :totalSections="totalSections"
      :sectionFractions="sectionFractions"
      :chapterStartFraction="chapterStartFraction"
      :chapterEndFraction="chapterEndFraction"
      :locationTotal="locationTotal"
      :navigationLocked="isNavigationLocked"
      class="transition-all duration-300"
      :class="footerVisible && !showTapZones ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'"
      @prevSection="navigateToSection(sectionIndex - 1)"
      @nextSection="navigateToSection(sectionIndex + 1)"
      @seek="navigateToFraction($event)"
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
      :pinned="isSidebarPinned"
      :navigationLocked="isNavigationLocked"
      @close="showSidebar = false"
      @togglePinned="toggleSidebarPinned"
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
      :navigationLocked="isNavigationLocked"
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
      :isTtsAvailable="isTtsAvailable"
      @copy="selection.dismiss()"
      @highlight="handleHighlight"
      @search="() => openSearchWithText(selection.text.value)"
      @translate="handleTranslate"
      @define="handleDefine"
      @note="handleOpenNoteDialog"
      @deleteAnnotation="handleDeleteAnnotation"
      @dismiss="selection.dismiss()"
      @readFromHere="handleReadFromHere"
    />

    <Teleport to="body">
      <Transition name="tts-resume-fade">
        <div v-if="showTtsResumePrompt && !isTtsActive" class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
          <TtsResumePrompt
            :chapterIndex="ttsPosition.savedPosition.value?.chapterIndex ?? null"
            :clearing="clearingSavedTtsPosition"
            @resume="handleResumeTts"
            @playFromHere="handlePlayFromCurrentPage"
            @clearSavedPosition="handleClearSavedTtsPosition"
            @cancel="dismissResumePrompt"
          />
        </div>
      </Transition>
    </Teleport>

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
.tts-resume-fade-enter-active,
.tts-resume-fade-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.tts-resume-fade-enter-from,
.tts-resume-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
