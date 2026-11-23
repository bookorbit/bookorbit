<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, User, Sparkles, ChevronLeft, ChevronRight, Layers, Plus } from '@lucide/vue'

import type { BookRecommendation, SeriesBookRecommendation } from '@bookorbit/types'
import { api } from '@/lib/api'
import BookCarousel from '@/features/book/components/detail/BookCarousel.vue'
import EditionsTable from '@/features/book/components/link/EditionsTable.vue'
import type { EditionEntry } from '@/features/book/lib/book-editions'
import { formatNumber } from '@/i18n/formatters'

type FetchedSection = 'series' | 'author' | 'similar'
type Section = 'editions' | FetchedSection

const props = withDefaults(
  defineProps<{
    bookId: number
    seriesName: string | null
    authorCount: number
    /** Cover size for the shelf; 'lg' is the book detail layout. */
    size?: 'md' | 'lg'
    /** Drops the top rule and margin when the row sits in its own grid cell. */
    flush?: boolean
    /** Every edition of this book's work, this one included; two or more add an Editions tab, first. */
    editions?: EditionEntry[]
    canAddEdition?: boolean
    canMakeMainEdition?: boolean
    removableEditionIds?: number[]
    editionsPending?: boolean
  }>(),
  {
    size: 'md',
    flush: false,
    editions: () => [],
    canAddEdition: false,
    canMakeMainEdition: false,
    removableEditionIds: () => [],
    editionsPending: false,
  },
)

const emit = defineEmits<{
  'add-edition': []
  'make-main-edition': [bookId: number]
  'remove-edition': [bookId: number]
}>()

const { t } = useI18n()

const seriesBooks = ref<SeriesBookRecommendation[]>([])
const authorBooks = ref<BookRecommendation[]>([])
const similarBooks = ref<BookRecommendation[]>([])

const loading = ref<Record<FetchedSection, boolean>>({ series: false, author: false, similar: false })
const fetched = ref<Set<FetchedSection>>(new Set())
const hasEditions = computed(() => props.editions.length > 1)
const editionsPill = ref<HTMLButtonElement | null>(null)

const activeSection = ref<Section | null>(null)

const seriesCarouselRef = ref<InstanceType<typeof BookCarousel> | null>(null)
const authorCarouselRef = ref<InstanceType<typeof BookCarousel> | null>(null)
const similarCarouselRef = ref<InstanceType<typeof BookCarousel> | null>(null)

const activeCarouselRef = computed(() => {
  if (activeSection.value === 'series') return seriesCarouselRef.value
  if (activeSection.value === 'author') return authorCarouselRef.value
  return similarCarouselRef.value
})

const filteredSeriesBooks = computed(() => seriesBooks.value.filter((b) => b.id !== props.bookId))

const excludeFromSimilar = computed(() => [...filteredSeriesBooks.value.map((b) => b.id), ...authorBooks.value.map((b) => b.id)])

const filteredSimilar = computed(() => {
  const excluded = new Set(excludeFromSimilar.value)
  return similarBooks.value.filter((b) => !excluded.has(b.id))
})

function booksForSection(section: FetchedSection) {
  if (section === 'series') return filteredSeriesBooks.value
  if (section === 'author') return authorBooks.value
  return filteredSimilar.value
}

// Pills are purely data-driven — never derived from props — so no phantom pills appear
// when navigating to a book whose props suggest data that the fetch hasn't confirmed yet.
const availablePills = computed<Section[]>(() => {
  const pills: Section[] = []
  if (hasEditions.value) pills.push('editions')
  if (filteredSeriesBooks.value.length > 0) pills.push('series')
  if (authorBooks.value.length > 0) pills.push('author')
  if (filteredSimilar.value.length > 0) pills.push('similar')
  return pills
})

const pillLabels = computed<Record<Section, string>>(() => ({
  editions: t('book.detail.discover.editions'),
  series: t('book.detail.discover.moreInSeries'),
  author: t('book.detail.discover.byAuthor'),
  similar: t('book.detail.discover.similarBooks'),
}))

const pillIcons: Record<Section, typeof BookOpen> = {
  editions: Layers,
  series: BookOpen,
  author: User,
  similar: Sparkles,
}

async function fetchSection(section: FetchedSection) {
  if (fetched.value.has(section)) return
  fetched.value = new Set([...fetched.value, section])
  loading.value = { ...loading.value, [section]: true }

  try {
    const endpointMap: Record<FetchedSection, string> = {
      series: `/api/v1/books/${props.bookId}/series-books`,
      author: `/api/v1/books/${props.bookId}/author-books`,
      similar: `/api/v1/books/${props.bookId}/recommendations`,
    }
    const res = await api(endpointMap[section])
    if (!res.ok) return

    const data = await res.json()
    if (section === 'series') seriesBooks.value = data
    else if (section === 'author') authorBooks.value = data
    else similarBooks.value = data
  } catch {
  } finally {
    loading.value = { ...loading.value, [section]: false }
  }
}

async function selectSection(section: Section) {
  activeSection.value = section
  if (section !== 'editions') await fetchSection(section)
}

function setPillRef(section: Section, element: unknown) {
  if (section === 'editions') editionsPill.value = (element as HTMLButtonElement | null) ?? null
}

