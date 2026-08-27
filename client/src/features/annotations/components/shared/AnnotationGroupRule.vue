<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ExternalLink } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'
import AnnotationBookThumb from '../AnnotationBookThumb.vue'
import type { StreamGroup } from '../../lib/stream-groups'

const props = defineProps<{ group: StreamGroup }>()

const { t } = useI18n()

const book = computed(() => props.group.book ?? null)
const bookLink = computed(() =>
  book.value ? { name: 'book-detail', params: { bookId: book.value.bookId }, query: { tab: 'highlights' } } : { name: 'annotations' },
)
</script>

<template>
  <div
    class="sticky top-0 z-[3] flex bg-gradient-to-b from-card from-[74%] to-transparent"
    :class="book ? 'items-center gap-2.5 pb-1.5 pt-3' : 'items-baseline gap-2.5 pb-1 pt-2.5'"
  >
    <template v-if="book">
      <RouterLink :to="bookLink" class="group/rule flex min-w-0 items-center gap-2.5">
        <AnnotationBookThumb :book-id="book.bookId" :title="book.title" class="h-12 w-8 shrink-0" />
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-[13px] font-bold leading-[17px] text-foreground transition-colors group-hover/rule:text-primary">{{
            book.title
          }}</span>
          <span v-if="book.author" class="truncate text-[11px] leading-[15px] text-muted-foreground">{{ book.author }}</span>
        </span>
      </RouterLink>
      <span class="h-px flex-1 bg-border" />
      <RouterLink
        :to="bookLink"
        class="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-muted-foreground opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
      >
        {{ t('annotations.hub.openBook') }}
        <ExternalLink :size="10" />
      </RouterLink>
    </template>
    <template v-else>
      <span class="inline-flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.13em] text-foreground">
        <span v-if="group.swatch" class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: group.swatch }" />
        <span class="truncate">{{ group.label }}</span>
      </span>
      <span class="h-px flex-1 self-center bg-border" />
    </template>
    <span class="shrink-0 text-[9.5px] font-bold text-muted-foreground">{{ formatNumber(group.count) }}</span>
  </div>
</template>
