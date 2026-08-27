<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ArrowUpDown, CircleCheck, FilePlus, TriangleAlert } from '@lucide/vue'
import type { BookDetail } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import type { FormatShare, SortDirection, SortKey } from '@/features/book/composables/useBookFileTree'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const props = defineProps<{
  book: BookDetail
  fileCount: number
  totalBytes: number
  runtimeLabel: string | null
  formatShares: FormatShare[]
  folderSegments: string[]
  canUpload: boolean
  sortKey: SortKey
  sortDirection: SortDirection
  sortOptions: { key: SortKey; label: string }[]
}>()

const emit = defineEmits<{ sort: [key: SortKey]; addFile: [] }>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()

const hasCover = computed(() => props.book.coverSource !== null)
const coverSrc = computed(() => coverUrl(props.book.id, 'thumbnail', props.book.updatedAt ?? props.book.addedAt))
const isMissing = computed(() => props.book.status === 'missing')

/**
 * A format worth naming is worth a visible sliver, however little of the folder it owns; a hairline
 * segment reads as a rendering fault rather than as "this one is small".
 */
const meterSegments = computed(() =>
  props.formatShares.map((share) => ({
    format: share.format,
    color: formatColorVar(share.format),
    width: `${Math.max(share.fraction * 100, 1.5)}%`,
  })),
)

const meterLabel = computed(() =>
  [t('book.detail.files.compositionAria'), props.formatShares.map((share) => share.format.toUpperCase()).join(', ')].join(': '),
)

function handleSort(key: SortKey) {
  emit('sort', key)
}
function handleAddFile() {
  emit('addFile')
}
</script>