/** Opens the Editions tab and brings it into view, for the strip's "All editions" button. */
async function showEditions() {
  if (!hasEditions.value) return
  activeSection.value = 'editions'
  await nextTick()
  const pill = editionsPill.value
  if (!pill) return
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  pill.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  pill.focus({ preventScroll: true })
}

defineExpose({ showEditions })

function handleAddEdition() {
  emit('add-edition')
}

function handleMakeMainEdition(bookId: number) {
  emit('make-main-edition', bookId)
}

function handleRemoveEdition(bookId: number) {
  emit('remove-edition', bookId)
}

function handleScroll(direction: 'left' | 'right') {
  activeCarouselRef.value?.scroll(direction)
}

async function initSection() {
  if (hasEditions.value) activeSection.value = 'editions'
  const candidates: FetchedSection[] = []
  if (props.seriesName) candidates.push('series')
  if (props.authorCount > 0) candidates.push('author')
  candidates.push('similar')
  await Promise.all(candidates.map((s) => fetchSection(s)))
  // A tab picked while the shelves loaded, or the Editions tab, stays.
  if (activeSection.value === null) activeSection.value = candidates.find((s) => booksForSection(s).length > 0) ?? null
}

onMounted(initSection)

watch(
  () => props.bookId,
  async (newId, oldId) => {
    if (newId === oldId) return
    seriesBooks.value = []
    authorBooks.value = []
    similarBooks.value = []
    fetched.value = new Set()
    loading.value = { series: false, author: false, similar: false }
    activeSection.value = null
    await initSection()
  },
)

// Grouping the first edition or removing the last other one, on this page.
watch(hasEditions, (has) => {
  if (has && activeSection.value === null) activeSection.value = 'editions'
  if (!has && activeSection.value === 'editions') {
    activeSection.value = (['series', 'author', 'similar'] as const).find((s) => booksForSection(s).length > 0) ?? null
  }
})

const hasAnyContent = computed(() => availablePills.value.length > 0 || Object.values(loading.value).some(Boolean))
const editionCount = computed(() => formatNumber(props.editions.length))
</script>

<template>
  <div v-if="hasAnyContent" :class="flush ? 'flex h-full min-h-0 flex-col' : 'mt-8 pt-6 border-t border-border'">
    <div class="flex items-center justify-between mb-4">
      <div class="inline-flex items-center gap-1 rounded-lg bg-muted/55 p-1">
        <button
          v-for="pill in availablePills"
          :key="pill"
          :ref="(element) => setPillRef(pill, element)"
          type="button"
          class="flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="
            activeSection === pill
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/70'
          "
          :aria-pressed="activeSection === pill"
          :data-testid="`discover-pill-${pill}`"
          @click="selectSection(pill)"
        >
          <component :is="pillIcons[pill]" :size="12" aria-hidden="true" />
          <span>{{ pillLabels[pill] }}</span>
          <span
            v-if="pill === 'editions'"
            class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted-foreground/22 px-1 text-[10px] font-semibold text-foreground tabular-nums"
            >{{ editionCount }}</span
          >
        </button>
      </div>

      <div v-if="activeSection === 'editions'" class="flex items-center">
        <button
          v-if="canAddEdition"
          type="button"
          class="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:w-7 max-sm:px-0"
          :aria-label="t('book.editions.table.add')"
          data-testid="discover-add-edition"
          @click="handleAddEdition"
        >
          <Plus class="size-[13px]" aria-hidden="true" />
          <span class="max-sm:hidden">{{ t('book.editions.table.add') }}</span>
        </button>
      </div>
      <div v-else class="flex items-center gap-1">
        <button
          class="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="handleScroll('left')"
        >
          <ChevronLeft :size="14" />
        </button>
        <button
          class="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="handleScroll('right')"
        >
          <ChevronRight :size="14" />
        </button>
      </div>
    </div>

    <Transition name="discover-fade" mode="out-in">
      <div :key="activeSection ?? 'init'">
        <div v-if="activeSection === null" class="flex gap-3 overflow-x-auto pb-2">
          <div v-for="i in 10" :key="i" class="w-24 shrink-0">
            <div class="w-full rounded-sm bg-muted animate-shimmer" style="aspect-ratio: 2/3" />
          </div>
        </div>
        <EditionsTable
          v-else-if="activeSection === 'editions'"
          :editions="editions"
          :can-make-main="canMakeMainEdition"
          :removable-book-ids="removableEditionIds"
          :pending="editionsPending"
          @make-main="handleMakeMainEdition"
          @remove="handleRemoveEdition"
        />
        <BookCarousel
          :size="size"
          v-else-if="activeSection === 'series'"
          ref="seriesCarouselRef"
          :books="booksForSection('series')"
          :loading="loading.series"
          :current-book-id="bookId"
          :show-series-index="true"
          :show-header="false"
        />
        <BookCarousel
          :size="size"
          v-else-if="activeSection === 'author'"
          ref="authorCarouselRef"
          :books="booksForSection('author')"
          :loading="loading.author"
          :show-header="false"
        />
        <BookCarousel
          :size="size"
          v-else-if="activeSection === 'similar'"
          ref="similarCarouselRef"
          :books="booksForSection('similar')"
          :loading="loading.similar"
          :show-header="false"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.discover-fade-enter-active,
.discover-fade-leave-active {
  transition: opacity 0.15s ease;
}
.discover-fade-enter-from,
.discover-fade-leave-to {
  opacity: 0;
}
</style>
