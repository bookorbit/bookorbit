<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { BookOpen, Check, Crown, EllipsisVertical, TriangleAlert, Unlink } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { formatKeyCode } from '@/features/book/lib/book-formats'
import type { EditionEntry } from '@/features/book/lib/book-editions'
import { formatConjunctionList, formatDate, formatList, formatPercent } from '@/i18n/formatters'

const props = withDefaults(
  defineProps<{
    editions: EditionEntry[]
    /** Whether this viewer may change the group's main edition. */
    canMakeMain?: boolean
    /** Editions this viewer may take out of the group. */
    removableBookIds?: number[]
    /** An edition change is in flight. */
    pending?: boolean
  }>(),
  { canMakeMain: false, removableBookIds: () => [], pending: false },
)

const emit = defineEmits<{
  'make-main': [bookId: number]
  remove: [bookId: number]
}>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()

/** Narrators named before "+N more". */
const NAMED_NARRATORS = 2

const currentTitle = computed(() => props.editions.find((entry) => entry.current)?.summary.title ?? null)
const removable = computed(() => new Set(props.removableBookIds))

const rows = computed(() =>
  props.editions.map((entry) => {
    const { summary } = entry
    const missing = summary.status === 'missing'
    const progress = missing ? null : (summary.progress ?? null)
    const finished = progress?.finished === true
    const percent = progress && !finished ? formatPercent(progress.percentage / 100) : null
    const formats = formatConjunctionList(summary.formats.map((format) => formatKeyCode(format)))
    const labelParams = { label: entry.label, formats, library: summary.libraryName }
    let ariaLabel: string
    if (missing) ariaLabel = t('book.editions.strip.pillMissing', labelParams)
    else if (finished) ariaLabel = t('book.editions.strip.pillFinished', labelParams)
    else if (percent) ariaLabel = t('book.editions.strip.pillProgress', { ...labelParams, percent })
    else ariaLabel = t('book.editions.strip.pill', labelParams)

    const narrators = summary.narrators ?? []
    const canMakeMain = props.canMakeMain && !summary.isLead
    const canRemove = removable.value.has(summary.bookId)
    return {
      bookId: summary.bookId,
      label: entry.label,
      current: entry.current,
      isLead: summary.isLead,
      cover: coverUrl(summary.bookId, 'thumbnail', summary.coverUpdatedAt),
      formats: summary.formats,
      ariaLabel,
      place:
        summary.title && currentTitle.value && summary.title !== currentTitle.value
          ? t('book.editions.table.titleInLibrary', { title: summary.title, library: summary.libraryName })
          : summary.libraryName,
      year: summary.publishedYear ?? null,
      publisher: summary.publisher ?? null,
      narrators: formatList(narrators.slice(0, NAMED_NARRATORS)),
      moreNarrators: Math.max(0, narrators.length - NAMED_NARRATORS),
      missing,
      finished,
      finishedOn: finished && summary.lastReadAt ? formatDate(new Date(summary.lastReadAt), { month: 'short', year: 'numeric' }) : null,
      percent,
      percentage: progress && !finished ? Math.min(100, Math.max(0, progress.percentage)) : null,
      canOpen: !entry.current,
      canMakeMain,
      canRemove,
      hasActions: !entry.current || canMakeMain || canRemove,
    }
  }),
)

type Row = (typeof rows.value)[number]

/** Editions whose cover did not load; a book without a cover has no thumbnail to show. */
const missingCovers = ref(new Set<number>())

function handleCoverError(row: Row): void {
  missingCovers.value = new Set(missingCovers.value).add(row.bookId)
}

function handleMakeMain(row: Row): void {
  emit('make-main', row.bookId)
}

function handleRemove(row: Row): void {
  emit('remove', row.bookId)
}
</script>

