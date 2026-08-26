import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FORMAT_TO_GROUP, READER_OPENABLE_FORMATS, type BookDetail, type BookDetailFile } from '@bookorbit/types'
import { api } from '@/lib/api'
import { applyCommonStem } from '@/features/book/lib/filename-stem'

/** Per-file reading position. Mirrors the row shape `GET /api/v1/books/:id/progress` returns. */
export type FileProgress = {
  percentage: number
  updatedAt: string | null
}

/** Reader families, in the order a folder reads best: what you open, then what supports it. */
const GROUP_ORDER = ['ebook', 'document', 'comic', 'audio', 'extras'] as const
export type FileGroupKey = (typeof GROUP_ORDER)[number]

export type TreeFile = BookDetailFile & {
  /** Lower-cased format, or an empty string when the scan could not name one. */
  formatKey: string
  group: FileGroupKey
  /** Filename with no directory part, always present even when `filename` is null. */
  leaf: string
  /** What the row shows: the tail when the group's stem applies, the whole filename otherwise. */
  display: string
  /** 1-based position among the audio files, for a multi-track audiobook. */
  track: number | null
  progress: FileProgress | null
  openable: boolean
  isAudio: boolean
}

export type FileGroup = {
  key: FileGroupKey
  label: string
  /** The prefix every row in this group gave up, shown once in the group header. */
  stem: string
  files: TreeFile[]
}

export type FormatShare = {
  format: string
  count: number
  sizeBytes: number
  /** Share of the folder's bytes, 0-1. */
  fraction: number
}

export type SortKey = 'name' | 'format' | 'size' | 'date'
export type SortDirection = 'asc' | 'desc'

