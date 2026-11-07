<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookCardLinkInfo } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { useLibraries } from '@/features/library/composables/useLibraries'
import BookFormatChip from './BookFormatChip.vue'
import { formatKeyName } from '../lib/book-formats'
import { cardFormatBadges } from '../lib/book-link'

const MAX_VISIBLE = 3

const props = defineProps<{
  /** The card's own format keys, the one its media view shows first. */
  ownKeys: string[]
  linked?: BookCardLinkInfo | null
}>()

const { t } = useI18n()
const { libraries } = useLibraries()

const badges = computed(() => cardFormatBadges(props.ownKeys, props.linked))
const visible = computed(() => badges.value.slice(0, MAX_VISIBLE))
const hiddenCount = computed(() => Math.max(0, badges.value.length - MAX_VISIBLE))

/** The whole list in words: the chips are short codes, colours and an icon, so they stay hidden from screen readers. */
const summary = computed(() => {
  const libraryNames = new Map(libraries.value.map((library) => [library.id, library.name]))
  const own = badges.value.filter((badge) => !badge.linked).map((badge) => formatKeyName(badge.key))
  const linked = badges.value
    .filter((badge) => badge.linked)
    .map((badge) => {
      const format = formatKeyName(badge.key)
      const library = badge.libraryId != null ? libraryNames.get(badge.libraryId) : undefined
      return library ? t('book.link.badges.linkedFormat', { format, library }) : format
    })
  if (linked.length === 0 || own.length === 0) return t('book.link.badges.summary', { formats: formatList([...own, ...linked]) })
  return t('book.link.badges.summaryLinked', { formats: formatList(own), linked: formatList(linked) })
})
</script>

<template>
  <span v-if="badges.length > 0" class="contents" data-testid="card-format-badges">
    <span class="flex flex-wrap-reverse items-center justify-end gap-0.5" aria-hidden="true">
      <BookFormatChip
        v-for="badge in visible"
        :key="badge.key"
        :format-key="badge.key"
        :linked="badge.linked"
        variant="solid"
        class="gap-0.5 rounded-xs px-1.5 py-0.5 text-[8px] font-semibold tracking-widest opacity-90"
        :data-linked="badge.linked ? 'true' : undefined"
        data-testid="card-format-badge"
      />
      <span
        v-if="hiddenCount > 0"
        class="rounded-xs bg-black/60 px-1 py-0.5 text-[8px] font-semibold leading-none text-white"
        data-testid="card-format-badges-more"
        >{{ t('book.link.badges.more', { count: hiddenCount }) }}</span
      >
    </span>
    <span class="sr-only" data-testid="card-format-badges-summary">{{ summary }}</span>
  </span>
</template>
