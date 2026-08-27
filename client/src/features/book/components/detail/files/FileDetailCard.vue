<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Copy, Download, Eye, Headphones, MoreVertical } from '@lucide/vue'
import { formatBytes } from '@/lib/formatting'
import { formatDate, formatPercent, formatRelativeFromNow } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import type { TreeFile } from '@/features/book/composables/useBookFileTree'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import FileFormatGlyph from './FileFormatGlyph.vue'

const RING_SIZE = 42
const RING_RADIUS = RING_SIZE / 2 - 3
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const props = defineProps<{
  file: TreeFile
  audioFiles: TreeFile[]
  isMultiTrackAudio: boolean
  runtimeSeconds: number | null
  isWriteTarget: boolean
  canDownload: boolean
  canEdit: boolean
  canDelete: boolean
}>()

const emit = defineEmits<{
  open: [file: TreeFile, mode?: 'peek']
  download: [file: TreeFile]
  rename: [file: TreeFile]
  remove: [file: TreeFile]
  copyPath: [file: TreeFile]
}>()

const { t } = useI18n()

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('book.detail.files.duration.hoursMinutes', { hours, minutes })
  const remainder = Math.floor(seconds % 60)
  if (minutes > 0) return t('book.detail.files.duration.minutesSeconds', { minutes, seconds: remainder })
  return t('book.detail.files.duration.seconds', { seconds: remainder })
}

const progressPercent = computed(() => props.file.progress?.percentage ?? 0)
const isAudioTrack = computed(() => props.isMultiTrackAudio && props.file.isAudio && props.file.track != null)

const specs = computed(() => {
  const rows: { label: string; value: string }[] = [{ label: t('book.detail.files.spec.size'), value: formatBytes(props.file.sizeBytes) }]
  const length = formatDuration(props.file.durationSeconds)
  if (length) rows.push({ label: t('book.detail.files.spec.length'), value: length })
  rows.push({
    label: t('book.detail.files.spec.added'),
    value: formatDate(new Date(props.file.createdAt), { year: 'numeric', month: 'short', day: 'numeric' }),
  })
  return rows
})

const trackStartSeconds = computed(() => {
  if (props.file.track == null) return 0
  return props.audioFiles.slice(0, props.file.track - 1).reduce((total, entry) => total + (entry.durationSeconds ?? 0), 0)
})

const ringOffset = computed(() => RING_CIRCUMFERENCE * (1 - Math.min(progressPercent.value, 100) / 100))

const ribbonLabel = computed(() =>
  t('book.detail.files.trackFrom', {
    track: props.file.track,
    total: props.audioFiles.length,
    time: formatDuration(trackStartSeconds.value) ?? '0s',
  }),
)

const openLabel = computed(() => {
  if (props.file.isAudio) return t('book.detail.files.play')
  return progressPercent.value > 0 ? t('book.detail.files.resume') : t('book.detail.files.read')
})

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
</script>

