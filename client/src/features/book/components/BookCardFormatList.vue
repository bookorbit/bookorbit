<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookCardLinkInfo } from '@bookorbit/types'
import BookFormatChip from './BookFormatChip.vue'
import { cardFormatBadges } from '../lib/book-link'

const MAX_VISIBLE = 6

const props = withDefaults(
  defineProps<{
    /** The card's own format keys, the one its media view shows first. */
    ownKeys: string[]
    linked?: BookCardLinkInfo | null
  }>(),
  { linked: null },
)

const { t } = useI18n()

const badges = computed(() => cardFormatBadges(props.ownKeys, props.linked))
const visible = computed(() => badges.value.slice(0, MAX_VISIBLE))
const hiddenCount = computed(() => Math.max(0, badges.value.length - MAX_VISIBLE))
</script>

<template>
  <span v-if="badges.length > 1" class="flex flex-wrap gap-0.5" aria-hidden="true" data-testid="card-format-list">
    <BookFormatChip
      v-for="badge in visible"
      :key="badge.key"
      :format-key="badge.key"
      :linked="badge.linked"
      variant="solid"
      class="gap-0.5 rounded-xs px-1.5 py-0.5 text-[8px] font-semibold tracking-widest"
      data-testid="card-format-list-chip"
    />
    <span
      v-if="hiddenCount > 0"
      class="rounded-xs bg-black/60 px-1 py-0.5 text-[8px] font-semibold leading-none text-white"
      data-testid="card-format-list-more"
      >{{ t('book.link.badges.more', { count: hiddenCount }) }}</span
    >
  </span>
</template>
