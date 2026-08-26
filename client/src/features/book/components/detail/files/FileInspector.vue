<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, BookOpen, Clock, Copy, Download, Eye, Grid2x2, HardDrive, Headphones, History, MoreVertical, RefreshCw } from '@lucide/vue'
import type { BookDetail, WriteLogEntry } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { formatDate, formatPercent, formatRelativeFromNow } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { resolveWriteBackFields } from '@/features/book/lib/write-back-fields'
import type { TreeFile } from '@/features/book/composables/useBookFileTree'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import FileFormatGlyph from './FileFormatGlyph.vue'
import FileRoleBadge from './FileRoleBadge.vue'

const props = defineProps<{
  book: BookDetail
  file: TreeFile
  siblings: TreeFile[]
  /** Every file in the folder, for the timeline: siblings hide the audio tracks. */
  allFiles: TreeFile[]
  audioFiles: TreeFile[]
  isMultiTrackAudio: boolean
  runtimeSeconds: number | null
  startedCount: number
  fileCount: number
  formatCount: number
  folderRelative: string[]
  writeLog: WriteLogEntry[]
  canDownload: boolean
  canEdit: boolean
  canDelete: boolean
  /** Set on mobile, where the inspector replaces the tree rather than sitting beside it. */
  showBack?: boolean
  /**
   * The pane is tall enough to hold every section at once, so the field list and the history
   * each scroll inside themselves. Otherwise the inspector scrolls as one document: a wide but
   * short window is wide enough for the split and far too short for the fixed layout.
   */
  fitsWithoutScroll?: boolean
}>()

const emit = defineEmits<{
  select: [id: number]
  open: [file: TreeFile, mode?: 'peek']
  download: [file: TreeFile]
  rename: [file: TreeFile]
  remove: [file: TreeFile]
  copyPath: [file: TreeFile]
  back: []
}>()

const { t } = useI18n()

function handleBack() {
  emit('back')
}
function handleOpen() {
  emit('open', props.file)
}
function handlePeek() {
  emit('open', props.file, 'peek')
}
function handleDownload() {
  emit('download', props.file)
}
function handleRename() {
  emit('rename', props.file)
}
function handleRemove() {
  emit('remove', props.file)
}
function handleCopyPath() {
  emit('copyPath', props.file)
}
function handleSelect(id: number) {
  emit('select', id)
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('book.detail.files.duration.hoursMinutes', { hours, minutes })
  const remainder = Math.floor(seconds % 60)
  if (minutes > 0) return t('book.detail.files.duration.minutesSeconds', { minutes, seconds: remainder })
  return t('book.detail.files.duration.seconds', { seconds: remainder })
}

const writableFormats = computed(() => props.book.fileWriteStatus?.writableFormats ?? [])
const isWriteTarget = computed(() => writableFormats.value.includes(props.file.formatKey as never))
const progressPercent = computed(() => props.file.progress?.percentage ?? 0)

const readerLabel = computed(() => {
  if (!props.file.openable) return t('book.detail.files.reader.none')
  if (props.file.isAudio) return t('book.detail.files.reader.audio')
  if (props.file.group === 'comic') return t('book.detail.files.reader.comic')
  if (props.file.group === 'document') return t('book.detail.files.reader.document')
  return t('book.detail.files.reader.ebook')
})

const specs = computed(() => {
  const rows = [
    { label: t('book.detail.files.spec.format'), value: props.file.formatKey.toUpperCase() || '-' },
    { label: t('book.detail.files.spec.role'), value: t(`book.detail.files.roles.${props.file.role}`) },
    { label: t('book.detail.files.spec.size'), value: formatBytes(props.file.sizeBytes) },
    { label: t('book.detail.files.spec.length'), value: formatDuration(props.file.durationSeconds) ?? '-' },
    {
      label: t('book.detail.files.spec.added'),
      value: formatDate(new Date(props.file.createdAt), { year: 'numeric', month: 'short', day: 'numeric' }),
    },
    { label: t('book.detail.files.spec.indexed'), value: formatRelativeFromNow(new Date(props.file.createdAt)) },
    { label: t('book.detail.files.spec.opensIn'), value: readerLabel.value },
    {
      label: t('book.detail.files.spec.writeBack'),
      value: isWriteTarget.value ? t('book.detail.files.spec.targetFile') : t('book.detail.files.spec.notWritten'),
    },
  ]
  if (props.isMultiTrackAudio && props.file.track != null) {
    rows.push({
      label: t('book.detail.files.spec.track'),
      value: t('book.detail.files.trackOf', { track: props.file.track, total: props.audioFiles.length }),
    })
  }
  return rows
})

