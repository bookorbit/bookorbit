<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ArrowDown, Check, Layers, TriangleAlert } from '@lucide/vue'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { formatKeyCode } from '@/features/book/lib/book-formats'
import type { EditionEntry } from '@/features/book/lib/book-editions'
import { formatConjunctionList, formatPercent } from '@/i18n/formatters'

const props = withDefaults(
  defineProps<{
    editions: EditionEntry[]
    /** `scroll` keeps one line that scrolls sideways, for narrow screens, with a shorter "All" label. */
    layout?: 'wrap' | 'scroll'
  }>(),
  { layout: 'wrap' },
)

const emit = defineEmits<{
  /** The "All N editions" button: the page opens its Editions tab. */
  'show-all': []
}>()

const { t } = useI18n()

/** One line: the edition this page shows; the rest are a tab away. */
const visible = computed(() => props.editions.filter((entry) => entry.current))
const showAllText = computed(() =>
  props.layout === 'scroll'
    ? t('book.editions.strip.showAllShort', { count: props.editions.length })
    : t('book.editions.strip.showAll', { count: props.editions.length }),
)

const pills = computed(() =>
  visible.value.map((entry) => {
    const { summary } = entry
    const missing = summary.status === 'missing'
    const progress = summary.progress ?? null
    const formats = formatConjunctionList(summary.formats.map((format) => formatKeyCode(format)))
    const params = { label: entry.label, formats, library: summary.libraryName }
    let ariaLabel: string
    if (missing) ariaLabel = t('book.editions.strip.pillMissing', params)
    else if (progress?.finished) ariaLabel = t('book.editions.strip.pillFinished', params)
    else if (progress) ariaLabel = t('book.editions.strip.pillProgress', { ...params, percent: formatPercent(progress.percentage / 100) })
    else ariaLabel = t('book.editions.strip.pill', params)
    return {
      bookId: summary.bookId,
      label: entry.label,
      current: entry.current,
      formats: summary.formats,
      missing,
      finished: !missing && progress?.finished === true,
      percent: !missing && progress && !progress.finished ? formatPercent(progress.percentage / 100) : null,
      ariaLabel,
    }
  }),
)

function showAll(): void {
  emit('show-all')
}
</script>

<template>
  <nav
    v-if="editions.length > 1"
    :aria-label="t('book.editions.strip.label')"
    class="flex items-center gap-x-2 gap-y-1.5"
    :class="layout === 'scroll' ? 'flex-nowrap' : 'flex-wrap'"
    data-testid="edition-strip"
  >
    <ul
      class="m-0 flex list-none gap-1.5 p-0"
      :class="
        layout === 'scroll'
          ? 'min-w-0 flex-nowrap overflow-x-auto pe-4 [scrollbar-width:none] [mask-image:linear-gradient(to_right,#000_85%,transparent)] rtl:[mask-image:linear-gradient(to_left,#000_85%,transparent)] [&::-webkit-scrollbar]:hidden'
          : 'flex-wrap'
      "
    >
      <li class="me-0.5 inline-flex h-6 shrink-0 items-center text-xs text-muted-foreground" aria-hidden="true">
        {{ t('book.editions.strip.label') }}
      </li>
      <li v-for="pill in pills" :key="pill.bookId" class="shrink-0">
        <RouterLink
          :to="{ name: 'book-detail', params: { bookId: pill.bookId } }"
          :aria-label="pill.ariaLabel"
          :aria-current="pill.current ? 'page' : undefined"
          class="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border ps-1 pe-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="pill.current ? 'border-primary/60 bg-primary/14 text-primary' : 'border-border bg-background text-foreground hover:bg-muted'"
          data-testid="edition-pill"
        >
          <BookFormatChip
            v-for="format in pill.formats"
            :key="format"
            :format-key="format"
            class="shrink-0 rounded-full px-[5px] py-0 text-[9px] leading-[14px] tracking-wider"
            aria-hidden="true"
          />
          <span dir="auto">{{ pill.label }}</span>
          <TriangleAlert v-if="pill.missing" class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" data-testid="edition-pill-missing" />
          <Check v-else-if="pill.finished" class="size-6 shrink-0" aria-hidden="true" data-testid="edition-pill-finished" />
          <span
            v-else-if="pill.percent"
            class="text-[11px] tabular-nums"
            :class="pill.current ? 'text-primary' : 'text-muted-foreground'"
            aria-hidden="true"
            >{{ pill.percent }}</span
          >
        </RouterLink>
      </li>
      <li class="shrink-0">
        <button
          type="button"
          class="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('book.editions.strip.showAllLabel', { count: editions.length })"
          data-testid="edition-strip-all"
          @click="showAll"
        >
          <Layers class="size-3 shrink-0" aria-hidden="true" />
          {{ showAllText }}
          <ArrowDown class="size-3 shrink-0" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </nav>
</template>
