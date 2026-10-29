<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { useElementSize } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Download, FileSearch, History, ListChecks, ListPlus, Trash2, Wrench } from '@lucide/vue'
import {
  BOOK_CHAPTERS_ERROR_CODES,
  Permission,
  type AudibleRegion,
  type BookChapterVersionSummary,
  type BookDetail,
  type EbookChapterSource,
} from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { api } from '@/lib/api'
import { ApiError, errorMessage } from '@/lib/api-json'
import { triggerBlobDownload } from '@/lib/download'
import { formatDateTime, formatNumber } from '@/i18n/formatters'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import { useDeferredLoading } from '@/composables/useDeferredLoading'
import { useBookChapters } from '@/features/book/composables/useBookChapters'
import { useChapterDraft } from '@/features/book/composables/useChapterDraft'
import { useChapterPreview } from '@/features/book/composables/useChapterPreview'
import { useChapterWaveform, WAVEFORM_NARROW_WINDOW_MS, WAVEFORM_WINDOW_MS } from '@/features/book/composables/useChapterWaveform'
import type { ReviewSource } from '@/features/book/composables/useChapterReview'
import {
  chapterEndMs,
  chaptersFromTracks,
  cleanTitles,
  indexAtTime,
  insertChapterAfter,
  removeChapters,
  splitChapterAt,
  type DraftChapter,
} from '@/features/book/lib/chapter-edit'
import { chapterExportFilename, serializeChapters, type ChapterFormat } from '@/features/book/lib/chapter-io'
import { formatChapterClock } from '@/features/book/lib/chapter-time'
import { pickPause, snapToPauses, type AnalyzePauses } from '@/features/book/lib/chapter-snap'
import ChaptersHeroBar from '../chapters/ChaptersHeroBar.vue'
import ChapterListCard from '../chapters/ChapterListCard.vue'
import ChapterCutCard, { type ChapterSnapHint } from '../chapters/ChapterCutCard.vue'
import ChapterListenBand from '../chapters/ChapterListenBand.vue'
import ChapterHistoryMenu from '../chapters/ChapterHistoryMenu.vue'
import ChapterSaveBar from '../chapters/ChapterSaveBar.vue'
import ChapterToolDialog, { type ChapterTool } from '../chapters/ChapterToolDialog.vue'
import ChapterSourceSheet, { type ChapterSourceRequest } from '../chapters/ChapterSourceSheet.vue'
import ChapterSnapDialog from '../chapters/ChapterSnapDialog.vue'

// Named for the KeepAlive `include` list in BookDetailView.
defineOptions({ name: 'ChaptersTab' })

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const { hasLibraryPermission } = useLibraryPermissions()

const EXPORT_FORMATS: { format: Exclude<ChapterFormat, 'titles'>; key: string }[] = [
  { format: 'cue', key: 'book.detail.chapters.formats.cue' },
  { format: 'ffmetadata', key: 'book.detail.chapters.formats.ffmetadata' },
  { format: 'audacity', key: 'book.detail.chapters.formats.audacity' },
  { format: 'timestamps', key: 'book.detail.chapters.formats.timestamps' },
  { format: 'json', key: 'book.detail.chapters.formats.json' },
]

const TOOLS: { tool: ChapterTool; key: string }[] = [
  { tool: 'shift', key: 'book.detail.chapters.tools.shift.title' },
  { tool: 'renumber', key: 'book.detail.chapters.tools.renumber.title' },
  { tool: 'replace', key: 'book.detail.chapters.tools.replace.title' },
  { tool: 'mergeShort', key: 'book.detail.chapters.tools.mergeShort.title' },
]

const bookId = computed(() => props.book.id)
const canEdit = computed(() => hasLibraryPermission(Permission.LibraryEditMetadata, props.book.libraryId, 'editor'))

const store = useBookChapters(bookId)
const { state, loading, loadError, busy } = store
const totalDurationMs = computed(() => state.value?.totalDurationMs ?? null)
const draft = useChapterDraft(totalDurationMs)
const { rows, activeKey, activeIndex, activeRow, selected, issuesByKey } = draft
const preview = useChapterPreview(bookId)

const editing = ref(false)
const showRail = computed(() => editing.value && Boolean(totalDurationMs.value))
const lockOnSave = ref(true)
const listCard = ref<InstanceType<typeof ChapterListCard> | null>(null)
const listeningMs = ref<number | null>(null)

const showSkeleton = useDeferredLoading(computed(() => loading.value && state.value === null))
const trackChapters = computed(() => (state.value ? chaptersFromTracks(state.value.tracks) : null))

// ── Loading ──────────────────────────────────────────────────────────────────

watch(
  state,
  (next) => {
    if (next && busy.value !== 'saving' && !draft.isDirty.value) draft.reset(next.chapters)
  },
  { flush: 'sync' },
)

watch(bookId, () => {
  editing.value = false
  preview.teardown()
  void refresh()
})

async function refresh(options: { silent?: boolean } = {}) {
  await store.load({ ...options, operations: canEdit.value })
  void loadListening()
}