const trackStartSeconds = computed(() => {
  if (props.file.track == null) return 0
  return props.audioFiles.slice(0, props.file.track - 1).reduce((total, entry) => total + (entry.durationSeconds ?? 0), 0)
})

const writeBackFields = computed(() => resolveWriteBackFields(props.book, props.book.fileWriteStatus?.writableFields ?? []))
const filledFieldCount = computed(() => writeBackFields.value.filter((entry) => entry.value != null).length)

type TimelineEvent = { key: string; at: number; tone: 'ok' | 'failed' | 'muted'; title: string; detail: string }

/**
 * One write-back run touches every file, so a thirty-eight track audiobook logs thirty-eight
 * identical rows. Runs collapse to one line with a count, and file index dates join them so the
 * timeline says something even for a book that has never been written to.
 */
const timeline = computed<TimelineEvent[]>(() => {
  const events: TimelineEvent[] = []

  const runs = new Map<string, { entry: WriteLogEntry; count: number; durationMs: number; at: string }>()
  for (const entry of props.writeLog) {
    const key = `${entry.status}|${entry.format}|${entry.writtenAt.slice(0, 13)}`
    const run = runs.get(key) ?? { entry, count: 0, durationMs: 0, at: entry.writtenAt }
    run.count += 1
    run.durationMs += entry.durationMs ?? 0
    if (entry.writtenAt > run.at) run.at = entry.writtenAt
    runs.set(key, run)
  }
  for (const [key, run] of runs) {
    events.push({
      key,
      at: new Date(run.at).getTime(),
      tone: run.entry.status === 'success' ? 'ok' : run.entry.status === 'failed' ? 'failed' : 'muted',
      title:
        run.count > 1
          ? t('book.detail.files.timeline.writtenMany', { format: run.entry.format.toUpperCase(), count: run.count })
          : t('book.detail.files.timeline.written', { format: run.entry.format.toUpperCase() }),
      detail:
        run.entry.status === 'failed'
          ? (run.entry.errorMessage ?? t('book.detail.files.timeline.failed'))
          : t('book.detail.files.timeline.writeDetail', {
              count: run.entry.fieldsWritten.length,
              ms: run.durationMs,
              trigger: run.entry.triggeredBy,
            }),
    })
  }

  const indexedByMinute = new Map<string, TreeFile[]>()
  for (const file of props.allFiles) {
    const key = `${file.createdAt.slice(0, 16)}|${file.formatKey}`
    const bucket = indexedByMinute.get(key)
    if (bucket) bucket.push(file)
    else indexedByMinute.set(key, [file])
  }
  for (const [key, bucket] of indexedByMinute) {
    const first = bucket[0]
    if (!first) continue
    events.push({
      key: `indexed-${key}`,
      at: new Date(first.createdAt).getTime(),
      tone: 'muted',
      title:
        bucket.length > 1
          ? t('book.detail.files.timeline.indexedMany', { count: bucket.length, format: first.formatKey.toUpperCase() })
          : t('book.detail.files.timeline.indexed', { name: first.leaf }),
      detail: formatBytes(bucket.reduce((total, entry) => total + (entry.sizeBytes ?? 0), 0)),
    })
  }

  return events.sort((a, b) => b.at - a.at).slice(0, 30)
})

const toneClass: Record<TimelineEvent['tone'], string> = {
  ok: 'bg-emerald-500',
  failed: 'bg-destructive',
  muted: 'bg-muted-foreground/60',
}
</script>

