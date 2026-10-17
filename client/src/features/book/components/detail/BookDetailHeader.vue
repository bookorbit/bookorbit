<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import BookDetailTabs from './BookDetailTabs.vue'
import { useBookNavigation } from '../../composables/useBookNavigation'

const props = defineProps<{ bookId: number; canEditMetadata?: boolean; parentLibrary?: { id: number; name: string } | null }>()

const { t } = useI18n()
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
    class="flex items-stretch border-b shrink-0 h-10 md:h-9 px-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:px-3"
  >
    <!-- Without a global header this band is the page's top edge, so it carries the way back up. -->
    <template v-if="parentLibrary">
      <RouterLink
        :to="{ name: 'library', params: { id: parentLibrary.id } }"
        class="-ms-1.5 me-2 flex h-7 shrink-0 items-center gap-1 self-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:text-foreground"
        :aria-label="t('book.detail.header.backToLibrary', { library: parentLibrary.name })"
      >
        <ChevronLeft :size="15" class="shrink-0 rtl:rotate-180" aria-hidden="true" />
        <span class="max-w-[10rem] truncate max-sm:hidden">{{ parentLibrary.name }}</span>
      </RouterLink>
      <span class="me-2 h-4 w-px shrink-0 self-center bg-border" aria-hidden="true" />
    </template>
    <BookDetailTabs :book-id="bookId" :can-edit-metadata="canEditMetadata" />

    <div v-if="hasContext" class="hidden sm:flex items-center gap-1 ml-4 border-l pl-4">
      <span v-if="index !== -1" class="text-xs text-muted-foreground mr-2 font-medium tabular-nums">
        {{ index + 1 }} <span class="opacity-50">/</span> {{ total }}
      </span>
      <button
        @click="prevId && navigateToBook(prevId)"
        :disabled="!prevId"
        class="h-7 w-7 flex items-center justify-center rounded-md transition-colors"
        :class="prevId ? 'text-foreground hover:bg-muted' : 'text-muted-foreground cursor-not-allowed'"
        :title="t('book.detail.header.previousBook')"
      >
        <ChevronLeft :size="16" />
      </button>
      <button
        @click="nextId && navigateToBook(nextId)"
        :disabled="!nextId"
        class="h-7 w-7 flex items-center justify-center rounded-md transition-colors"
        :class="nextId ? 'text-foreground hover:bg-muted' : 'text-muted-foreground cursor-not-allowed'"
        :title="t('book.detail.header.nextBook')"
      >
        <ChevronRight :size="16" />
      </button>
    </div>
  </div>
</template>
