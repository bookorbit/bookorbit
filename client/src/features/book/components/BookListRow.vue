<script setup lang="ts">
import type { BookCard, BookFileRef } from '@projectx/types'
import { bookCoverStyle } from '../lib/book-cover'
import { api } from '@/lib/api'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, Check, ExternalLink, FolderPlus, MoreHorizontal, PanelRight, Pencil, Star, Trash2, TriangleAlert } from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useCoverVersions } from '../composables/useCoverVersions'

const router = useRouter()

const props = defineProps<{
  book: BookCard
  selectionMode?: boolean
  selected?: boolean
}>()

type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete'
const emit = defineEmits<{
  action: [type: BookActionType]
  select: []
  'rating-change': [rating: number | null]
}>()

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const authorLine = computed(() => props.book.authors.join(', ') || null)
const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

const isMissing = computed(() => props.book.status === 'missing')
const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const secondaryFiles = computed(() => props.book.files.filter((f) => f !== primaryFile.value))

const metaLine = computed(() => {
  const parts: string[] = []
  if (props.book.publishedYear) parts.push(String(props.book.publishedYear))
  if (props.book.pageCount) parts.push(`${props.book.pageCount}p`)
  if (props.book.language) parts.push(props.book.language.toUpperCase())
  return parts.length > 0 ? parts.join(' · ') : null
})

const visibleTags = computed(() => props.book.tags.slice(0, 2))

const coverLoaded = ref(false)
const coverFailed = ref(false)

const localRating = ref<number | null>(props.book.rating)
const hoverRating = ref<number | null>(null)
const displayRating = computed(() => hoverRating.value ?? localRating.value)

async function setRating(star: number) {
  const newRating = localRating.value === star ? null : star
  localRating.value = newRating
  emit('rating-change', newRating)
  await api(`/api/books/${props.book.id}/rating`, { method: 'PATCH', body: JSON.stringify({ rating: newRating }) })
}

const { coverUrl } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id))

function openFile(file: BookFileRef) {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}
</script>

<template>
  <div
    class="flex items-center gap-3 py-2 px-2 rounded-md transition-colors"
    :class="[
      selectionMode || (primaryFile && !isMissing) ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default',
      isMissing ? 'opacity-60 grayscale' : '',
      selected ? 'bg-primary/8 ring-1 ring-primary/30' : '',
    ]"
    @click="selectionMode ? emit('select') : primaryFile && !isMissing && openFile(primaryFile)"
  >
    <!-- Selection checkbox -->
    <div
      v-if="selectionMode"
      class="h-5 w-5 rounded shrink-0 flex items-center justify-center transition-colors"
      :class="selected ? 'bg-primary' : 'border border-border bg-background'"
    >
      <Check v-if="selected" class="text-primary-foreground" :size="12" />
    </div>

    <!-- Cover -->
    <div class="h-16 w-12 rounded shrink-0 overflow-hidden relative" :style="coverLoaded ? {} : coverStyle">
      <img
        v-if="!coverFailed"
        :src="coverSrc"
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
        :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
        loading="lazy"
        :alt="book.title ?? ''"
        @load="coverLoaded = true"
        @error="coverFailed = true"
      />
    </div>

    <!-- Main info -->
    <div class="flex flex-col min-w-0 flex-1 gap-0.5">
      <span class="text-sm font-medium text-foreground truncate leading-snug">{{ book.title ?? '-' }}</span>
      <span v-if="authorLine" class="text-xs text-muted-foreground truncate">{{ authorLine }}</span>
      <span v-if="seriesLine" class="text-xs text-muted-foreground/70 truncate italic">{{ seriesLine }}</span>
      <span v-if="metaLine" class="text-xs text-muted-foreground/60 truncate">{{ metaLine }}</span>
      <!-- Tags -->
      <div v-if="visibleTags.length > 0" class="flex items-center gap-1 flex-wrap">
        <span v-for="tag in visibleTags" :key="tag" class="text-[10px] px-1.5 py-0 rounded-full bg-muted text-muted-foreground leading-5">{{
          tag
        }}</span>
      </div>
      <!-- Reading progress -->
      <div v-if="book.readingProgress != null && book.readingProgress > 0" class="flex items-center gap-1.5 mt-0.5">
        <div class="h-1 flex-1 rounded-full bg-muted overflow-hidden max-w-24">
          <div class="h-full rounded-full bg-primary/60 transition-all" :style="{ width: `${book.readingProgress}%` }" />
        </div>
        <span class="text-[10px] text-muted-foreground/70 tabular-nums">{{ Math.round(book.readingProgress) }}%</span>
      </div>
    </div>

    <!-- Right badges + actions -->
    <div v-if="!selectionMode" class="flex items-center gap-1.5 shrink-0" @click.stop>
      <!-- Star rating -->
      <div class="hidden sm:flex items-center gap-0.5" @mouseleave="hoverRating = null">
        <button
          v-for="star in 5"
          :key="star"
          class="p-0.5 transition-colors"
          :title="`Rate ${star}`"
          @mouseenter="hoverRating = star"
          @click="setRating(star)"
        >
          <Star class="size-3" :class="(displayRating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'" />
        </button>
      </div>

      <!-- Format badges -->
      <div class="flex items-center gap-1">
        <span
          v-if="isMissing"
          class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400"
        >
          <TriangleAlert class="size-3 shrink-0" />
          <span class="hidden sm:inline">Missing</span>
        </span>
        <button
          v-if="primaryFile && !isMissing"
          class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
          :title="`Open as ${primaryFile.format?.toUpperCase() ?? 'unknown'}`"
          @click="openFile(primaryFile)"
        >
          {{ primaryFile.format ?? '?' }}
        </button>
        <button
          v-for="file in secondaryFiles"
          :key="file.id"
          class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
          :title="`Open as ${file.format?.toUpperCase() ?? 'unknown'}`"
          @click="openFile(file)"
        >
          {{ file.format ?? '?' }}
        </button>
      </div>

      <!-- Open button -->
      <button
        v-if="primaryFile && !isMissing"
        class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        title="Open"
        @click="openFile(primaryFile)"
      >
        <BookOpen class="size-4" />
      </button>

      <!-- Quick view (hidden on mobile) -->
      <button
        class="hidden sm:flex p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        title="Quick view"
        @click="emit('action', 'quick-view')"
      >
        <PanelRight class="size-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <MoreHorizontal class="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="primaryFile && openFile(primaryFile)">
            <BookOpen class="size-4 mr-2" />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id } })">
            <ExternalLink class="size-4 mr-2" />
            Book Details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="emit('action', 'edit-metadata')">
            <Pencil class="size-4 mr-2" />
            Edit Metadata
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('action', 'add-to-collection')">
            <FolderPlus class="size-4 mr-2" />
            Add to Collection
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive focus:text-destructive" @click="emit('action', 'delete')">
            <Trash2 class="size-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
