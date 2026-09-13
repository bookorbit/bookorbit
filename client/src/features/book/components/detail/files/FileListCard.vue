<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, MoreVertical } from '@lucide/vue'
import { formatBytes } from '@/lib/formatting'
import { formatPercent } from '@/i18n/formatters'
import { splitExtension } from '@/features/book/lib/filename-stem'
import type { FileGroup, TreeFile } from '@/features/book/composables/useBookFileTree'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import FileFormatGlyph from './FileFormatGlyph.vue'
import FileRoleBadge from './FileRoleBadge.vue'

/** Rows shown before an expanded audiobook offers "show all"; two screens is already generous. */
const TRACK_PREVIEW_LIMIT = 24

const props = defineProps<{
  groups: FileGroup[]
  selectedId: number | null
  runtimeLabel: string | null
  canDownload: boolean
  canEdit: boolean
  canDelete: boolean
}>()

const emit = defineEmits<{
  select: [id: number]
  open: [file: TreeFile]
  download: [file: TreeFile]
  rename: [file: TreeFile]
  remove: [file: TreeFile]
  copyPath: [file: TreeFile]
}>()

const { t } = useI18n()

/**
 * A thirty-five track audiobook is one thing you own, not thirty-five decisions. It rolls up to a
 * single Play row and opens on request, which is the difference between a page and a wall.
 */
const expandedGroups = ref<Set<string>>(new Set())
const showAllTracks = ref<Set<string>>(new Set())

watch(
  () => props.groups.map((group) => group.key).join(','),
  () => {
    expandedGroups.value = new Set()
    showAllTracks.value = new Set()
  },
)

function isCollapsible(group: FileGroup): boolean {
  return group.key === 'audio' && group.files.length > 1
}

function isRolled(group: FileGroup): boolean {
  return group.key === 'audio' && group.files.length > 1 && !expandedGroups.value.has(group.key)
}

function visibleFiles(group: FileGroup): TreeFile[] {
  if (group.key !== 'audio' || showAllTracks.value.has(group.key)) return group.files
  return group.files.slice(0, TRACK_PREVIEW_LIMIT)
}

function hiddenCount(group: FileGroup): number {
  return group.files.length - visibleFiles(group).length
}

function toggleGroup(group: FileGroup) {
  const next = new Set(expandedGroups.value)
  if (next.has(group.key)) next.delete(group.key)
  else next.add(group.key)
  expandedGroups.value = next
}

function playGroup(group: FileGroup) {
  const first = group.files[0]
  if (first) emit('open', first)
}

function revealAllTracks(group: FileGroup) {
  showAllTracks.value = new Set(showAllTracks.value).add(group.key)
}

function groupBytes(group: FileGroup): number {
  return group.files.reduce((total, file) => total + (file.sizeBytes ?? 0), 0)
}

function durationLabel(seconds: number | null): string | null {
  if (seconds == null) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('book.detail.files.duration.hoursMinutes', { hours, minutes })
  return t('book.detail.files.duration.minutes', { minutes: Math.max(minutes, 1) })
}

/** The stacked phone row states format, size and length once, where the columns cannot fit. */
function stackedMeta(file: TreeFile): string {
  const parts = [file.formatKey.toUpperCase() || '?', formatBytes(file.sizeBytes)]
  const duration = durationLabel(file.durationSeconds)
  if (duration) parts.push(duration)
  return parts.join(' · ')
}

function progressOf(file: TreeFile): number {
  return file.progress?.percentage ?? 0
}

/** Group accents come from the reader-family tokens; `extras` has no accent of its own. */
const GROUP_ACCENT: Record<string, string> = {
  ebook: 'var(--format-ebook)',
  document: 'var(--format-document)',
  comic: 'var(--format-comic)',
  audio: 'var(--format-audio)',
  extras: 'var(--format-other)',
}

