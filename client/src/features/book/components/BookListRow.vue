<script setup lang="ts">
import type { BookCard, BookFileRef } from '@projectx/types'
import { bookCoverStyle } from '../lib/book-cover'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const props = defineProps<{ book: BookCard }>()

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const authorLine = computed(() => props.book.authors.join(', ') || null)
const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const extraFiles = computed(() => (props.book.files.length > 1 ? props.book.files : []))

const coverLoaded = ref(false)
const coverFailed = ref(false)

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
    :class="primaryFile ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default opacity-60'"
    @click="primaryFile && openFile(primaryFile)"
  >
    <!-- Cover -->
    <div class="h-16 w-12 rounded shrink-0 overflow-hidden relative" :style="coverLoaded ? {} : coverStyle">
      <img
        v-if="!coverFailed"
        :src="`/api/books/${book.id}/thumbnail`"
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
    </div>

    <!-- Right badges -->
    <div class="flex flex-col items-end gap-1 shrink-0" @click.stop>
      <span
        v-if="book.status === 'missing'"
        class="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground"
      >
        Missing
      </span>
      <button
        v-for="file in extraFiles"
        :key="file.id"
        class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
        :class="file.role === 'primary' ? 'text-foreground' : 'text-muted-foreground'"
        :title="`Open as ${file.format?.toUpperCase() ?? 'unknown'}`"
        @click="openFile(file)"
      >
        {{ file.format ?? '?' }}
      </button>
    </div>
  </div>
</template>