function groupOf(format: string): FileGroupKey {
  const group = FORMAT_TO_GROUP[format]
  if (group === 'audio') return 'audio'
  if (group === 'pdf') return 'document'
  if (group === 'cbx') return 'comic'
  return group === 'epub' ? 'ebook' : 'extras'
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function useBookFileTree(book: Ref<BookDetail>) {
  const { t } = useI18n()

  const sortKey = ref<SortKey>('name')
  const sortDirection = ref<SortDirection>('asc')
  const selectedFileId = ref<number | null>(null)
  const progressByFileId = ref<Record<number, FileProgress>>({})

  const files = computed<TreeFile[]>(() => {
    const audioIds = new Map<number, number>()
    let track = 0
    for (const file of book.value.files) {
      if (file.format && FORMAT_TO_GROUP[file.format] === 'audio') {
        track += 1
        audioIds.set(file.id, track)
      }
    }

    return book.value.files.map((file) => {
      const formatKey = file.format?.toLowerCase() ?? ''
      return {
        ...file,
        formatKey,
        group: formatKey ? groupOf(formatKey) : 'extras',
        leaf: file.filename ?? file.absolutePath.split('/').pop() ?? '-',
        display: file.filename ?? file.absolutePath.split('/').pop() ?? '-',
        track: audioIds.get(file.id) ?? null,
        progress: progressByFileId.value[file.id] ?? null,
        openable: READER_OPENABLE_FORMATS.has(formatKey),
        isAudio: FORMAT_TO_GROUP[formatKey] === 'audio',
      }
    })
  })

  const audioFiles = computed(() => files.value.filter((file) => file.isAudio))
  const isMultiTrackAudio = computed(() => audioFiles.value.length > 1)

  const totalBytes = computed(() => files.value.reduce((total, file) => total + (file.sizeBytes ?? 0), 0))

  const runtimeSeconds = computed(() => {
    const declared = book.value.audioMetadata?.durationSeconds
    if (declared != null) return declared
    const summed = audioFiles.value.reduce((total, file) => total + (file.durationSeconds ?? 0), 0)
    return summed > 0 ? summed : null
  })

  const formatShares = computed<FormatShare[]>(() => {
    const byFormat = new Map<string, FormatShare>()
    for (const file of files.value) {
      const format = file.formatKey || '?'
      const entry = byFormat.get(format) ?? { format, count: 0, sizeBytes: 0, fraction: 0 }
      entry.count += 1
      entry.sizeBytes += file.sizeBytes ?? 0
      byFormat.set(format, entry)
    }
    const total = totalBytes.value
    return [...byFormat.values()]
      .map((entry) => ({ ...entry, fraction: total > 0 ? entry.sizeBytes / total : 0 }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
  })

  function compare(a: TreeFile, b: TreeFile): number {
    const direction = sortDirection.value === 'asc' ? 1 : -1
    switch (sortKey.value) {
      case 'format':
        return direction * (collator.compare(a.formatKey, b.formatKey) || collator.compare(a.leaf, b.leaf))
      case 'size':
        return direction * ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))
      case 'date':
        return direction * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      default:
        return direction * collator.compare(a.leaf, b.leaf)
    }
  }

  const groupLabels: Record<FileGroupKey, string> = {
    ebook: 'book.detail.files.groups.ebook',
    document: 'book.detail.files.groups.document',
    comic: 'book.detail.files.groups.comic',
    audio: 'book.detail.files.groups.audio',
    extras: 'book.detail.files.groups.extras',
  }

  const groups = computed<FileGroup[]>(() => {
    const byGroup = new Map<FileGroupKey, TreeFile[]>()
    for (const file of files.value) {
      const bucket = byGroup.get(file.group)
      if (bucket) bucket.push(file)
      else byGroup.set(file.group, [file])
    }

    return GROUP_ORDER.filter((key) => byGroup.has(key)).map((key) => {
      const sorted = [...(byGroup.get(key) ?? [])].sort(compare)
      const { stem, names } = applyCommonStem(sorted.map((file) => file.leaf))
      return {
        key,
        label: t(groupLabels[key]),
        stem,
        files: sorted.map((file, index) => ({ ...file, display: names[index]?.display ?? file.leaf })),
      }
    })
  })

  const flatFiles = computed(() => groups.value.flatMap((group) => group.files))

  const selectedFile = computed<TreeFile | null>(() => {
    const list = flatFiles.value
    if (list.length === 0) return null
    return list.find((file) => file.id === selectedFileId.value) ?? list.find((file) => file.role === 'primary') ?? list[0] ?? null
  })

  /** Every other file worth switching to: a thirty-five track audiobook counts once, not thirty-five times. */
  const siblingFiles = computed<TreeFile[]>(() => {
    const current = selectedFile.value
    if (!current) return []
    const rest = flatFiles.value.filter((file) => file.id !== current.id && !(isMultiTrackAudio.value && file.isAudio))
    if (isMultiTrackAudio.value && !current.isAudio && audioFiles.value[0]) rest.push(audioFiles.value[0])
    return rest
  })

  const startedCount = computed(() => files.value.filter((file) => (file.progress?.percentage ?? 0) > 0).length)

  /** Library root split off the front, so a row never repeats ninety characters of absolute path. */
  const folderSegments = computed(() => {
    const segments = (book.value.folderPath ?? '').split('/').filter(Boolean)
    const libraryIndex = segments.indexOf(book.value.libraryName)
    const cut = libraryIndex >= 0 ? libraryIndex : Math.max(0, segments.length - 3)
    return { root: `/${segments.slice(0, cut).join('/')}`, relative: segments.slice(cut) }
  })

  function selectFile(id: number) {
    selectedFileId.value = id
  }

  function toggleSort(key: SortKey) {
    if (sortKey.value === key) sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
    else {
      sortKey.value = key
      sortDirection.value = 'asc'
    }
  }

  let progressRequestId = 0

  async function loadProgress() {
    const requestId = ++progressRequestId
    try {
      const response = await api(`/api/v1/books/${book.value.id}/progress`)
      if (!response.ok) return
      const rows = (await response.json()) as { fileId: number; percentage: number; updatedAt: string | null }[]
      if (requestId !== progressRequestId) return
      const next: Record<number, FileProgress> = {}
      for (const row of rows) {
        if (!Number.isFinite(row.fileId)) continue
        next[row.fileId] = { percentage: row.percentage, updatedAt: row.updatedAt }
      }
      progressByFileId.value = next
    } catch {
      if (requestId === progressRequestId) progressByFileId.value = {}
    }
  }

  watch(
    () => book.value.id,
    () => {
      selectedFileId.value = null
      progressByFileId.value = {}
      void loadProgress()
    },
    { immediate: true },
  )

  return {
    files,
    groups,
    flatFiles,
    audioFiles,
    isMultiTrackAudio,
    totalBytes,
    runtimeSeconds,
    formatShares,
    selectedFile,
    selectedFileId,
    siblingFiles,
    startedCount,
    folderSegments,
    sortKey,
    sortDirection,
    selectFile,
    toggleSort,
    reloadProgress: loadProgress,
  }
}