/** The listener's place in the book, for the "you are here" marker. Derived from the saved percentage. */
async function loadListening() {
  try {
    const response = await api(`/api/v1/audiobooks/${bookId.value}/playback-state`)
    if (!response.ok) return
    const text = await response.text()
    const playback = text ? (JSON.parse(text) as { percentage: number } | null) : null
    const total = totalDurationMs.value
    listeningMs.value = playback && total && playback.percentage > 0 ? Math.round((playback.percentage / 100) * total) : null
  } catch {
    listeningMs.value = null
  }
}

onMounted(() => {
  void refresh().then(openRequestedSource)
})

/** The Chapter health page's Review link lands here with the Audible lookup to open, once. */
function openRequestedSource() {
  if (route.query.find !== 'audible' || !canEdit.value || !state.value) return
  const query = { ...route.query }
  delete query.find
  void router.replace({ query })
  if (!editing.value) startEditing()
  handleSourceLookup()
}

watch(
  () => route.query.find,
  (find) => {
    if (find === 'audible' && state.value) openRequestedSource()
  },
)

async function handleRetryOperation() {
  try {
    const result = await store.retryOperation()
    if (result && 'chapters' in result && !('revision' in result)) openSource({ kind: 'files' }, { kind: 'files', chapters: result.chapters })
  } catch (reason) {
    toast.error(errorMessage(reason, 'book.detail.chapters.errors.operation'))
  }
}

function handleRetry() {
  void refresh()
}

let activatedBefore = false
onActivated(() => {
  if (!activatedBefore) {
    activatedBefore = true
    return
  }
  if (!draft.isDirty.value) void refresh({ silent: true }).then(openRequestedSource)
})

// ── Editing lifecycle ────────────────────────────────────────────────────────

const versions = ref<BookChapterVersionSummary[] | null>(null)
const versionsLoading = ref(false)

async function loadVersions() {
  if (!canEdit.value) return
  versionsLoading.value = true
  try {
    versions.value = await store.listVersions()
  } catch {
    versions.value = null
  } finally {
    versionsLoading.value = false
  }
}

function startEditing() {
  if (!state.value) return
  draft.reset(state.value.chapters)
  lockOnSave.value = true
  editing.value = true
  void loadVersions()
}

async function finishEditing() {
  if (draft.isDirty.value && !(await confirmDiscard())) return
  if (state.value) draft.reset(state.value.chapters)
  editing.value = false
  preview.pause()
}

const discardResolver = ref<((discard: boolean) => void) | null>(null)

function confirmDiscard(): Promise<boolean> {
  return new Promise((resolve) => {
    discardResolver.value = resolve
  })
}

function handleDiscardConfirm() {
  discardResolver.value?.(true)
  discardResolver.value = null
}

function handleDiscardCancel() {
  discardResolver.value?.(false)
  discardResolver.value = null
}

// The tab change is a route update, so unsaved edits are guarded there and on leaving the book.
onBeforeRouteUpdate(async (to, from) => {
  const leaving = from.query.tab === 'chapters' && (to.query.tab !== 'chapters' || to.params.bookId !== from.params.bookId)
  if (!leaving || !draft.isDirty.value) return true
  const discard = await confirmDiscard()
  if (discard && state.value) {
    draft.reset(state.value.chapters)
    editing.value = false
  }
  return discard
})

onBeforeRouteLeave(async () => (draft.isDirty.value ? confirmDiscard() : true))

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!draft.isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload))

// ── Save, discard, revert ────────────────────────────────────────────────────

/** Saves the draft and says how it went; true once the saved list is what the editor shows. */
async function saveDraft(options: { quiet?: boolean } = {}): Promise<boolean> {
  if (listCard.value?.commitPendingStarts() === false) return false
  if (!draft.isDirty.value || draft.errorCount.value > 0 || busy.value) return false
  const generation = draft.generation.value
  try {
    const next = await store.save(draft.chapters(), lockOnSave.value)
    draft.acknowledge(next.chapters, generation)
    if (!options.quiet) toast.success(t('book.detail.chapters.saved'))
    emit('changed')
    void loadVersions()
    return true
  } catch (reason) {
    if (reason instanceof ApiError && reason.errorCode === BOOK_CHAPTERS_ERROR_CODES.stale) {
      toast.error(t('book.detail.chapters.errors.stale'), { action: { label: t('book.detail.chapters.reload'), onClick: handleReloadAfterConflict } })
      return false
    }
    toast.error(errorMessage(reason, 'book.detail.chapters.errors.save'))
    return false
  }
}

async function handleSave() {
  await saveDraft()
}

// ── Write into the audio files ───────────────────────────────────────────────

/** What the confirmation is for: saving first, or writing what is already saved. */
const writeConfirm = ref<'saveAndWrite' | 'writeSaved' | null>(null)
const writeFileCount = computed(() => state.value?.writeBack.fileCount ?? 0)

function handleSaveAndWrite() {
  writeConfirm.value = 'saveAndWrite'
}

function handleWriteSaved() {
  writeConfirm.value = 'writeSaved'
}

function handleWriteCancel() {
  writeConfirm.value = null
}