<template>
  <section
    class="flex flex-col gap-3.5 rounded-xl border border-border bg-card p-4 lg:min-h-0 lg:overflow-y-auto"
    :class="fitsWithoutScroll ? 'lg:overflow-hidden' : ''"
    :aria-label="t('book.detail.files.inspectorAria')"
  >
    <!-- Header -->
    <div class="flex items-start gap-3.5">
      <button
        v-if="showBack"
        class="-ml-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('book.detail.files.backToFolder')"
        @click="handleBack"
      >
        <ArrowLeft class="size-4" />
      </button>
      <FileFormatGlyph :format="file.formatKey" size="lg" class="hidden sm:flex" />
      <div class="min-w-0 flex-1">
        <h2 class="break-words text-[15px] font-bold leading-snug sm:text-base">{{ file.leaf }}</h2>
        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <FileRoleBadge :role="file.role" />
          <span
            class="inline-flex h-[18px] items-center rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
            :style="{
              color: formatColorVar(file.formatKey),
              backgroundColor: `color-mix(in oklch, ${formatColorVar(file.formatKey)} 16%, transparent)`,
            }"
            >{{ file.formatKey || '?' }}</span
          >
          <span
            v-if="isMultiTrackAudio && file.track != null"
            class="inline-flex h-[18px] items-center rounded bg-muted px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground"
          >
            {{ t('book.detail.files.trackOf', { track: file.track, total: audioFiles.length }) }}
          </span>
          <span
            v-if="isWriteTarget"
            class="inline-flex h-[18px] items-center gap-1 rounded bg-emerald-500/15 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400"
          >
            <RefreshCw class="size-2.5" />{{ t('book.detail.files.writeTarget') }}
          </span>
          <span
            v-if="progressPercent > 0"
            class="inline-flex h-[18px] items-center rounded bg-primary/15 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-primary"
          >
            {{ t('book.detail.files.percentRead', { percent: formatPercent(progressPercent / 100) }) }}
          </span>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <button
          v-if="file.openable"
          class="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleOpen"
        >
          <Headphones v-if="file.isAudio" class="size-4" />
          <BookOpen v-else class="size-4" />
          <span class="hidden sm:inline">{{
            progressPercent > 0 ? t('book.detail.files.resume') : file.isAudio ? t('book.detail.files.play') : t('book.detail.files.read')
          }}</span>
        </button>
        <Tooltip v-if="file.openable && !file.isAudio">
          <TooltipTrigger as-child>
            <button
              class="hidden size-9 items-center justify-center rounded-md border border-input transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
              :aria-label="t('book.detail.files.peek')"
              @click="handlePeek"
            >
              <Eye class="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.detail.files.peek') }}</TooltipContent>
        </Tooltip>
        <Tooltip v-if="canDownload">
          <TooltipTrigger as-child>
            <button
              class="hidden size-9 items-center justify-center rounded-md border border-input transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
              :aria-label="t('book.detail.files.download')"
              @click="handleDownload"
            >
              <Download class="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.detail.files.download') }}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              class="inline-flex size-9 items-center justify-center rounded-md border border-input transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('book.detail.files.moreActions')"
            >
              <MoreVertical class="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem v-if="file.openable && !file.isAudio" class="sm:hidden" @click="handlePeek">
              <Eye class="mr-2 size-4" />{{ t('book.detail.files.peek') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canDownload" class="sm:hidden" @click="handleDownload">
              <Download class="mr-2 size-4" />{{ t('book.detail.files.download') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="handleCopyPath"> <Copy class="mr-2 size-4" />{{ t('book.detail.files.copyPath') }} </DropdownMenuItem>
            <DropdownMenuItem v-if="canEdit" @click="handleRename">
              <HardDrive class="mr-2 size-4" />{{ t('book.detail.files.rename') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canDelete" class="text-destructive focus:text-destructive" @click="handleRemove">
              {{ t('common.delete') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <!-- Path -->
    <div class="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2">
      <HardDrive class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <code class="min-w-0 shrink truncate font-mono text-[11px] text-muted-foreground">&hellip;/{{ folderRelative.join('/') }}/</code>
      <b class="hidden shrink-0 font-mono text-[11px] font-semibold sm:inline">{{ file.leaf }}</b>
      <span class="flex-1" />
      <button
        class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('book.detail.files.copyPath')"
        @click="handleCopyPath"
      >
        <Copy class="size-3.5" />
      </button>
    </div>

    <!-- Specs -->
    <dl class="grid shrink-0 grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="spec in specs" :key="spec.label" class="flex items-baseline justify-between gap-3 border-b border-border py-[7px]">
        <dt class="shrink-0 text-[11px] font-medium text-muted-foreground">{{ spec.label }}</dt>
        <dd class="truncate text-[12.5px] font-semibold">{{ spec.value }}</dd>
      </div>
    </dl>

    <!-- Reading position -->
    <div class="flex shrink-0 flex-col gap-2">
      <h3 class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <BookOpen class="size-3" aria-hidden="true" />
        {{ t('book.detail.files.positionHeading') }}
        <span class="ml-auto font-semibold normal-case tracking-normal">
          {{
            startedCount > 0
              ? t('book.detail.files.copiesStarted', { started: startedCount, total: fileCount })
              : t('book.detail.files.nothingStarted')
          }}
        </span>
      </h3>
      <div class="h-1.5 overflow-hidden rounded-full bg-muted">
        <span class="block h-full rounded-full bg-primary transition-[width]" :style="{ width: `${Math.min(progressPercent, 100)}%` }" />
      </div>
      <div class="flex justify-between gap-3 text-[11.5px] text-muted-foreground">
        <span>{{
          progressPercent > 0
            ? t('book.detail.files.throughFile', { percent: formatPercent(progressPercent / 100, 1) })
            : t('book.detail.files.notOpened')
        }}</span>
        <span>{{
          file.progress?.updatedAt
            ? t('book.detail.files.lastRead', { time: formatRelativeFromNow(new Date(file.progress.updatedAt)) })
            : t('book.detail.files.noPosition')
        }}</span>
      </div>
    </div>

    <!-- Where the track sits -->
    <div v-if="isMultiTrackAudio && file.isAudio" class="flex shrink-0 flex-col gap-2">
      <h3 class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Clock class="size-3" aria-hidden="true" />
        {{ t('book.detail.files.trackPositionHeading') }}
        <span v-if="runtimeSeconds" class="ml-auto font-semibold normal-case tracking-normal">{{
          t('book.detail.files.totalRuntime', { duration: formatDuration(runtimeSeconds) })
        }}</span>
      </h3>
      <div class="flex h-6 gap-px overflow-hidden rounded-md">
        <button
          v-for="track in audioFiles"
          :key="track.id"
          class="h-full min-w-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :style="{
            flex: `${Math.max(track.durationSeconds ?? 1, 1)} 1 0`,
            backgroundColor:
              track.id === file.id ? formatColorVar(track.formatKey) : `color-mix(in oklch, ${formatColorVar(track.formatKey)} 26%, transparent)`,
          }"
          :aria-label="t('book.detail.files.trackOf', { track: track.track, total: audioFiles.length })"
          :aria-current="track.id === file.id ? 'true' : undefined"
          @click="handleSelect(track.id)"
        />
      </div>
      <div class="flex justify-between gap-3 text-[10.5px] text-muted-foreground">
        <span>{{ t('book.detail.files.startsAt', { time: formatDuration(trackStartSeconds) ?? '0s' }) }}</span>
        <span>{{ t('book.detail.files.trackLength', { duration: formatDuration(file.durationSeconds) ?? '-' }) }}</span>
      </div>
    </div>

    <!-- Switch file -->
    <div v-if="siblings.length" class="flex shrink-0 flex-col gap-2">
      <h3 class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Grid2x2 class="size-3" aria-hidden="true" />
        {{ t('book.detail.files.switchFileHeading') }}
        <span class="ml-auto font-semibold normal-case tracking-normal">{{ t('book.detail.files.formatsInFolder', { count: formatCount }) }}</span>
      </h3>
      <ul class="flex flex-wrap gap-2">
        <li v-for="sibling in siblings" :key="sibling.id">
          <button
            class="flex items-center gap-2 rounded-lg border border-border py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="handleSelect(sibling.id)"
          >
            <FileFormatGlyph :format="sibling.formatKey" size="sm" />
            <span class="text-[11.5px] font-semibold">{{
              isMultiTrackAudio && sibling.isAudio ? t('book.detail.files.audiobook') : sibling.formatKey.toUpperCase()
            }}</span>
            <span class="text-[10.5px] text-muted-foreground">{{
              isMultiTrackAudio && sibling.isAudio ? t('book.detail.files.trackCount', { count: audioFiles.length }) : formatBytes(sibling.sizeBytes)
            }}</span>
            <FileRoleBadge v-if="sibling.role !== 'content' && sibling.role !== 'primary'" :role="sibling.role" />
          </button>
        </li>
      </ul>
    </div>

    <!-- Write-back values -->
    <div class="flex flex-col gap-2" :class="fitsWithoutScroll ? 'min-h-[8.25rem] shrink' : ''">
      <h3 class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <RefreshCw class="size-3" aria-hidden="true" />
        {{ t('book.detail.files.writeBackHeading') }}
        <span class="ml-auto font-semibold normal-case tracking-normal">{{
          book.lastWrittenAt
            ? t('book.detail.files.lastRun', { time: formatRelativeFromNow(new Date(book.lastWrittenAt)) })
            : t('book.detail.files.neverRun')
        }}</span>
      </h3>
      <div class="flex flex-col overflow-hidden rounded-lg border border-border bg-muted/40" :class="fitsWithoutScroll ? 'min-h-0 flex-1' : ''">
        <p class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[11.5px] text-muted-foreground">
          <span
            class="inline-flex h-[18px] items-center rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
            :class="book.fileWriteStatus?.enabled ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'"
            >{{ book.fileWriteStatus?.enabled ? t('book.detail.files.enabled') : t('book.detail.files.disabled') }}</span
          >
          <span>{{ t('book.detail.files.fieldsWithValue', { filled: filledFieldCount, total: writeBackFields.length }) }}</span>
          <span
            v-for="format in writableFormats"
            :key="format"
            class="ml-auto inline-flex h-[18px] items-center rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
            :style="{ color: formatColorVar(format), backgroundColor: `color-mix(in oklch, ${formatColorVar(format)} 16%, transparent)` }"
            >{{ format }}</span
          >
        </p>
        <dl
          class="grid grid-cols-1 gap-x-5 px-3 pb-2 pt-0.5 xl:grid-cols-2"
          :class="fitsWithoutScroll ? 'min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-14px),transparent)]' : ''"
        >
          <div v-for="entry in writeBackFields" :key="entry.field" class="flex items-baseline justify-between gap-3.5 border-b border-border py-1">
            <dt class="shrink-0 text-[11px] text-muted-foreground">{{ entry.label }}</dt>
            <dd
              class="truncate text-[11.5px]"
              :class="entry.value == null ? 'italic text-muted-foreground' : 'font-semibold'"
              :title="entry.value ?? ''"
            >
              {{ entry.value ?? t('book.detail.files.notSet') }}
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- History -->
    <div class="flex flex-col gap-1" :class="fitsWithoutScroll ? 'min-h-[7rem] flex-[1_1_0]' : ''">
      <h3 class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <History class="size-3" aria-hidden="true" />
        {{ t('book.detail.files.historyHeading') }}
      </h3>
      <ul
        :class="fitsWithoutScroll ? 'min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent)]' : ''"
      >
        <li v-for="event in timeline" :key="event.key" class="flex gap-2.5 border-b border-border py-1.5 last:border-b-0">
          <span class="mt-[5px] size-[7px] shrink-0 rounded-full" :class="toneClass[event.tone]" aria-hidden="true" />
          <div class="min-w-0">
            <p class="truncate text-[11.5px] font-semibold">{{ event.title }}</p>
            <p class="truncate text-[10.5px] text-muted-foreground">{{ event.detail }} · {{ formatRelativeFromNow(event.at) }}</p>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
