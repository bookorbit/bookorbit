<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import { ArrowDown, ArrowUp, ArrowUpDown, AudioLines, CircleCheck, FilePlus, Loader2, TriangleAlert } from '@lucide/vue'
import type { BookDetail } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { formatList } from '@/i18n/formatters'
import { formatKeyName } from '@/features/book/lib/book-formats'
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
  showReadAloud?: boolean
  /** False keeps the entry focusable but inert, so its reason can still be reached and read. */
  readAloudAvailable?: boolean
  /** Why the entry is unavailable, shown under the toolbar rather than in a tooltip. */
  readAloudNote?: string | null
  /** The note is a failed availability check, so it offers to check again. */
  readAloudRetryable?: boolean
  /** An availability check is in flight, so "Check again" waits for it. */
  readAloudChecking?: boolean
  sortKey: SortKey
  sortDirection: SortDirection
  sortOptions: { key: SortKey; label: string }[]
}>()

const emit = defineEmits<{ sort: [key: SortKey]; addFile: []; generateReadAloud: []; retryReadAloud: [] }>()

const { t, locale } = useI18n()
const { coverUrl } = useCoverVersions()
const readAloudNoteId = useId()

/** The narrowest the title and folder may get before the strip stacks; any less reads as damage. */
const ID_MIN_REM = 12
/** Slack before stacking undoes itself, so a scrollbar coming and going cannot flip it back and forth. */
const UNSTACK_SLACK_PX = 12

const heroRef = ref<HTMLElement | null>(null)
const statsRef = ref<HTMLElement | null>(null)
const actionsRef = ref<HTMLElement | null>(null)
const stacked = ref(false)

function childrenWidth(element: HTMLElement): number {
  const children = [...element.children]
  const gap = parseFloat(getComputedStyle(element).columnGap) || 0
  return children.reduce((total, child) => total + child.getBoundingClientRect().width, 0) + Math.max(0, children.length - 1) * gap
}

/**
 * Stack once one row would leave the title less than its minimum. A container breakpoint guessed
 * this and guessed wrong: the stat values, the read-aloud entry and every translation change how
 * much room the row needs, and a squeezed title painted its folder over the stats. The children's
 * own widths do not depend on the arrangement, so one sum decides in both directions.
 */
function measureStacking(): void {
  const hero = heroRef.value
  const stats = statsRef.value
  const actions = actionsRef.value
  if (!hero || !stats || !actions) return
  const style = getComputedStyle(hero)
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const available = hero.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
  const cover = hero.querySelector('.hero-cover')?.getBoundingClientRect().width ?? 0
  // The hairline and inset that divide the actions from the stats in a single row.
  const divider = 1 + rem
  const needed = cover + childrenWidth(stats) + divider + childrenWidth(actions) + ID_MIN_REM * rem + 3 * (parseFloat(style.columnGap) || 0)
  stacked.value = stacked.value ? needed > available - UNSTACK_SLACK_PX : needed > available
}

useResizeObserver([heroRef, statsRef, actionsRef], measureStacking)

// A stacked stat row spans the strip, so its box does not resize when a value or label changes.
watch(
  () => [props.fileCount, props.totalBytes, props.runtimeLabel, props.formatShares.length, props.showReadAloud, props.canUpload, locale.value],
  () => nextTick(measureStacking),
)

const hasCover = computed(() => props.book.coverSource !== null)
const coverSrc = computed(() => coverUrl(props.book.id, 'thumbnail', props.book.coverVersion))
const isMissing = computed(() => props.book.status === 'missing')

/**
 * A format worth naming is worth a visible sliver, however little of the folder it owns; a hairline
 * segment reads as a rendering fault rather than as "this one is small".
 */
const meterSegments = computed(() =>
  props.formatShares.map((share) => ({
    key: share.key,
    color: formatColorVar(share.key),
    width: `${Math.max(share.fraction * 100, 1.5)}%`,
  })),
)

const meterLabel = computed(() =>
  [t('book.detail.files.compositionAria'), formatList(props.formatShares.map((share) => formatKeyName(share.key)))].join(': '),
)

function handleSort(key: SortKey) {
  emit('sort', key)
}
function handleAddFile() {
  emit('addFile')
}
function handleGenerateReadAloud() {
  if (props.readAloudAvailable) emit('generateReadAloud')
}
function handleRetryReadAloud() {
  if (!props.readAloudChecking) emit('retryReadAloud')
}
</script>

