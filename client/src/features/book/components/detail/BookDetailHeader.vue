<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import BookDetailTabs from './BookDetailTabs.vue'
import { useBookNavigation } from '../../composables/useBookNavigation'

const props = defineProps<{ bookId: number }>()

const route = useRoute()
const router = useRouter()

const { bookIds, getNextId, getPrevId, hasContext, currentIndex, total } = useBookNavigation()

const nextId = ref<number | null>(null)
const prevId = ref<number | null>(null)
const index = computed(() => currentIndex(props.bookId))

watch(
  [() => props.bookId, bookIds],
  async ([id]) => {
    prevId.value = getPrevId(id) ?? null
    nextId.value = (await getNextId(id)) ?? null
  },
  { immediate: true },
)

async function navigateToBook(id: number) {
  await router.push({ name: 'book-detail', params: { bookId: id }, query: route.query })
}
</script>

<template>
  <div
    class="flex items-stretch border-b shrink-0 h-12 md:h-11 px-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:px-3"
  >
    <BookDetailTabs :book-id="bookId" />

    <div v-if="hasContext" class="hidden sm:flex items-center gap-1 ml-4 border-l pl-4">
      <span v-if="index !== -1" class="text-xs text-muted-foreground mr-2 font-medium tabular-nums">
        {{ index + 1 }} <span class="opacity-50">/</span> {{ total }}
      </span>
      <button
        @click="prevId && navigateToBook(prevId)"
        :disabled="!prevId"
        class="h-7 w-7 flex items-center justify-center rounded-md transition-colors"
        :class="prevId ? 'text-foreground hover:bg-muted' : 'text-muted-foreground/60 cursor-not-allowed'"
        title="Previous book"
      >
        <ChevronLeft :size="16" />
      </button>
      <button
        @click="nextId && navigateToBook(nextId)"
        :disabled="!nextId"
        class="h-7 w-7 flex items-center justify-center rounded-md transition-colors"
        :class="nextId ? 'text-foreground hover:bg-muted' : 'text-muted-foreground/60 cursor-not-allowed'"
        title="Next book"
      >
        <ChevronRight :size="16" />
      </button>
    </div>
  </div>
</template>