async function handleWriteConfirm() {
  const mode = writeConfirm.value
  writeConfirm.value = null
  if (mode === 'saveAndWrite' && !(await saveDraft({ quiet: true }))) return
  try {
    const result = await store.writeToFiles()
    if (result.status === 'success') toast.success(t('book.detail.chapters.writeFiles.done', { count: result.filesTotal }))
    else if (result.filesWritten > 0)
      toast.error(t('book.detail.chapters.writeFiles.partial', { written: result.filesWritten, total: result.filesTotal }))
    else toast.error(t('book.detail.chapters.errors.writeFiles'))
  } catch (reason) {
    toast.error(errorMessage(reason, 'book.detail.chapters.errors.writeFiles'))
  } finally {
    void store.load({ silent: true })
  }
}

async function handleReloadAfterConflict() {
  await store.load({ silent: true })
  if (state.value) draft.reset(state.value.chapters)
}

function handleUndo() {
  draft.undo()
}

function handleRedo() {
  draft.redo()
}

function handleDiscard() {
  if (!state.value) return
  // A reset gives every row a new key, so the watcher that keeps a parked playhead on its cut cannot follow.
  const parkedOnCut = !preview.isPlaying.value && Math.round(preview.positionMs.value) === activeRow.value?.startMs
  draft.reset(state.value.chapters)
  if (parkedOnCut && activeRow.value) preview.park(activeRow.value.startMs)
}

onDeactivated(() => {
  preview.teardown()
  if (waveformTimer) clearTimeout(waveformTimer)
  waveform.clear()
})

const revertOpen = ref(false)

function handleRevertRequest() {
  revertOpen.value = true
}

function handleRevertCancel() {
  revertOpen.value = false
}

