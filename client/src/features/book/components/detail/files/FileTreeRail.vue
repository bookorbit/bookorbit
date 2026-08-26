<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Folder, PieChart } from '@lucide/vue'
import { formatBytes } from '@/lib/formatting'
import { formatPercent } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { splitExtension } from '@/features/book/lib/filename-stem'
import type { FileGroup, FormatShare, TreeFile } from '@/features/book/composables/useBookFileTree'
import FileFormatGlyph from './FileFormatGlyph.vue'
import FileRoleBadge from './FileRoleBadge.vue'

const props = defineProps<{
  groups: FileGroup[]
  formatShares: FormatShare[]
  folderName: string
  folderPath: string
  totalBytes: number
  selectedId: number | null
  fileCount: number
}>()

const emit = defineEmits<{ select: [id: number] }>()
const { t } = useI18n()

function handleSelect(id: number) {
  emit('select', id)
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('book.detail.files.duration.hoursMinutes', { hours, minutes })
  return t('book.detail.files.duration.minutes', { minutes: Math.max(minutes, 1) })
}

function metaParts(file: TreeFile): string[] {
  const parts = [formatBytes(file.sizeBytes)]
  const duration = formatDuration(file.durationSeconds)
  if (duration) parts.push(duration)
  if ((file.progress?.percentage ?? 0) > 0) {
    parts.push(t('book.detail.files.percentRead', { percent: formatPercent((file.progress?.percentage ?? 0) / 100) }))
  }
  return parts
}

const shareStyles = computed(() =>
  props.formatShares.map((share) => ({
    ...share,
    color: formatColorVar(share.format),
    // A format worth a row is worth a visible sliver, however little of the folder it owns.
    width: `${Math.max(share.fraction * 100, 1.2)}%`,
  })),
)
</script>

<template>
  <section class="flex flex-col rounded-xl border border-border bg-card lg:min-h-0" :aria-label="t('book.detail.files.folderContents')">
    <div class="p-1.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <div class="flex items-start gap-2.5 rounded-lg px-2 py-1.5" :title="folderPath">
        <Folder class="mt-px size-[15px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="line-clamp-3 min-w-0 flex-1 break-words text-[12.5px] font-bold leading-[1.35]">{{ folderName }}</span>
        <span class="mt-px shrink-0 text-[11px] text-muted-foreground">{{ formatBytes(totalBytes) }}</span>
      </div>

      <div class="relative pl-[22px] before:absolute before:bottom-0 before:left-[11px] before:top-0 before:w-px before:bg-border">
        <template v-for="group in groups" :key="group.key">
          <div class="flex items-center gap-2 px-2 py-1.5">
            <ChevronDown class="size-[13px] shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="shrink-0 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{{ group.label }}</span>
            <span v-if="group.stem" class="min-w-0 truncate font-mono text-[9.5px] text-muted-foreground" :title="group.stem"
              >{{ group.stem }}&hellip;</span
            >
            <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">{{ group.files.length }}</span>
          </div>

          <ul class="contents">
            <li v-for="file in group.files" :key="file.id">
              <button
                class="relative flex w-full items-start gap-2.5 rounded-lg py-1.5 pl-[26px] pr-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="file.id === selectedId ? 'bg-primary/15' : ''"
                :title="file.leaf"
                :aria-current="file.id === selectedId ? 'true' : undefined"
                @click="handleSelect(file.id)"
              >
                <span v-if="file.id === selectedId" class="absolute inset-y-1.5 left-1.5 w-[2.5px] rounded-full bg-primary" aria-hidden="true" />
                <FileFormatGlyph :format="file.formatKey" size="sm" class="mt-px" />
                <!--
                  A filename has no length limit, so it never shares a line with the size and the
                  role. `min(100%, max-content)` keeps both on one line while the name fits and
                  pushes the meta onto its own line the moment it does not, at any rail width.
                -->
                <span class="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span class="line-clamp-3 min-w-[min(100%,max-content)] break-all text-[12.5px] font-semibold leading-[1.35]">
                    <span>{{ splitExtension(file.display).base }}</span
                    ><span class="text-muted-foreground">{{ splitExtension(file.display).extension }}</span>
                  </span>
                  <span class="flex shrink-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <span>{{ metaParts(file).join(' · ') }}</span>
                    <FileRoleBadge v-if="file.role !== 'content'" :role="file.role" />
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </div>

    <div class="flex flex-col gap-2.5 border-t border-border px-3.5 py-3 lg:shrink-0">
      <div class="flex items-center gap-2">
        <PieChart class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {{ t('book.detail.files.formatCount', { count: formatShares.length }) }}
        </h3>
        <span class="ml-auto text-[11px] text-muted-foreground">{{ formatBytes(totalBytes) }}</span>
      </div>

      <div class="flex h-2 gap-px overflow-hidden rounded-full bg-muted" role="img" :aria-label="t('book.detail.files.compositionAria')">
        <span
          v-for="share in shareStyles"
          :key="share.format"
          class="block h-full first:rounded-l-full last:rounded-r-full"
          :style="{ width: share.width, backgroundColor: share.color }"
        />
      </div>

      <dl class="flex flex-col">
        <div v-for="share in shareStyles" :key="share.format" class="flex items-center gap-2.5 border-b border-border py-1.5 last:border-b-0">
          <span class="size-[7px] shrink-0 rounded-sm" :style="{ backgroundColor: share.color }" aria-hidden="true" />
          <dt class="w-11 shrink-0 text-[12px] font-bold uppercase tracking-wide" :style="{ color: share.color }">{{ share.format }}</dt>
          <dd class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {{ t('book.detail.files.fileCount', { count: share.count }) }}
          </dd>
          <dd class="shrink-0 text-[11.5px] font-semibold">{{ formatBytes(share.sizeBytes) }}</dd>
          <dd class="w-9 shrink-0 text-right text-[10.5px] text-muted-foreground">{{ formatPercent(share.fraction) }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
