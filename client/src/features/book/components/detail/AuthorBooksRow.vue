<script setup lang="ts">
import { watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAuthorBooks } from '@/features/book/composables/useAuthorBooks'
import BookCarousel from '@/features/book/components/detail/BookCarousel.vue'

const props = defineProps<{
  bookId: number
  authorCount: number
}>()

const { t } = useI18n()
const { authorBooks, loading, fetch } = useAuthorBooks()

watch(
  () => props.bookId,
  (id) => fetch(id),
  { immediate: true },
)

const headerText = computed(() => (props.authorCount > 1 ? t('book.detail.authorBooks.alsoByAuthors') : t('book.detail.authorBooks.alsoByAuthor')))

const bookIds = computed(() => authorBooks.value.map((b) => b.id))

defineExpose({ bookIds })
</script>

<template>
  <div v-if="loading || authorBooks.length > 0" class="mt-8 pt-6 border-t border-border">
    <BookCarousel :books="authorBooks" :loading="loading">
      <template #header>
        <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{{ headerText }}</p>
      </template>
    </BookCarousel>
  </div>
</template>
