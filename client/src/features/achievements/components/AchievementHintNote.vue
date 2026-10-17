<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowRight, Route, RouteOff } from '@lucide/vue'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { HintBook, HintView } from '../lib/achievement-hints'
import { useMomentText } from '../composables/useMomentText'
import AchievementBookCover from './AchievementBookCover.vue'

const props = withDefaults(
  defineProps<{
    view: HintView
    /** `inline` is one quiet line under a progress bar; `card` is the detail sheet's boxed version. */
    variant?: 'inline' | 'card'
  }>(),
  { variant: 'card' },
)

const { t } = useI18n()
const { momentText } = useMomentText()

const sentence = computed(() => momentText(props.view.text))
const note = computed(() => (props.view.note ? momentText(props.view.note) : null))
const actionLabel = computed(() => (props.view.action ? momentText(props.view.action.label) : null))
const actionClass = computed(() =>
  cn(buttonVariants({ variant: 'outline', size: 'sm' }), props.variant === 'inline' ? 'h-7 px-2.5 text-xs' : 'h-7 text-[12.5px]'),
)

function bookLabel(book: HintBook): string {
  return book.title ? t('achievements.hints.openBook', { title: book.title }) : t('achievements.hints.openUntitledBook')
}
</script>

<template>
  <div v-if="variant === 'inline'" class="flex flex-col items-start gap-2">
    <div class="flex w-full items-start gap-2 text-[12.5px] leading-[17px] text-foreground">
      <component :is="view.blocked ? RouteOff : Route" :size="14" class="mt-px shrink-0 text-primary" aria-hidden="true" />
      <p class="min-w-0 flex-1">
        {{ sentence }} <span v-if="note" class="text-muted-foreground">{{ note }}</span>
      </p>
      <span v-if="view.books.length" class="flex shrink-0 gap-1">
        <RouterLink
          v-for="book in view.books"
          :key="book.id"
          :to="`/book/${book.id}`"
          :title="book.title ?? undefined"
          :aria-label="bookLabel(book)"
          class="rounded-[3px] transition-opacity hover:opacity-80"
        >
          <AchievementBookCover :book-id="book.id" class="w-[22px]" />
        </RouterLink>
      </span>
    </div>
    <RouterLink v-if="view.action" :to="view.action.to" :class="actionClass" class="ms-5.5">
      {{ actionLabel }}<ArrowRight :size="14" class="rtl:-scale-x-100" aria-hidden="true" />
    </RouterLink>
  </div>

  <div v-else class="flex items-start gap-3 rounded-xl border border-border bg-card/70 p-3">
    <span v-if="view.books.length" class="flex shrink-0 gap-1">
      <RouterLink
        v-for="book in view.books"
        :key="book.id"
        :to="`/book/${book.id}`"
        :title="book.title ?? undefined"
        :aria-label="bookLabel(book)"
        class="rounded-[3px] transition-opacity hover:opacity-80"
      >
        <AchievementBookCover :book-id="book.id" class="w-10 max-sm:w-9" />
      </RouterLink>
    </span>
    <span v-else class="grid size-11 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-foreground" aria-hidden="true">
      <component :is="view.blocked ? RouteOff : Route" :size="18" />
    </span>
    <div class="flex min-w-0 flex-1 flex-col items-start gap-2">
      <p class="text-[13.5px] leading-[19px] text-foreground">
        {{ sentence }} <span v-if="note" class="text-muted-foreground">{{ note }}</span>
      </p>
      <RouterLink v-if="view.action" :to="view.action.to" :class="actionClass">
        {{ actionLabel }}<ArrowRight :size="14" class="rtl:-scale-x-100" aria-hidden="true" />
      </RouterLink>
    </div>
  </div>
</template>