<template>
  <section class="files-hero flex shrink-0 items-center gap-3.5 rounded-xl border border-border bg-card px-3.5 py-3">
    <img
      v-if="hasCover"
      :src="coverSrc"
      alt=""
      class="hero-cover h-[4.125rem] w-11 shrink-0 rounded-md border border-border object-cover shadow-sm"
      loading="lazy"
      decoding="async"
    />
    <span
      v-else
      class="hero-cover flex h-[4.125rem] w-11 shrink-0 items-center justify-center rounded-md border border-border bg-muted"
      aria-hidden="true"
    />

    <div class="hero-id min-w-0 flex-1">
      <h2 class="truncate text-base font-semibold leading-tight tracking-tight">{{ book.title ?? folderSegments.at(-1) }}</h2>
      <nav class="hero-crumb mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" :aria-label="t('book.detail.files.folderAria')">
        <template v-for="(segment, index) in folderSegments" :key="`${segment}-${index}`">
          <span v-if="index > 0" class="crumb-slash shrink-0 opacity-40" aria-hidden="true">/</span>
          <span class="crumb-part min-w-[1.5ch] truncate">{{ segment }}</span>
        </template>
      </nav>
    </div>

    <dl class="hero-stats flex shrink-0 items-center">
      <div class="hero-stat px-4 text-right">
        <dt class="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.detail.files.stats.files') }}</dt>
        <dd class="mt-1.5 text-base font-semibold leading-none tracking-tight tabular-nums">{{ fileCount }}</dd>
      </div>
      <div class="hero-stat border-l border-border px-4 text-right">
        <dt class="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.detail.files.stats.total') }}</dt>
        <dd class="mt-1.5 whitespace-nowrap text-base font-semibold leading-none tracking-tight tabular-nums">{{ formatBytes(totalBytes) }}</dd>
      </div>
      <div v-if="runtimeLabel" class="hero-stat border-l border-border px-4 text-right">
        <dt class="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.detail.files.stats.runtime') }}</dt>
        <dd class="mt-1.5 whitespace-nowrap text-base font-semibold leading-none tracking-tight tabular-nums">{{ runtimeLabel }}</dd>
      </div>
      <div class="hero-stat hero-meter min-w-[8.25rem] border-l border-border px-4">
        <dt class="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.detail.files.stats.formats') }}</dt>
        <dd class="mt-1.5 flex h-4 items-center gap-2">
          <span class="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full bg-muted" role="img" :aria-label="meterLabel">
            <span
              v-for="segment in meterSegments"
              :key="segment.format"
              class="block h-full first:rounded-l-full last:rounded-r-full"
              :style="{ width: segment.width, backgroundColor: segment.color }"
            />
          </span>
          <span class="shrink-0 text-[11.5px] leading-none text-muted-foreground tabular-nums">{{ formatShares.length }}</span>
        </dd>
      </div>
    </dl>

    <div class="hero-actions flex shrink-0 items-center gap-2 border-l border-border pl-4">
      <span
        class="inline-flex h-[18px] items-center gap-1 rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
        :class="isMissing ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success'"
      >
        <TriangleAlert v-if="isMissing" class="size-2.5" aria-hidden="true" />
        <CircleCheck v-else class="size-2.5" aria-hidden="true" />
        {{ isMissing ? t('book.detail.files.missing') : t('book.detail.files.allPresent') }}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            class="inline-flex size-[34px] items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('book.detail.files.sortAria')"
          >
            <ArrowUpDown class="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem v-for="option in sortOptions" :key="option.key" class="gap-2" @click="handleSort(option.key)">
            <span class="flex-1">{{ option.label }}</span>
            <template v-if="option.key === sortKey">
              <ArrowUp v-if="sortDirection === 'asc'" class="size-3.5 text-primary" aria-hidden="true" />
              <ArrowDown v-else class="size-3.5 text-primary" aria-hidden="true" />
            </template>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        v-if="canUpload"
        class="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleAddFile"
      >
        <FilePlus class="size-4" aria-hidden="true" />
        {{ t('book.detail.files.addFile') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* The crumb spends its truncation budget on the ancestors; the folder itself always reads whole. */
.hero-crumb > .crumb-part {
  flex: 0 1 auto;
}

.hero-crumb > .crumb-part:last-child {
  flex: 0 0 auto;
  color: color-mix(in oklch, var(--foreground) 78%, var(--muted-foreground));
}

/*
 * The strip reflows on the tab's own width, not the window's: a collapsed sidebar makes a 1440
 * window as roomy as a 1700 one, and the `md` sidebar makes an 834 tablet as tight as a phone.
 */
@container filestab (max-width: 45rem) {
  .files-hero {
    flex-wrap: wrap;
    row-gap: 0.75rem;
  }

  .hero-id {
    flex: 1 1 12rem;
  }

  /* Three truncated crumb segments read as damage; the folder the files live in survives whole. */
  .hero-crumb .crumb-part:not(:last-child),
  .hero-crumb span[aria-hidden='true'] {
    display: none;
  }

  .hero-crumb::before {
    content: '…/';
    flex: none;
    opacity: 0.5;
  }

  .hero-stats {
    order: 3;
    width: 100%;
    justify-content: space-between;
  }

  .hero-stats .hero-stat:first-child {
    padding-inline-start: 0;
  }

  .hero-actions {
    order: 2;
    margin-inline-start: auto;
    border-inline-start: 0;
    padding-inline-start: 0;
  }
}

@container filestab (max-width: 35rem) {
  .hero-cover {
    height: 3.375rem;
    width: 2.25rem;
  }

  .hero-stats {
    order: 2;
    flex-wrap: wrap;
    row-gap: 0.75rem;
  }

  .hero-stat {
    padding-inline: 0.75rem;
  }

  /* The meter needs a whole row once three numbers already share one. */
  .hero-meter {
    flex: 1 0 100%;
    padding-inline-start: 0;
    border-inline-start: 0;
  }

  .hero-actions {
    order: 3;
    width: 100%;
    margin-inline-start: 0;
  }

  .hero-actions button:last-child {
    flex: 1;
  }
}
</style>