async function handleRevertConfirm() {
  try {
    const next = await store.revert()
    draft.reset(next.chapters)
    revertOpen.value = false
    toast.success(t('book.detail.chapters.revert.done'))
    emit('changed')
    void loadVersions()
  } catch (reason) {
    revertOpen.value = false
    toast.error(errorMessage(reason, 'book.detail.chapters.errors.revert'))
  }
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function focusRow(key: string) {
  draft.setActive(key)
  void nextTick(() => listCard.value?.scrollToKey(key))
}

/**
 * Choosing a chapter stops whatever is playing and parks the playhead on its start, so Play plays
 * from there and nothing keeps playing behind a different cut.
 */
function selectRow(key: string, options: { scroll?: boolean } = {}) {
  const row = rows.value.find((candidate) => candidate.key === key)
  if (!row || key === activeKey.value) return
  draft.setActive(key)
  preview.park(row.startMs)
  if (options.scroll) void nextTick(() => listCard.value?.scrollToKey(key))
}

function handleActivate(key: string) {
  selectRow(key)
}

function handleToggleSelect(key: string, range: boolean) {
  draft.toggleSelected(key, { range })
}

function handleUpdateTitle(key: string, title: string) {
  draft.updateTitle(key, title)
}

function handleCommitStart(key: string, startMs: number) {
  draft.updateStart(key, startMs)
  focusRow(key)
}

function handleSettle() {
  draft.settle()
}

function openInReader(startMs: number) {
  const fileId = state.value?.tracks[0]?.fileId
  const format = props.book.files.find((file) => file.id === fileId)?.format
  if (fileId === undefined || !format) return
  void router.push({ name: 'reader', params: { bookId: bookId.value, fileId }, query: { format, at: String(startMs) } })
}

function handleListen(startMs: number) {
  openInReader(startMs)
}

function handleCreateFirst() {
  const result = insertChapterAfter([], -1, t('book.detail.chapters.newChapter'), totalDurationMs.value, 0)
  draft.apply(result.draft)
  focusRow(result.key)
}

/** Removing the cut before a chapter joins it to the one before; no audio is removed. */
function handleRemoveCut() {
  const index = activeIndex.value
  if (index <= 0) return
  const previousKey = rows.value[index - 1]!.key
  draft.apply(removeChapters(rows.value, new Set([rows.value[index]!.key])))
  draft.setActive(previousKey)
}

function handleRemoveSelected() {
  if (selected.value.size === 0) return
  draft.apply(removeChapters(rows.value, selected.value))
  draft.clearSelection()
}

function handleSelectAll() {
  if (selected.value.size === rows.value.length) draft.clearSelection()
  else draft.selectAll()
}

// ── The cut being edited ─────────────────────────────────────────────────────

/** Every play control also stops: pressed while anything plays, this one stops it. */
function handlePlayCut() {
  const row = activeRow.value
  if (preview.isPlaying.value) {
    preview.pause()
    return
  }
  if (!row || activeIndex.value <= 0) return
  void waveform.show(row.startMs)
  void preview.playAround(row.startMs)
}

function handleStep(delta: number) {
  moveActive(delta)
}

/** The first chapter has no cut; every other start moves only as far as its neighbours allow. */
function handleNudge(deltaMs: number) {
  const row = activeRow.value
  if (!row || activeIndex.value <= 0) return
  const target = Math.min(activeMaxStartMs.value, Math.max(activeMinStartMs.value, row.startMs + deltaMs))
  if (target !== row.startMs) draft.nudge(row.key, target - row.startMs)
}

const canCutAtPlayhead = computed(() => {
  const row = activeRow.value
  const at = preview.positionMs.value
  return Boolean(row) && activeIndex.value > 0 && at >= activeMinStartMs.value && at <= activeMaxStartMs.value && Math.round(at) !== row!.startMs
})

function handleSetToPlayhead() {
  if (!activeKey.value || !canCutAtPlayhead.value) return
  draft.updateStart(activeKey.value, preview.positionMs.value)
  focusRow(activeKey.value)
}

const activeSavedStartMs = computed(() => (activeKey.value ? draft.savedStartOf(activeKey.value) : null))

const SNAP_ONE_RADIUS_MS = 5_000
/** A start this close to the snap point is already there. */
const SNAP_TOLERANCE_MS = 30
const snapping = ref(false)

function analyzePauses(...args: Parameters<AnalyzePauses>) {
  return store.analyze(...args)
}

// ── Boundary waveform ────────────────────────────────────────────────────────

const WAVEFORM_DEBOUNCE_MS = 250
const MIN_CHAPTER_GAP_MS = 1_000
/** A strip at least this wide draws the full window; a narrower one draws less, so a tenth of a second stays visible. */
const WIDE_WAVEFORM_PX = 640
const rail = ref<HTMLElement | null>(null)
const { width: railWidth } = useElementSize(rail)
const waveformWindowMs = computed(() => (railWidth.value >= WIDE_WAVEFORM_PX ? WAVEFORM_WINDOW_MS : WAVEFORM_NARROW_WINDOW_MS))
const waveform = useChapterWaveform(store.waveform, analyzePauses, () => waveformWindowMs.value)
let waveformTimer: ReturnType<typeof setTimeout> | null = null

const waveformProps = computed(() => ({ view: waveform.view.value, loading: waveform.loading.value, failed: waveform.failed.value }))
const activeMinStartMs = computed(() => (activeIndex.value > 0 ? rows.value[activeIndex.value - 1]!.startMs + MIN_CHAPTER_GAP_MS : 0))
const activeMaxStartMs = computed(() => {
  const next = rows.value[activeIndex.value + 1]
  const ceiling = next ? next.startMs : (totalDurationMs.value ?? Number.MAX_SAFE_INTEGER)
  return Math.max(activeMinStartMs.value, ceiling - MIN_CHAPTER_GAP_MS)
})

watch(
  () => [editing.value, activeRow.value?.key, activeRow.value?.startMs] as const,
  ([isEditing, key, startMs], before) => {
    if (waveformTimer) clearTimeout(waveformTimer)
    // Another chapter's audio, or none, would mislead while this one's loads.
    if (!isEditing || key === undefined || startMs === undefined || key !== before?.[1]) waveform.clear()
    if (!isEditing || key === undefined || startMs === undefined) return
    waveformTimer = setTimeout(() => void waveform.show(startMs), WAVEFORM_DEBOUNCE_MS)
  },
)

watch(waveformWindowMs, () => {
  if (editing.value && activeRow.value) void waveform.show(activeRow.value.startMs, { force: true })
})

/** While the book plays, the waveform pages along with the playhead; a cut preview stays on its cut. */
watch(
  () => preview.positionMs.value,
  (ms) => {
    if (editing.value && preview.isPlaying.value && !preview.previewingCut.value) waveform.follow(ms)
  },
)

/** A playhead parked on the cut moves with it, so Play and Move cut here keep meaning "this start". */
watch(
  () => [activeRow.value?.key, activeRow.value?.startMs] as const,
  ([key, startMs], before) => {
    if (key === undefined || startMs === undefined || key !== before?.[0] || before[1] === undefined) return
    if (!preview.isPlaying.value && Math.round(preview.positionMs.value) === before[1]) preview.park(startMs)
  },
)

function handleBackToCut() {
  if (activeRow.value) void waveform.show(activeRow.value.startMs, { force: true })
}

onBeforeUnmount(() => {
  if (waveformTimer) clearTimeout(waveformTimer)
})

function handleWaveformMove(startMs: number) {
  if (activeKey.value) draft.updateStart(activeKey.value, startMs, { coalesce: `waveform:${activeKey.value}` })
}

function handleWaveformCommit() {
  draft.settle()
}

/** Snap's answer from the pauses the waveform already listened to, so the button can say what it will do. */
const snapHint = computed<ChapterSnapHint>(() => {
  const row = activeRow.value
  const view = waveform.view.value
  if (!row || activeIndex.value <= 0 || !view || view.waveform.failed) return { state: 'unknown', targetMs: null }
  if (row.startMs < view.waveform.fromMs || row.startMs > view.waveform.toMs) return { state: 'unknown', targetMs: null }
  const picked = pickPause(row.startMs, view.pauses, SNAP_ONE_RADIUS_MS, 'end')
  if (picked === null) return { state: 'none', targetMs: null }
  const targetMs = Math.min(activeMaxStartMs.value, Math.max(activeMinStartMs.value, picked))
  return { state: Math.abs(targetMs - row.startMs) < SNAP_TOLERANCE_MS ? 'on' : 'available', targetMs }
})

async function handleSnapActive() {
  const row = activeRow.value
  if (!row || activeIndex.value <= 0 || snapping.value) return
  const hint = snapHint.value
  if (hint.state === 'available' && hint.targetMs !== null) {
    draft.updateStart(row.key, hint.targetMs)
    return
  }
  if (hint.state !== 'unknown') return
  const generation = draft.generation.value
  snapping.value = true
  try {
    const outcome = await snapToPauses(
      rows.value,
      new Set([row.key]),
      { radiusMs: SNAP_ONE_RADIUS_MS, placement: 'end', progressive: false, totalDurationMs: totalDurationMs.value },
      analyzePauses,
    )
    if (generation !== draft.generation.value) return
    const seconds = formatNumber(SNAP_ONE_RADIUS_MS / 1000)
    if (outcome.failed) toast.error(t('book.detail.chapters.errors.analyze'))
    else if (outcome.notFound) toast(t('book.detail.chapters.snap.notFoundOne', { seconds }))
    else if (outcome.blocked) toast(t('book.detail.chapters.snap.blockedOne'))
    else if (outcome.moved === 0) toast(t('book.detail.chapters.snap.alreadyThere'))
    else {
      const next = outcome.draft.find((candidate) => candidate.key === row.key)!
      draft.apply(outcome.draft)
      toast.success(
        t('book.detail.chapters.snap.movedOne', {
          time: formatChapterClock(next.startMs),
          delta: formatNumber((next.startMs - row.startMs) / 1000, { signDisplay: 'always', maximumFractionDigits: 3 }),
        }),
      )
    }
  } catch (reason) {
    toast.error(errorMessage(reason, 'book.detail.chapters.errors.analyze'))
  } finally {
    snapping.value = false
  }
}

/** A new cut at the playhead, unless it would leave a chapter under a second long. */
function handleAddCut() {
  const at = preview.positionMs.value
  const index = indexAtTime(rows.value, at)
  const end = chapterEndMs(rows.value, index, totalDurationMs.value)
  const tooClose = index < 0 || at - rows.value[index]!.startMs < MIN_CHAPTER_GAP_MS || (end !== null && end - at < MIN_CHAPTER_GAP_MS)
  const result = tooClose ? null : splitChapterAt(rows.value, at, t('book.detail.chapters.newChapter'))
  if (!result) {
    toast(t('book.detail.chapters.addCutTooClose'))
    return
  }
  draft.apply(result.draft)
  focusRow(result.key)
}

// ── Preview ──────────────────────────────────────────────────────────────────

function handlePreviewToggle() {
  void preview.toggle()
}

function handlePreviewSeek(ms: number) {
  void preview.seek(ms)
}

function handlePreviewSkip(deltaMs: number) {
  const total = totalDurationMs.value ?? Number.MAX_SAFE_INTEGER
  void preview.seek(Math.min(total, Math.max(0, preview.positionMs.value + deltaMs)))
}

// ── Sources, tools, export ───────────────────────────────────────────────────

const sourceRequest = ref<ChapterSourceRequest | null>(null)
const sourceData = shallowRef<ReviewSource | null>(null)
const sourceLoading = ref(false)
const sourceError = ref<string | null>(null)
let sourceToken = 0

function openSource(request: ChapterSourceRequest, data: ReviewSource | null = null): number {
  sourceToken += 1
  sourceRequest.value = request
  sourceData.value = data
  sourceError.value = null
  sourceLoading.value = false
  return sourceToken
}

/** Fills the open sheet from the server, dropping the answer if the sheet moved on meanwhile. */
async function loadSource(token: number, load: () => Promise<ReviewSource>, fallbackKey: string) {
  sourceLoading.value = true
  sourceError.value = null
  try {
    const data = await load()
    if (token === sourceToken) sourceData.value = data
  } catch (reason) {
    if (token === sourceToken) sourceError.value = errorMessage(reason, fallbackKey)
  } finally {
    if (token === sourceToken) sourceLoading.value = false
  }
}

function handleSourceFiles() {
  const token = openSource({ kind: 'files' })
  void loadSource(token, async () => ({ kind: 'files', chapters: await store.readEmbedded() }), 'book.detail.chapters.errors.readFiles')
}

function handleSourceTracks() {
  if (!trackChapters.value) return
  openSource({ kind: 'tracks' }, { kind: 'tracks', chapters: trackChapters.value })
}

function handleSourceImport() {
  openSource({ kind: 'import' })
}

function handleSourceLookup() {
  openSource({ kind: 'lookup' })
  const asin = state.value?.audibleId
  if (asin && state.value) handleLookup(asin, state.value.audibleRegion)
}

function handleLookup(asin: string, region: AudibleRegion) {
  sourceData.value = null
  void loadSource(
    sourceToken,
    async () => {
      const lookup = await store.lookup(asin, region)
      return { kind: 'lookup', chapters: [], lookup, runtimeMs: lookup.runtimeMs }
    },
    'book.detail.chapters.errors.lookup',
  )
}

function readEbookSource(kind: EbookChapterSource) {
  const token = openSource({ kind })
  void loadSource(
    token,
    async () => {
      const result = await store.readEbook(kind)
      return { kind, chapters: result.chapters, titlesOnly: result.titlesOnly, runtimeMs: result.runtimeMs }
    },
    'book.detail.chapters.errors.readEbook',
  )
}

function handleSourceToc() {
  readEbookSource('toc')
}

function handleSourceReadAlong() {
  readEbookSource('read_along')
}

async function handleOpenVersion(versionId: number) {
  const token = openSource({ kind: 'version' })
  await loadSource(
    token,
    async () => {
      const version = await store.getVersion(versionId)
      if (token === sourceToken) {
        sourceRequest.value = {
          kind: 'version',
          detail: version.createdBy
            ? t('book.detail.chapters.sources.version.detailBy', { when: formatDateTime(new Date(version.createdAt)), name: version.createdBy.name })
            : t('book.detail.chapters.sources.version.detail', { when: formatDateTime(new Date(version.createdAt)) }),
        }
      }
      return { kind: 'version', chapters: version.chapters }
    },
    'book.detail.chapters.errors.versions',
  )
}

function handleSourceClose() {
  sourceToken += 1
  sourceRequest.value = null
  sourceData.value = null
  sourceLoading.value = false
}

function handleSourceApply(next: DraftChapter[]) {
  draft.apply(next)
  handleSourceClose()
  toast.success(t('book.detail.chapters.sources.applied'))
}

const toolOpen = ref(false)
const tool = ref<ChapterTool>('shift')

function handleOpenTool(event: Event) {
  const value = (event.currentTarget as HTMLElement).dataset.tool as ChapterTool | undefined
  if (!value) return
  tool.value = value
  toolOpen.value = true
}

function handleToolApply(next: typeof rows.value) {
  draft.apply(next)
  toolOpen.value = false
}

function handleToolCancel() {
  toolOpen.value = false
}

const snapOpen = ref(false)

function handleOpenSnap() {
  snapOpen.value = true
}

function handleSnapApply(next: typeof rows.value) {
  draft.apply(next)
  snapOpen.value = false
}

function handleSnapCancel() {
  snapOpen.value = false
}

function handleCleanTitles() {
  const result = cleanTitles(rows.value, draft.targetKeys())
  if (result.changed === 0) {
    toast(t('book.detail.chapters.tools.clean.nothing'))
    return
  }
  draft.apply(result.draft)
  toast.success(t('book.detail.chapters.tools.clean.done', { count: result.changed }))
}

function handleExport(event: Event) {
  const format = (event.currentTarget as HTMLElement).dataset.format as Exclude<ChapterFormat, 'titles'> | undefined
  if (!format) return
  const text = serializeChapters(draft.chapters(), format, { totalDurationMs: totalDurationMs.value, title: props.book.title })
  const type = format === 'json' ? 'application/json' : 'text/plain'
  triggerBlobDownload(new Blob([text], { type: `${type};charset=utf-8` }), chapterExportFilename(props.book.title, format))
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Controls that already answer these keys themselves: a slider takes the arrows, a button takes Space. */
function ownsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('[role="slider"],[role="menu"],[role="radiogroup"]')) return true
  return key === ' ' && ['BUTTON', 'A'].includes(target.tagName)
}

