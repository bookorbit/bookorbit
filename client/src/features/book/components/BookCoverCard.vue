<script setup lang="ts">
import type { Book, BookFile } from '../composables/useBooks'
import { bookCoverStyle } from '../composables/useBooks'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const props = defineProps<{ book: Book }>()

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const authorLine = computed(() => props.book.authors.join(', ') || null)
const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
// Only show format chips when there are multiple files
const extraFiles = computed(() => (props.book.files.length > 1 ? props.book.files : []))

const coverUrl = `/api/books/${props.book.id}/thumbnail`
const coverLoaded = ref(false)
const coverFailed = ref(false)

function openFile(file: BookFile) {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}
</script>

<template>
  <div
    class="group flex flex-col gap-1.5"
    :class="primaryFile ? 'cursor-pointer' : 'cursor-default opacity-60'"
    @click="primaryFile && openFile(primaryFile)"
  >
    <!-- Cover -->
    <div
      class="relative w-full rounded-sm overflow-hidden shadow-md group-hover:shadow-xl group-hover:scale-[1.02] transition-all duration-150"
      style="aspect-ratio: 2/3"
      :style="coverLoaded ? {} : coverStyle"
    >
      <img
        v-if="!coverFailed"
        :src="coverUrl"
        class="absolute inset-0 w-full h-full object-cover"
        :class="{ 'opacity-0': !coverLoaded }"
        @load="coverLoaded = true"
        @error="coverFailed = true"
        :alt="book.title ?? ''"
      />

      <!-- Series badge -->
      <div v-if="seriesLine" class="absolute top-1.5 left-1.5 right-1.5">
        <span
          class="text-[8px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-black/30 backdrop-blur-sm line-clamp-1"
          :style="{ color: coverStyle.color }"
        >
          {{ seriesLine }}
        </span>
      </div>

      <!-- Format chips — only shown when book has multiple files -->
      <div v-if="extraFiles.length > 0" class="absolute bottom-1.5 right-1.5 flex flex-col gap-1 items-end" @click.stop>
        <button
          v-for="file in extraFiles"
          :key="file.id"
          class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm hover:bg-black/70 transition-colors"
          :class="file.role === 'primary' ? 'text-white' : 'text-white/70'"
          :title="`Open as ${file.format?.toUpperCase() ?? 'unknown'}`"
          @click="openFile(file)"
        >
          {{ file.format ?? '?' }}
        </button>
      </div>

      <!-- Missing overlay -->
      <div v-if="book.status === 'missing'" class="absolute inset-0 bg-black/60 flex items-center justify-center">
        <span class="text-[10px] font-semibold uppercase tracking-widest text-destructive-foreground bg-destructive px-2 py-0.5 rounded">
          Missing
        </span>
      </div>

      <!-- Title + author (shown when no real cover) -->
      <div v-if="!coverLoaded" class="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
        <p class="text-xs font-bold leading-tight line-clamp-3" :style="{ color: coverStyle.color }">
          {{ book.title ?? '—' }}
        </p>
        <p v-if="authorLine" class="text-[10px] mt-0.5 opacity-80 truncate" :style="{ color: coverStyle.color }">
          {{ authorLine }}
        </p>
      </div>
    </div>

    <!-- Text below -->
    <div class="px-0.5">
      <p class="text-xs font-medium text-foreground truncate leading-tight">
        {{ book.title ?? '—' }}
      </p>
      <p v-if="authorLine" class="text-[11px] text-muted-foreground truncate">
        {{ authorLine }}
      </p>
    </div>
  </div>
</template>
