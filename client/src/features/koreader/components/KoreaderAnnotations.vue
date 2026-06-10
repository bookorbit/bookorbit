<script setup lang="ts">
import { computed } from 'vue'
import { Smartphone } from 'lucide-vue-next'
import type { KoreaderAnnotationItem } from '@bookorbit/types'
import { useKoreaderAnnotations } from '@/features/koreader/composables/useKoreaderAnnotations'

const props = defineProps<{ bookId: number }>()

const bookIdRef = computed(() => props.bookId)
const { items, loading } = useKoreaderAnnotations(bookIdRef)

const grouped = computed(() => {
  const groups = new Map<string, KoreaderAnnotationItem[]>()
  for (const item of items.value) {
    const key = item.chapter ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  return groups
})

function textClass(item: KoreaderAnnotationItem): string {
  switch (item.drawer) {
    case 'underscore':
      return 'underline decoration-2 underline-offset-2'
    case 'strikeout':
      return 'line-through'
    case 'invert':
      return 'bg-foreground text-background px-1 rounded-sm'
    default:
      return 'bg-primary/10 px-1 rounded-sm'
  }
}

function formatDeviceDate(value: string): string {
  return value.slice(0, 16)
}
</script>

<template>
  <section v-if="items.length > 0 && !loading" class="space-y-4">
    <div class="flex items-center gap-2 pt-2">
      <Smartphone :size="16" class="text-muted-foreground" />
      <h3 class="text-sm font-semibold text-foreground">KOReader highlights and notes</h3>
      <span class="text-xs text-muted-foreground">{{ items.length }}</span>
    </div>

    <div v-for="[chapterTitle, annotations] in grouped" :key="chapterTitle" class="space-y-2">
      <p v-if="chapterTitle" class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ chapterTitle }}</p>
      <div v-for="annotation in annotations" :key="annotation.id" class="rounded-lg border border-border bg-card px-4 py-3 space-y-2 shadow-xs">
        <p v-if="annotation.text" class="text-sm leading-relaxed text-foreground">
          <span :class="textClass(annotation)">{{ annotation.text }}</span>
        </p>
        <p v-if="annotation.note" class="text-sm text-muted-foreground border-l-2 border-primary/40 pl-3">
          {{ annotation.note }}
        </p>
        <p class="text-xs text-muted-foreground/80">
          <template v-if="annotation.pageno != null">p. {{ annotation.pageno }} &middot; </template>{{ formatDeviceDate(annotation.deviceCreatedAt) }}
        </p>
      </div>
    </div>
  </section>
</template>