<template>
  <section class="flex shrink-0 flex-col rounded-xl border border-border bg-card" :aria-label="t('book.detail.files.thisFile')">
    <div class="flex h-[38px] shrink-0 items-center border-b border-border px-3.5">
      <h3 class="text-[10.5px] font-bold uppercase leading-none tracking-[0.09em] text-muted-foreground">{{ t('book.detail.files.thisFile') }}</h3>
    </div>

    <div class="flex flex-col gap-3.5 px-3.5 py-3.5">
      <div class="flex items-start gap-3">
        <FileFormatGlyph :format="file.formatKey" size="lg" />
        <div class="min-w-0 flex-1">
          <p class="line-clamp-3 text-[13.5px] font-semibold leading-snug [overflow-wrap:anywhere]" :title="file.leaf">{{ file.leaf }}</p>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              v-if="file.role === 'primary'"
              class="inline-flex h-[18px] items-center rounded bg-primary/15 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-primary"
            >
              {{ t('book.detail.files.roles.primary') }}
            </span>
            <span
              v-if="isWriteTarget"
              class="inline-flex h-[18px] items-center rounded bg-success/15 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-success"
            >
              {{ t('book.detail.files.writeTarget') }}
            </span>
            <span
              v-if="isAudioTrack"
              class="inline-flex h-[18px] items-center rounded bg-muted px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground tabular-nums"
            >
              {{ t('book.detail.files.trackOf', { track: file.track, total: audioFiles.length }) }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex h-[34px] items-center gap-2 rounded-lg border border-border bg-muted/40 px-2">
        <code class="path-tail min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground" :title="file.absolutePath">
          <bdi>{{ file.absolutePath }}</bdi>
        </code>
        <button
          class="inline-flex size-[22px] shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('book.detail.files.copyPath')"
          @click="handleCopyPath"
        >
          <Copy class="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <dl>
        <div
          v-for="spec in specs"
          :key="spec.label"
          class="flex h-[31px] items-center justify-between gap-3.5 border-b border-border last:border-b-0"
        >
          <dt class="shrink-0 text-[12.5px] leading-none text-muted-foreground">{{ spec.label }}</dt>
          <dd class="truncate text-[13px] font-medium leading-none tabular-nums">{{ spec.value }}</dd>
        </div>
      </dl>

      <!-- Where this track sits in the whole runtime -->
      <div v-if="isAudioTrack" class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2.5 text-xs leading-none text-muted-foreground">
          <span class="truncate">
            {{ t('book.detail.files.trackFrom', { track: file.track, total: audioFiles.length, time: formatDuration(trackStartSeconds) ?? '0s' }) }}
          </span>
          <span v-if="runtimeSeconds" class="shrink-0 tabular-nums">
            {{ t('book.detail.files.totalRuntime', { duration: formatDuration(runtimeSeconds) }) }}
          </span>
        </div>
        <div class="flex h-5 gap-px overflow-hidden rounded-md" role="img" :aria-label="ribbonLabel">
          <span
            v-for="track in audioFiles"
            :key="track.id"
            class="h-full min-w-px"
            :style="{
              flex: `${Math.max(track.durationSeconds ?? 1, 1)} 1 0`,
              backgroundColor:
                track.id === file.id ? formatColorVar(track.formatKey) : `color-mix(in oklch, ${formatColorVar(track.formatKey)} 22%, transparent)`,
            }"
          />
        </div>
      </div>

      <div class="flex items-center gap-3">
        <svg :width="RING_SIZE" :height="RING_SIZE" :viewBox="`0 0 ${RING_SIZE} ${RING_SIZE}`" class="shrink-0" aria-hidden="true">
          <circle :cx="RING_SIZE / 2" :cy="RING_SIZE / 2" :r="RING_RADIUS" fill="none" stroke="var(--muted)" stroke-width="3" />
          <circle
            :cx="RING_SIZE / 2"
            :cy="RING_SIZE / 2"
            :r="RING_RADIUS"
            fill="none"
            stroke="var(--primary)"
            stroke-width="3"
            stroke-linecap="round"
            :stroke-dasharray="RING_CIRCUMFERENCE"
            :stroke-dashoffset="ringOffset"
            :transform="`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`"
          />
          <text x="50%" y="50%" text-anchor="middle" dy="0.35em" fill="currentColor" font-size="12" font-weight="600">
            {{ formatPercent(progressPercent / 100) }}
          </text>
        </svg>
        <div class="min-w-0 flex-1">
          <p class="text-[12.5px] font-medium leading-snug">
            {{
              progressPercent > 0
                ? t('book.detail.files.throughCopy', { percent: formatPercent(progressPercent / 100) })
                : t('book.detail.files.notOpened')
            }}
          </p>
          <p class="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            {{
              file.progress?.updatedAt
                ? t('book.detail.files.lastRead', { time: formatRelativeFromNow(new Date(file.progress.updatedAt)) })
                : t('book.detail.files.noPosition')
            }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <button
          v-if="file.openable"
          class="inline-flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleOpen"
        >
          <Headphones v-if="file.isAudio" class="size-4" aria-hidden="true" />
          <BookOpen v-else class="size-4" aria-hidden="true" />
          {{ openLabel }}
        </button>
        <Tooltip v-if="file.openable && !file.isAudio">
          <TooltipTrigger as-child>
            <button
              class="inline-flex size-[34px] items-center justify-center rounded-lg border border-input transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('book.detail.files.peek')"
              @click="handlePeek"
            >
              <Eye class="size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.detail.files.peek') }}</TooltipContent>
        </Tooltip>
        <Tooltip v-if="canDownload">
          <TooltipTrigger as-child>
            <button
              class="inline-flex size-[34px] items-center justify-center rounded-lg border border-input transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('book.detail.files.download')"
              @click="handleDownload"
            >
              <Download class="size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.detail.files.download') }}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              class="inline-flex size-[34px] items-center justify-center rounded-lg border border-input transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('book.detail.files.moreActions')"
            >
              <MoreVertical class="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="handleCopyPath">{{ t('book.detail.files.copyPath') }}</DropdownMenuItem>
            <DropdownMenuItem v-if="canEdit" @click="handleRename">{{ t('book.detail.files.rename') }}</DropdownMenuItem>
            <DropdownMenuItem v-if="canDelete" class="text-destructive focus:text-destructive" @click="handleRemove">
              {{ t('common.delete') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * A path is read from its tail: the volume it starts on matters far less than the folder and the
 * file it ends on. Flipping the box's direction moves the ellipsis to the front, and the `bdi`
 * keeps the path itself rendering left to right.
 */
.path-tail {
  direction: rtl;
  text-align: left;
}
</style>
