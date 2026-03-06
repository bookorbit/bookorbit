<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen } from 'lucide-vue-next'

import type { BookCard } from '@projectx/types'
import { FORMAT_TO_GROUP } from '@projectx/types'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const props = defineProps<{
  book: BookCard
  showProgress?: boolean
}>()

const router = useRouter()
const { coverUrl } = useCoverVersions()

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const coverSrc = computed(() => coverUrl(props.book.id))
const coverLoaded = ref(false)
const coverFailed = ref(false)

const readableFiles = computed(() => props.book.files.filter((f) => f.format && f.format in FORMAT_TO_GROUP))
const primaryFile = computed(() => readableFiles.value.find((f) => f.role === 'primary') ?? readableFiles.value[0] ?? null)
const progressPct = computed(() => (props.showProgress && props.book.readingProgress ? props.book.readingProgress : 0))

function handleClick() {
  if (primaryFile.value) {
    router.push({
      name: 'reader',
      params: { bookId: props.book.id, fileId: primaryFile.value.id },
      query: { format: primaryFile.value.format ?? 'epub' },
    })
  } else {
    router.push({ name: 'book-detail', params: { bookId: props.book.id } })
  }
}
</script>

<template>
  <div class="group cursor-pointer select-none" @click="handleClick">
    <div
      class="relative w-full overflow-hidden rounded-lg shadow-md transition-all duration-200 group-hover:shadow-xl group-hover:scale-[1.04]"
      style="aspect-ratio: 2/3"
      :style="coverLoaded ? {} : coverStyle"
    >
      <img
        v-if="!coverFailed"
        :src="coverSrc"
        class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
        :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
        loading="lazy"
        :alt="book.title ?? ''"
        @load="coverLoaded = true"
        @error="coverFailed = true"
      />

      <!-- Hover overlay -->
      <div
        class="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100"
      >
        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
          <BookOpen :size="16" class="text-white" />
        </div>
      </div>

      <!-- Progress bar (continue-reading only) -->
      <div v-if="progressPct > 0" class="absolute bottom-0 left-0 right-0 h-[3px] bg-black/30">
        <div class="h-full bg-emerald-400" :style="{ width: progressPct + '%' }" />
      </div>
    </div>
  </div>
</template>