function handleSelect(file: TreeFile) {
  emit('select', file.id)
}
function handleOpen(file: TreeFile) {
  emit('open', file)
}
function handleDownload(file: TreeFile) {
  emit('download', file)
}
function handleRename(file: TreeFile) {
  emit('rename', file)
}
function handleRemove(file: TreeFile) {
  emit('remove', file)
}
function handleCopyPath(file: TreeFile) {
  emit('copyPath', file)
}
</script>

<template>
  <section
    class="flex min-h-0 flex-col self-start overflow-hidden rounded-xl border border-border bg-card lg:max-h-full"
    :aria-label="t('book.detail.files.filesHeading')"
  >
    <div class="flex h-[38px] shrink-0 items-center gap-2.5 border-b border-border px-3.5">
      <h3 class="text-[10.5px] font-bold uppercase tracking-[0.09em] leading-none text-muted-foreground">
        {{ t('book.detail.files.filesHeading') }}
      </h3>
      <span class="ml-auto truncate text-[11.5px] leading-none text-muted-foreground">{{ t('book.detail.files.groupedByReader') }}</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
      <template v-for="group in groups" :key="group.key">
        <div class="flex h-[30px] items-center gap-2.5 px-2.5">
          <span class="size-[7px] shrink-0 rounded-full" :style="{ backgroundColor: GROUP_ACCENT[group.key] }" aria-hidden="true" />
          <h4 class="shrink-0 text-[11px] font-bold uppercase tracking-[0.07em] leading-none">{{ group.label }}</h4>
          <span v-if="group.stem" class="min-w-0 truncate font-mono text-[11px] leading-none text-muted-foreground" :title="group.stem"
            >{{ group.stem }}&hellip;</span
          >
          <span class="ml-auto shrink-0 whitespace-nowrap text-[11.5px] leading-none text-muted-foreground tabular-nums">
            {{ group.files.length }} &middot; {{ formatBytes(groupBytes(group)) }}
          </span>
          <button
            v-if="isCollapsible(group)"
            class="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-expanded="!isRolled(group)"
            :aria-label="isRolled(group) ? t('book.detail.files.showAllTracks') : t('book.detail.files.collapseTracks')"
            @click="toggleGroup(group)"
          >
            <ChevronDown class="size-4 transition-transform" :class="isRolled(group) ? '' : 'rotate-180'" aria-hidden="true" />
          </button>
        </div>

        <!-- Rolled-up audiobook -->
        <div
          v-if="isRolled(group)"
          class="file-row my-0.5 flex min-h-[3.25rem] items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-2.5"
        >
          <FileFormatGlyph :format="group.files[0]?.formatKey ?? 'mp3'" size="sm" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13.5px] leading-tight">
              {{ t('book.detail.files.tracksRolled', { count: group.files.length }) }}
              <span class="text-muted-foreground">&middot; {{ (group.files[0]?.formatKey ?? '').toUpperCase() }}</span>
            </span>
            <span class="row-stacked mt-1 hidden text-[11.5px] leading-none text-muted-foreground tabular-nums">
              {{ [runtimeLabel, formatBytes(groupBytes(group))].filter(Boolean).join(' · ') }}
            </span>
          </span>
          <span
            v-if="runtimeLabel"
            class="row-col w-[3.875rem] shrink-0 whitespace-nowrap text-right text-[12.5px] text-muted-foreground tabular-nums"
          >
            {{ runtimeLabel }}
          </span>
          <span class="row-col w-[4.625rem] shrink-0 whitespace-nowrap text-right text-[12.5px] text-muted-foreground tabular-nums">
            {{ formatBytes(groupBytes(group)) }}
          </span>
          <span class="flex shrink-0 items-center justify-end gap-1.5">
            <button
              class="inline-flex h-7 min-w-[3.5rem] items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="playGroup(group)"
            >
              {{ t('book.detail.files.play') }}
            </button>
          </span>
        </div>

        <!-- Files -->
        <template v-else>
          <div
            v-for="file in visibleFiles(group)"
            :key="file.id"
            class="file-row relative flex min-h-[2.875rem] items-center gap-2.5 rounded-lg px-2.5 transition-colors"
            :class="file.id === selectedId ? 'bg-primary/15 shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-muted/50'"
          >
            <button
              class="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              :aria-label="`${t('book.detail.files.openDetails')}: ${file.leaf}`"
              :aria-current="file.id === selectedId ? 'true' : undefined"
              @click="handleSelect(file)"
            />
            <FileFormatGlyph :format="file.formatKey" size="sm" class="pointer-events-none relative" />
            <span class="pointer-events-none relative min-w-0 flex-1">
              <span class="row-name flex items-baseline text-[13.5px] leading-tight" :title="file.leaf">
                <span class="row-base min-w-0 truncate">{{ splitExtension(file.display).base }}</span>
                <span class="shrink-0 text-muted-foreground">{{ splitExtension(file.display).extension }}</span>
              </span>
              <span class="row-stacked mt-1 hidden text-[11.5px] leading-none text-muted-foreground tabular-nums">{{ stackedMeta(file) }}</span>
            </span>
            <FileRoleBadge v-if="file.role !== 'content' && file.role !== 'primary'" :role="file.role" class="pointer-events-none relative" />
            <span
              v-if="progressOf(file) > 0"
              class="pointer-events-none relative inline-flex h-[18px] shrink-0 items-center rounded bg-primary/15 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-primary tabular-nums"
            >
              {{ t('book.detail.files.percentRead', { percent: formatPercent(progressOf(file) / 100) }) }}
            </span>
            <span
              v-if="durationLabel(file.durationSeconds)"
              class="row-col pointer-events-none relative w-[3.875rem] shrink-0 whitespace-nowrap text-right text-[12.5px] text-muted-foreground tabular-nums"
            >
              {{ durationLabel(file.durationSeconds) }}
            </span>
            <span
              class="row-col pointer-events-none relative w-[4.625rem] shrink-0 whitespace-nowrap text-right text-[12.5px] text-muted-foreground tabular-nums"
            >
              {{ formatBytes(file.sizeBytes) }}
            </span>

            <span class="relative flex shrink-0 items-center justify-end gap-1.5">
              <button
                v-if="file.openable"
                class="inline-flex h-7 min-w-[3.5rem] items-center justify-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="
                  file.id === selectedId
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-input text-foreground hover:bg-muted'
                "
                @click="handleOpen(file)"
              >
                {{ file.isAudio ? t('book.detail.files.play') : progressOf(file) > 0 ? t('book.detail.files.resume') : t('book.detail.files.read') }}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button
                    class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :aria-label="t('book.detail.files.moreActions')"
                  >
                    <MoreVertical class="size-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @click="handleCopyPath(file)">{{ t('book.detail.files.copyPath') }}</DropdownMenuItem>
                  <DropdownMenuItem v-if="canDownload" @click="handleDownload(file)">{{ t('book.detail.files.download') }}</DropdownMenuItem>
                  <DropdownMenuItem v-if="canEdit" @click="handleRename(file)">{{ t('book.detail.files.rename') }}</DropdownMenuItem>
                  <DropdownMenuItem v-if="canDelete" class="text-destructive focus:text-destructive" @click="handleRemove(file)">
                    {{ t('common.delete') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>

          <div v-if="hiddenCount(group) > 0" class="flex h-8 items-center gap-2.5 px-2.5">
            <span class="text-[12.5px] text-muted-foreground tabular-nums">{{
              t('book.detail.files.moreTracks', { count: hiddenCount(group) })
            }}</span>
            <button
              class="rounded text-[12.5px] font-medium text-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="revealAllTracks(group)"
            >
              {{ t('book.detail.files.showAllTracks') }}
            </button>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>

<style scoped>
/*
 * Below this the fixed columns cannot hold their numbers, so the row goes two-line: the name across
 * the full width, its format, size and length on a second line, and the action stays on the right.
 */
@container filestab (max-width: 35rem) {
  .file-row {
    align-items: flex-start;
    padding-block: 0.5rem;
  }

  .file-row .row-name {
    display: block;
  }

  .file-row .row-base {
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .file-row .row-stacked {
    display: block;
  }

  .file-row .row-col {
    display: none;
  }
}
</style>