function moveActive(step: number) {
  const next = rows.value[Math.min(rows.value.length - 1, Math.max(0, activeIndex.value + step))]
  if (next) selectRow(next.key, { scroll: true })
}

/** Bound to the tab itself, so the keys only act while focus is inside the editor. */
function handleKeydown(event: KeyboardEvent) {
  if (!editing.value) return
  const modifier = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()
  if (modifier && key === 's') {
    event.preventDefault()
    void handleSave()
    return
  }
  if (isTypingTarget(event.target)) return
  if (modifier && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) draft.redo()
    else draft.undo()
    return
  }
  if (modifier || ownsKey(event.target, key)) return
  const step = event.shiftKey ? 1_000 : 100
  const actions: Record<string, () => void> = {
    arrowdown: () => moveActive(1),
    arrowup: () => moveActive(-1),
    ' ': handlePreviewToggle,
    '[': () => handleNudge(-step),
    '{': () => handleNudge(-step),
    ']': () => handleNudge(step),
    '}': () => handleNudge(step),
    m: handleSetToPlayhead,
    p: handlePlayCut,
  }
  const action = actions[key]
  if (!action) return
  event.preventDefault()
  action()
}
</script>

<template>
  <div class="chapters-tab flex flex-col gap-3.5 lg:h-full lg:min-h-0" @keydown="handleKeydown">
    <button
      v-if="store.operation.value?.status === 'failed'"
      class="self-start rounded-md px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="handleRetryOperation"
    >
      {{ t('book.detail.chapters.retryOperation') }}
    </button>
    <p
      v-if="store.operation.value?.status === 'processing' || store.operation.value?.status === 'queued'"
      role="status"
      class="text-sm text-muted-foreground"
    >
      {{
        t('book.detail.chapters.operationProgress', {
          done: formatNumber(store.operation.value.filesWritten),
          total: formatNumber(store.operation.value.filesTotal),
        })
      }}
    </p>
    <div v-if="showSkeleton" class="flex flex-col gap-3.5 lg:h-full" aria-hidden="true">
      <div class="h-[5.25rem] rounded-xl bg-muted animate-shimmer" />
      <div class="min-h-80 flex-1 rounded-xl bg-muted animate-shimmer" />
    </div>

    <section
      v-else-if="loadError && !state"
      class="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-4 py-16 text-center"
    >
      <p class="text-sm font-semibold">{{ t('book.detail.chapters.errors.load') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ loadError }}</p>
      <button
        class="mt-4 inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleRetry"
      >
        {{ t('book.detail.chapters.retry') }}
      </button>
    </section>

    <template v-else-if="state">
      <ChaptersHeroBar
        :book="book"
        :state="state"
        :editing="editing"
        :can-edit="canEdit"
        :chapter-count="rows.length"
        @edit="startEditing"
        @done="finishEditing"
      />

      <div class="chapters-body lg:min-h-0 lg:flex-1" :class="{ 'with-rail': showRail }">
        <ChapterListCard
          ref="listCard"
          :rows="rows"
          :editing="editing"
          :active-key="activeKey"
          :selected="selected"
          :issues-by-key="issuesByKey"
          :total-duration-ms="totalDurationMs"
          :listening-ms="editing ? null : listeningMs"
          @activate="handleActivate"
          @toggle-select="handleToggleSelect"
          @update-title="handleUpdateTitle"
          @commit-start="handleCommitStart"
          @settle="handleSettle"
          @listen="handleListen"
        >
          <template #toolbar>
            <template v-if="editing">
              <button
                v-if="rows.length === 0"
                class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                @click="handleCreateFirst"
              >
                <ListPlus class="size-3.5" aria-hidden="true" />
                {{ t('book.detail.chapters.createFirst') }}
              </button>
              <button
                class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                @click="handleSelectAll"
              >
                <ListChecks class="size-3.5" aria-hidden="true" />
                <span class="tool-label">{{
                  selected.size === rows.length ? t('book.detail.chapters.selectNone') : t('book.detail.chapters.selectAll')
                }}</span>
              </button>
              <button
                v-if="selected.size > 0"
                class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                :disabled="selected.size >= rows.length"
                @click="handleRemoveSelected"
              >
                <Trash2 class="size-3.5" aria-hidden="true" />
                <span class="tool-label">{{ t('book.detail.chapters.removeSelected') }}</span>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button
                    class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <FileSearch class="size-3.5" aria-hidden="true" />
                    <span class="tool-label">{{ t('book.detail.chapters.find') }}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @click="handleSourceFiles">{{ t('book.detail.chapters.sources.files.menu') }}</DropdownMenuItem>
                  <DropdownMenuItem :disabled="!trackChapters || state.tracks.length < 2" @click="handleSourceTracks">
                    {{ t('book.detail.chapters.sources.tracks.menu') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @click="handleSourceLookup">{{ t('book.detail.chapters.sources.lookup.menu') }}</DropdownMenuItem>
                  <DropdownMenuItem :disabled="!state.sources.ebookFileId" @click="handleSourceToc">
                    {{ t('book.detail.chapters.sources.toc.menu') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem :disabled="!state.sources.readAlongFileId" @click="handleSourceReadAlong">
                    {{ t('book.detail.chapters.sources.readAlong.menu') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @click="handleSourceImport">{{ t('book.detail.chapters.sources.import.menu') }}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button
                    class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Wrench class="size-3.5" aria-hidden="true" />
                    <span class="tool-label">{{ t('book.detail.chapters.toolsMenu') }}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem v-for="entry in TOOLS" :key="entry.tool" :data-tool="entry.tool" @click="handleOpenTool">{{
                    t(entry.key)
                  }}</DropdownMenuItem>
                  <DropdownMenuItem @click="handleOpenSnap">{{ t('book.detail.chapters.snap.menu') }}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @click="handleCleanTitles">{{ t('book.detail.chapters.tools.clean.title') }}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <ChapterHistoryMenu
                :versions="versions"
                :loading="versionsLoading"
                :reverting="busy === 'reverting'"
                @open="handleOpenVersion"
                @revert="handleRevertRequest"
              >
                <button
                  class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <History class="size-3.5" aria-hidden="true" />
                  <span class="tool-label">{{ t('book.detail.chapters.history.heading') }}</span>
                </button>
              </ChapterHistoryMenu>
            </template>

            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Download class="size-3.5" aria-hidden="true" />
                  <span class="tool-label">{{ t('book.detail.chapters.export') }}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem v-for="entry in EXPORT_FORMATS" :key="entry.format" :data-format="entry.format" @click="handleExport">
                  {{ t(entry.key) }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </template>
          <template #band>
            <ChapterListenBand
              v-if="!editing && totalDurationMs && rows.length"
              :rows="rows"
              :total-duration-ms="totalDurationMs"
              :listening-ms="listeningMs"
              @listen="handleListen"
            />
          </template>
        </ChapterListCard>

        <div v-if="showRail && totalDurationMs" ref="rail" class="chapters-rail">
          <ChapterCutCard
            :rows="rows"
            :active-index="activeIndex"
            :total-duration-ms="totalDurationMs"
            :issues-by-key="issuesByKey"
            :saved-start-ms="activeSavedStartMs"
            :waveform="waveformProps"
            :min-start-ms="activeMinStartMs"
            :max-start-ms="activeMaxStartMs"
            :snap="snapHint"
            :snapping="snapping"
            :snap-radius-ms="SNAP_ONE_RADIUS_MS"
            :position-ms="preview.positionMs.value"
            :is-playing="preview.isPlaying.value"
            :player-loading="preview.loading.value"
            :player-error="preview.error.value"
            @step="handleStep"
            @nudge="handleNudge"
            @move="handleWaveformMove"
            @commit="handleWaveformCommit"
            @snap="handleSnapActive"
            @remove-cut="handleRemoveCut"
            @back-to-cut="handleBackToCut"
            @toggle="handlePreviewToggle"
            @play-cut="handlePlayCut"
            @skip="handlePreviewSkip"
            @seek="handlePreviewSeek"
            @move-cut-here="handleSetToPlayhead"
            @new-chapter-here="handleAddCut"
          />
        </div>
      </div>

      <ChapterSaveBar
        v-if="editing"
        v-model:lock="lockOnSave"
        :dirty="draft.isDirty.value"
        :error-count="draft.errorCount.value"
        :warning-count="draft.warningCount.value"
        :saving="busy === 'saving'"
        :can-undo="draft.canUndo.value"
        :can-redo="draft.canRedo.value"
        :write-back="state.writeBack"
        :writing="busy === 'writing'"
        @save="handleSave"
        @save-and-write="handleSaveAndWrite"
        @write-files="handleWriteSaved"
        @discard="handleDiscard"
        @undo="handleUndo"
        @redo="handleRedo"
      />
    </template>

    <ChapterToolDialog
      :open="toolOpen"
      :tool="tool"
      :rows="rows"
      :selected="selected"
      :active-index="activeIndex"
      :total-duration-ms="totalDurationMs"
      @apply="handleToolApply"
      @cancel="handleToolCancel"
    />

    <ChapterSnapDialog
      :open="snapOpen"
      :rows="rows"
      :selected="selected"
      :total-duration-ms="totalDurationMs"
      :analyze="analyzePauses"
      @apply="handleSnapApply"
      @cancel="handleSnapCancel"
    />

    <ChapterSourceSheet
      :request="sourceRequest"
      :source="sourceData"
      :current="rows"
      :total-duration-ms="totalDurationMs"
      :loading="sourceLoading"
      :error="sourceError"
      :lookup-asin="state?.audibleId ?? null"
      :lookup-region="state?.audibleRegion ?? 'us'"
      :analyze-pauses="analyzePauses"
      @apply="handleSourceApply"
      @lookup="handleLookup"
      @close="handleSourceClose"
    />

    <ConfirmDialog
      :open="writeConfirm !== null"
      :title="t('book.detail.chapters.writeFiles.confirmTitle')"
      :description="t('book.detail.chapters.writeFiles.confirmDescription', { count: writeFileCount })"
      :confirm-label="t('book.detail.chapters.writeFiles.confirm')"
      :destructive="false"
      @confirm="handleWriteConfirm"
      @cancel="handleWriteCancel"
    />

    <ConfirmDialog
      :open="discardResolver !== null"
      :title="t('book.detail.chapters.discardDialog.title')"
      :description="t('book.detail.chapters.discardDialog.description')"
      :confirm-label="t('book.detail.chapters.discardDialog.confirm')"
      @confirm="handleDiscardConfirm"
      @cancel="handleDiscardCancel"
    />

    <ConfirmDialog
      :open="revertOpen"
      :title="t('book.detail.chapters.revert.title')"
      :description="t('book.detail.chapters.revert.description')"
      :confirm-label="t('book.detail.chapters.revert.confirm')"
      :busy="busy === 'reverting'"
      @confirm="handleRevertConfirm"
      @cancel="handleRevertCancel"
    />
  </div>
</template>

<style scoped>
.chapters-tab {
  container-type: inline-size;
  container-name: chapterstab;
}

.chapters-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.875rem;
  min-height: 0;
}

/* Stacked, the cut card sits above the list it edits. */
.chapters-rail {
  order: -1;
  min-height: 0;
}

@container chapterstab (min-width: 62.5rem) {
  .chapters-body {
    grid-template-rows: minmax(0, 1fr);
  }

  .chapters-body.with-rail {
    grid-template-columns: minmax(0, 1fr) 26rem;
  }

  .chapters-rail {
    order: 0;
    overflow-y: auto;
  }
}

@container chapterstab (min-width: 90rem) {
  .chapters-body.with-rail {
    grid-template-columns: minmax(0, 1fr) 30rem;
  }
}

/* Toolbar buttons keep their icon and accessible name, and drop the visible word, on a phone. */
@container chapterstab (max-width: 40rem) {
  .tool-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
