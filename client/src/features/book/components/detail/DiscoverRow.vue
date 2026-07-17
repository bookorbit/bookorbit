<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, User, Sparkles, ChevronLeft, ChevronRight } from '@lucide/vue'

import type { BookRecommendation, SeriesBookRecommendation } from '@bookorbit/types'
import { api } from '@/lib/api'
import BookCarousel from '@/features/book/components/detail/BookCarousel.vue'

type Section = 'series' | 'author' | 'similar'

const props = defineProps<{
  bookId: number
  seriesName: string | null
  authorCount: number
}>()

const { t } = useI18n()

const seriesBooks = ref<SeriesBookRecommendation[]>([])
const authorBooks = ref<BookRecommendation[]>([])
const similarBooks = ref<BookRecommendation[]>([])

const loading = ref<Record<Section, boolean>>({ series: false, author: false, similar: false })
const fetched = ref<Set<Section>>(new Set())

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

function booksForSection(section: Section) {
  if (section === 'series') return filteredSeriesBooks.value
  if (section === 'author') return authorBooks.value
  return filteredSimilar.value
}

// Pills are purely data-driven — never derived from props — so no phantom pills appear
// when navigating to a book whose props suggest data that the fetch hasn't confirmed yet.
const availablePills = computed<Section[]>(() => {
  const pills: Section[] = []
  if (filteredSeriesBooks.value.length > 0) pills.push('series')
  if (authorBooks.value.length > 0) pills.push('author')
  if (filteredSimilar.value.length > 0) pills.push('similar')
  return pills
})

const pillLabels = computed<Record<Section, string>>(() => ({
  series: t('book.detail.discover.moreInSeries'),
  author: t('book.detail.discover.byAuthor'),
  similar: t('book.detail.discover.similarBooks'),
}))

const pillIcons: Record<Section, typeof BookOpen> = {
  series: BookOpen,
  author: User,
  similar: Sparkles,
}

async function fetchSection(section: Section) {
  if (fetched.value.has(section)) return
  fetched.value = new Set([...fetched.value, section])
  loading.value = { ...loading.value, [section]: true }

  try {
    const endpointMap: Record<Section, string> = {
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
  await fetchSection(section)
}

function handleScroll(direction: 'left' | 'right') {
  activeCarouselRef.value?.scroll(direction)
}

async function initSection() {
  const candidates: Section[] = []
  if (props.seriesName) candidates.push('series')
  if (props.authorCount > 0) candidates.push('author')
  candidates.push('similar')
  await Promise.all(candidates.map((s) => fetchSection(s)))
  activeSection.value = candidates.find((s) => booksForSection(s).length > 0) ?? null
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

const hasAnyContent = computed(() => availablePills.value.length > 0 || Object.values(loading.value).some(Boolean))
</script>

<template>
  <div v-if="hasAnyContent" class="mt-8 pt-6 border-t border-border">
    <div class="flex items-center justify-between mb-4">
      <div class="inline-flex items-center gap-1 rounded-lg bg-muted/55 p-1">
        <button
          v-for="pill in availablePills"
          :key="pill"
          class="flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors"
          :class="
            activeSection === pill
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/70'
          "
          @click="selectSection(pill)"
        >
          <component :is="pillIcons[pill]" :size="12" />
          <span>{{ pillLabels[pill] }}</span>
        </button>
      </div>

      <div class="flex items-center gap-1">
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
        <BookCarousel
          v-else-if="activeSection === 'series'"
          ref="seriesCarouselRef"
          :books="booksForSection('series')"
          :loading="loading.series"
          :current-book-id="bookId"
          :show-series-index="true"
          :show-header="false"
        />
        <BookCarousel
          v-else-if="activeSection === 'author'"
          ref="authorCarouselRef"
          :books="booksForSection('author')"
          :loading="loading.author"
          :show-header="false"
        />
        <BookCarousel
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