<template>
  <section class="flex shrink-0 flex-col rounded-xl border border-border bg-card">
    <div ref="heroRef" class="files-hero flex items-center gap-3.5 px-3.5 py-3" :data-stacked="stacked ? '1' : undefined">
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

      <dl ref="statsRef" class="hero-stats flex shrink-0 items-center">
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
                :key="segment.key"
                class="block h-full first:rounded-l-full last:rounded-r-full"
                :style="{ width: segment.width, backgroundColor: segment.color }"
              />
            </span>
            <span class="shrink-0 text-[11.5px] leading-none text-muted-foreground tabular-nums">{{ formatShares.length }}</span>
          </dd>
        </div>
      </dl>

      <div ref="actionsRef" class="hero-actions flex shrink-0 items-center gap-2 border-l border-border pl-4">
        <span
          class="inline-flex h-[18px] items-center gap-1 rounded-xs px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
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
          v-if="showReadAloud"
          type="button"
          class="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-input px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="readAloudAvailable ? 'text-foreground hover:bg-muted' : 'cursor-not-allowed text-muted-foreground'"
          :aria-disabled="readAloudAvailable ? undefined : 'true'"
          :aria-describedby="readAloudNote ? readAloudNoteId : undefined"
          @click="handleGenerateReadAloud"
        >
          <AudioLines class="size-4" :class="readAloudAvailable ? 'text-primary' : undefined" aria-hidden="true" />
          {{ t('book.detail.files.readAloud.action') }}
        </button>

        <button
          v-if="canUpload"
          class="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleAddFile"
        >
          <FilePlus class="size-4" aria-hidden="true" />
          {{ t('book.detail.files.addFile') }}
        </button>
      </div>
    </div>

    <div
      v-if="showReadAloud && readAloudNote"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-3.5 py-2 text-[12.5px] text-muted-foreground"
    >
      <AudioLines class="size-3.5 shrink-0" aria-hidden="true" />
      <p :id="readAloudNoteId" role="status" class="min-w-0 flex-1" data-test="read-aloud-note">{{ readAloudNote }}</p>
      <!-- aria-disabled rather than disabled, so the keyboard stays on the button through the check. -->
      <button
        v-if="readAloudRetryable"
        type="button"
        class="-mx-1 inline-flex min-h-6 items-center gap-1 rounded px-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="readAloudChecking ? 'cursor-progress text-muted-foreground' : 'text-foreground hover:bg-muted'"
        :aria-disabled="readAloudChecking ? 'true' : undefined"
        :aria-busy="readAloudChecking ? 'true' : undefined"
        data-test="read-aloud-check-again"
        @click="handleRetryReadAloud"
      >
        <Loader2 v-if="readAloudChecking" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ readAloudChecking ? t('book.detail.files.readAloud.checking') : t('book.detail.files.readAloud.checkAgain') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/*
 * The crumb spends its truncation budget on the ancestors. They shrink a million times faster, so
 * the folder's share rounds to nothing and it reads whole until they reach their minimum; only then
 * does it truncate, rather than painting over the stats as it did when it could not shrink at all.
 */
.hero-crumb > .crumb-part {
  flex: 0 1000000 auto;
}

.hero-crumb > .crumb-part:last-child {
  flex: 0 1 auto;
  color: color-mix(in oklch, var(--foreground) 78%, var(--muted-foreground));
}

/*
 * Stacked: the actions stay beside the title and the stats take a row of their own. `:where()`
 * keeps these at the plain selectors' specificity so the phone rules below still win.
 */
:where(.files-hero[data-stacked='1']) {
  flex-wrap: wrap;
  row-gap: 0.75rem;
}

:where(.files-hero[data-stacked='1']) .hero-id {
  flex: 1 1 12rem;
}

/* Three truncated crumb segments read as damage; the folder the files live in survives whole. */
:where(.files-hero[data-stacked='1']) .hero-crumb .crumb-part:not(:last-child),
:where(.files-hero[data-stacked='1']) .hero-crumb span[aria-hidden='true'] {
  display: none;
}

:where(.files-hero[data-stacked='1']) .hero-crumb::before {
  content: '…/';
  flex: none;
  opacity: 0.5;
}

:where(.files-hero[data-stacked='1']) .hero-stats {
  order: 3;
  width: 100%;
  justify-content: space-between;
}

:where(.files-hero[data-stacked='1']) .hero-stats .hero-stat:first-child {
  padding-inline-start: 0;
}

:where(.files-hero[data-stacked='1']) .hero-actions {
  order: 2;
  margin-inline-start: auto;
  border-inline-start: 0;
  padding-inline-start: 0;
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
    flex-wrap: wrap;
    row-gap: 0.5rem;
  }

  .hero-actions button:last-child {
    flex: 1;
  }
}
</style>