<template>
  <div class="@container" data-testid="editions-table">
    <div class="overflow-hidden rounded-[10px] border border-border bg-card">
      <div
        class="hidden h-[34px] items-center gap-x-4 border-b border-border ps-3.5 pe-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground @min-[56rem]:grid @min-[56rem]:grid-cols-[34px_minmax(0,1.5fr)_96px_minmax(0,1.1fr)_minmax(0,1fr)_150px_28px]"
        aria-hidden="true"
      >
        <span></span>
        <span>{{ t('book.editions.table.edition') }}</span>
        <span>{{ t('book.editions.table.format') }}</span>
        <span>{{ t('book.editions.table.published') }}</span>
        <span>{{ t('book.editions.table.narratedBy') }}</span>
        <span>{{ t('book.editions.table.yourReading') }}</span>
        <span></span>
      </div>

      <ul class="m-0 list-none p-0" :aria-label="t('book.editions.strip.label')">
        <li
          v-for="row in rows"
          :key="row.bookId"
          class="relative grid h-[68px] grid-cols-[34px_minmax(0,1fr)_28px] items-center gap-x-3 border-t border-border ps-3 pe-2 transition-colors first:border-t-0 @min-[56rem]:h-16 @min-[56rem]:grid-cols-[34px_minmax(0,1.5fr)_96px_minmax(0,1.1fr)_minmax(0,1fr)_150px_28px] @min-[56rem]:gap-x-4 @min-[56rem]:ps-3.5"
          :class="row.current ? 'bg-primary/9' : 'hover:bg-muted/55'"
          data-testid="edition-row"
        >
          <span v-if="row.current" class="absolute inset-y-1.5 start-0 w-[3px] rounded-e-[3px] bg-primary" aria-hidden="true"></span>
          <span
            class="flex h-[51px] w-[34px] items-center justify-center overflow-hidden rounded-[3px] bg-muted shadow-(--book-cover-mini-shadow)"
            data-testid="edition-row-cover"
          >
            <img
              v-if="!missingCovers.has(row.bookId)"
              :src="row.cover"
              alt=""
              class="size-full object-cover"
              loading="lazy"
              @error="handleCoverError(row)"
            />
            <BookOpen v-else class="size-3.5 text-muted-foreground" aria-hidden="true" />
          </span>

          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] font-medium">
              <RouterLink
                :to="{ name: 'book-detail', params: { bookId: row.bookId } }"
                :aria-label="row.ariaLabel"
                :aria-current="row.current ? 'page' : undefined"
                :title="row.label"
                class="truncate text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                data-testid="edition-row-link"
              >
                <span dir="auto">{{ row.label }}</span>
              </RouterLink>
              <span
                v-if="row.isLead"
                class="inline-flex h-[18px] shrink-0 items-center gap-[3px] rounded-full bg-warning/14 px-1.5 text-[10.5px] font-semibold tracking-[0.02em] text-warning"
                data-testid="edition-row-main"
              >
                <Crown class="size-[11px]" aria-hidden="true" />
                {{ t('book.editions.table.main') }}
              </span>
              <span
                v-if="row.current"
                class="inline-flex h-[18px] shrink-0 items-center rounded-full bg-primary/16 px-1.5 text-[10.5px] font-semibold tracking-[0.02em] text-primary"
                data-testid="edition-row-viewing"
              >
                {{ t('book.editions.table.viewing') }}
              </span>
            </div>

            <div class="hidden truncate text-xs leading-[17px] text-muted-foreground @min-[56rem]:block" dir="auto">{{ row.place }}</div>

            <div class="mt-1 flex min-w-0 items-center gap-1.5 text-xs leading-[17px] text-muted-foreground @min-[56rem]:hidden">
              <BookFormatChip
                v-for="format in row.formats"
                :key="format"
                :format-key="format"
                class="shrink-0 rounded-full px-1.5 py-0 text-[10px] leading-4 tracking-wider"
                aria-hidden="true"
              />
              <span v-if="row.year !== null" class="shrink-0 tabular-nums">{{ row.year }}</span>
              <template v-if="row.missing">
                <span aria-hidden="true">&middot;</span>
                <span class="inline-flex shrink-0 items-center gap-1"
                  ><TriangleAlert class="size-3" aria-hidden="true" />{{ t('book.editions.table.missing') }}</span
                >
              </template>
              <template v-else-if="row.finished">
                <span aria-hidden="true">&middot;</span>
                <span class="inline-flex shrink-0 items-center gap-1 text-success"
                  ><Check class="size-3" aria-hidden="true" />{{ t('book.editions.table.finished') }}</span
                >
              </template>
              <template v-else-if="row.percentage !== null">
                <span aria-hidden="true">&middot;</span>
                <span class="shrink-0 font-medium text-primary tabular-nums">{{ row.percent }}</span>
                <span class="h-1 w-11 shrink-0 overflow-hidden rounded-full bg-muted-foreground/25" aria-hidden="true">
                  <span class="block h-full rounded-full bg-primary" :style="{ width: `${row.percentage}%` }"></span>
                </span>
              </template>
            </div>
          </div>

          <div class="hidden min-w-0 gap-1 @min-[56rem]:flex">
            <BookFormatChip
              v-for="format in row.formats"
              :key="format"
              :format-key="format"
              class="shrink-0 rounded-full px-1.5 py-0 text-[10px] leading-4 tracking-wider"
              aria-hidden="true"
            />
          </div>

          <div class="hidden min-w-0 @min-[56rem]:block">
            <div class="truncate text-[13px] leading-[18px] font-medium text-foreground tabular-nums">{{ row.year ?? '' }}</div>
            <div class="truncate text-xs leading-[17px] text-muted-foreground" dir="auto">{{ row.publisher ?? '' }}</div>
          </div>

          <div class="hidden min-w-0 @min-[56rem]:block">
            <template v-if="row.narrators">
              <div class="truncate text-[13px] leading-[18px] font-medium text-foreground" dir="auto">{{ row.narrators }}</div>
              <div class="truncate text-xs leading-[17px] text-muted-foreground">
                {{ row.moreNarrators > 0 ? t('book.editions.table.moreNarrators', { count: row.moreNarrators }) : '' }}
              </div>
            </template>
            <template v-else>
              <span class="text-[13px] text-muted-foreground" aria-hidden="true">-</span>
              <span class="sr-only">{{ t('book.editions.table.noNarrator') }}</span>
            </template>
          </div>

          <div class="hidden min-w-0 @min-[56rem]:block">
            <template v-if="row.missing">
              <div class="inline-flex items-center gap-1 text-[13px] leading-[18px] text-muted-foreground">
                <TriangleAlert class="size-3.5" aria-hidden="true" />{{ t('book.editions.table.missing') }}
              </div>
            </template>
            <template v-else-if="row.finished">
              <div class="inline-flex items-center gap-1 text-[13px] leading-[18px] font-medium text-success">
                <Check class="size-3.5" aria-hidden="true" />{{ t('book.editions.table.finished') }}
              </div>
              <div class="text-xs leading-[17px] text-muted-foreground">{{ row.finishedOn ?? '' }}</div>
            </template>
            <template v-else-if="row.percentage !== null">
              <div class="text-[13px] leading-[18px] font-medium text-primary tabular-nums">
                {{ t('book.editions.table.reading', { percent: row.percent }) }}
              </div>
              <div class="mt-1.5 h-1 w-[120px] max-w-full overflow-hidden rounded-full bg-muted-foreground/25" aria-hidden="true">
                <div class="h-full rounded-full bg-primary" :style="{ width: `${row.percentage}%` }"></div>
              </div>
            </template>
            <div v-else class="text-[13px] leading-[18px] text-muted-foreground">{{ t('book.editions.table.notStarted') }}</div>
          </div>

          <div class="relative z-10 flex justify-end">
            <DropdownMenu v-if="row.hasActions">
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-label="t('book.editions.table.actions', { label: row.label })"
                  data-testid="edition-row-actions"
                >
                  <EllipsisVertical class="size-[15px]" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-max min-w-52">
                <DropdownMenuItem v-if="row.canOpen" as-child data-testid="edition-row-open">
                  <RouterLink :to="{ name: 'book-detail', params: { bookId: row.bookId } }">
                    <BookOpen aria-hidden="true" />
                    {{ t('book.editions.table.open') }}
                  </RouterLink>
                </DropdownMenuItem>
                <DropdownMenuItem v-if="row.canMakeMain" :disabled="pending" data-testid="edition-row-make-main" @select="handleMakeMain(row)">
                  <Crown aria-hidden="true" />
                  {{ t('book.editions.table.makeMain') }}
                </DropdownMenuItem>
                <DropdownMenuSeparator v-if="row.canRemove && (row.canOpen || row.canMakeMain)" />
                <DropdownMenuItem v-if="row.canRemove" :disabled="pending" data-testid="edition-row-remove" @select="handleRemove(row)">
                  <Unlink aria-hidden="true" />
                  {{ t('book.editions.remove') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
