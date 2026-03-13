<script setup lang="ts">
import { computed } from 'vue'
import { Check, Minus } from 'lucide-vue-next'
import type { BookDetail, MetadataScoreWeights } from '@projectx/types'
import { METADATA_SCORE_FIELDS, METADATA_SCORE_GROUP_LABELS, type MetadataScoreField, type MetadataScoreGroup } from '@projectx/types'

const props = defineProps<{
  book: BookDetail
  weights: MetadataScoreWeights
}>()

const emit = defineEmits<{
  editMetadata: []
}>()

function handleEditMetadata() {
  emit('editMetadata')
}

function isFieldFilled(field: MetadataScoreField): boolean {
  const b = props.book
  switch (field) {
    case 'title':
      return !!b.title?.trim()
    case 'subtitle':
      return !!b.subtitle?.trim()
    case 'description':
      return !!b.description?.trim()
    case 'coverSource':
      return b.coverSource != null
    case 'authors':
      return b.authors.length > 0
    case 'genres':
      return b.genres.length > 0
    case 'tags':
      return b.tags.length > 0
    case 'isbn13':
      return !!b.isbn13?.trim()
    case 'isbn10':
      return !!b.isbn10?.trim()
    case 'publisher':
      return !!b.publisher?.trim()
    case 'publishedYear':
      return b.publishedYear != null && b.publishedYear > 0
    case 'language':
      return !!b.language?.trim()
    case 'pageCount':
      return b.pageCount != null && b.pageCount > 0
    case 'rating':
      return b.rating != null && b.rating > 0
    case 'seriesName':
      return !!b.seriesName?.trim()
    case 'seriesIndex':
      return b.seriesIndex != null && b.seriesIndex > 0
    case 'googleBooksId':
      return !!b.providerIds.google?.trim()
    case 'goodreadsId':
      return !!b.providerIds.goodreads?.trim()
    case 'amazonId':
      return !!b.providerIds.amazon?.trim()
    case 'hardcoverId':
      return !!b.providerIds.hardcover?.trim()
    case 'openLibraryId':
      return !!b.providerIds.openLibrary?.trim()
    case 'itunesId':
      return !!b.providerIds.itunes?.trim()
    default:
      return false
  }
}

type FieldEntry = {
  field: MetadataScoreField
  label: string
  weight: number
  filled: boolean
}

type GroupEntry = {
  group: MetadataScoreGroup
  label: string
  fields: FieldEntry[]
}

const groups = computed<GroupEntry[]>(() => {
  const groupOrder: MetadataScoreGroup[] = ['core', 'publishing', 'classification', 'enrichment', 'providers']
  const map = new Map<MetadataScoreGroup, FieldEntry[]>()

  for (const [field, meta] of Object.entries(METADATA_SCORE_FIELDS) as [MetadataScoreField, (typeof METADATA_SCORE_FIELDS)[MetadataScoreField]][]) {
    const weight = props.weights[field]
    if (weight === 0) continue
    const entry: FieldEntry = { field, label: meta.label, weight, filled: isFieldFilled(field) }
    const list = map.get(meta.group) ?? []
    list.push(entry)
    map.set(meta.group, list)
  }

  return groupOrder
    .filter((g) => map.has(g))
    .map((g) => ({
      group: g,
      label: METADATA_SCORE_GROUP_LABELS[g],
      fields: map.get(g)!,
    }))
})

const missingCount = computed(() => groups.value.flatMap((g) => g.fields).filter((f) => !f.filled).length)
</script>

<template>
  <div class="space-y-4 py-1">
    <div v-for="group in groups" :key="group.group">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{{ group.label }}</p>
      <div class="space-y-1">
        <div v-for="entry in group.fields" :key="entry.field" class="flex items-center justify-between gap-2 text-sm">
          <div class="flex items-center gap-1.5 min-w-0">
            <Check v-if="entry.filled" class="size-3.5 text-green-500 shrink-0" />
            <Minus v-else class="size-3.5 text-muted-foreground/50 shrink-0" />
            <span :class="entry.filled ? 'text-foreground' : 'text-muted-foreground'">{{ entry.label }}</span>
          </div>
          <span class="text-xs text-muted-foreground shrink-0">{{ entry.weight }}</span>
        </div>
      </div>
    </div>
    <div v-if="missingCount > 0" class="pt-1 border-t border-border/50">
      <button type="button" class="text-xs text-primary hover:underline" @click="handleEditMetadata">
        {{ missingCount }} field{{ missingCount === 1 ? '' : 's' }} missing - edit metadata
      </button>
    </div>
  </div>
</template>
