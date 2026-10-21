<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { providerBadgeStyle, toDisplayCoverUrl, hideOnError } from '@/features/book/lib/metadata-fetch'
import MetadataCacheBadge from '@/features/metadata-cache/components/MetadataCacheBadge.vue'
import type { AuthorMatchEntry } from '../composables/useAuthorMatchPicker'
import { authorInitials } from '../lib/author-identity'
import { authorProviderLabel, candidateLifeYears } from '../lib/author-metadata-match'

const props = defineProps<{
  entry: AuthorMatchEntry
  selected: boolean
  current: boolean
}>()

const emit = defineEmits<{ select: [AuthorMatchEntry] }>()

const { t } = useI18n()

const candidate = computed(() => props.entry.candidate)
const imageUrl = computed(() => toDisplayCoverUrl(candidate.value.imageUrl))
const initials = computed(() => authorInitials(candidate.value.name))
const lifeLine = computed(() => {
  const { born, died } = candidateLifeYears(candidate.value)
  const year = (value: number) => formatNumber(value, { useGrouping: false })
  if (born !== null && died !== null) return t('author.match.results.lifeSpan', { born: year(born), died: year(died) })
  if (born !== null) return t('author.match.results.born', { year: year(born) })
  return null
})
const bio = computed(() => candidate.value.description?.trim() || null)

function handleSelect() {
  emit('select', props.entry)
}
</script>

<template>
  <button
    type="button"
    class="grid w-full grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2.5 rounded-lg border p-2 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    :class="selected ? 'border-primary/45 bg-primary/10' : 'border-transparent hover:bg-muted/70'"
    :aria-current="selected ? 'true' : undefined"
    @click="handleSelect"
  >
    <span class="relative block size-11 overflow-hidden rounded-md bg-muted ring-1 ring-border">
      <img v-if="imageUrl" :src="imageUrl" alt="" class="size-full object-cover" loading="lazy" @error="hideOnError" />
      <span v-else class="grid size-full place-items-center text-sm font-semibold text-primary" aria-hidden="true">{{ initials }}</span>
    </span>
    <span class="min-w-0">
      <span class="block text-[13px] leading-snug font-semibold [overflow-wrap:anywhere] text-foreground">{{ candidate.name }}</span>
      <span v-if="lifeLine" class="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{{ lifeLine }}</span>
      <span v-if="bio" class="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{{ bio }}</span>
      <span class="mt-1.5 flex flex-wrap gap-1">
        <span class="inline-flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-bold" :style="providerBadgeStyle(candidate.provider)">
          {{ authorProviderLabel(candidate.provider) }}
        </span>
        <MetadataCacheBadge v-if="entry.cache" :info="entry.cache" />
        <span v-if="current" class="inline-flex h-[18px] items-center rounded-md bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary">
          {{ t('author.match.results.current') }}
        </span>
      </span>
    </span>
  </button>
</template>
