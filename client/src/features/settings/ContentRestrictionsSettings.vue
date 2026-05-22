<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ShieldAlert } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { ContentFilterRulesWithNames } from '@bookorbit/types'

const filters = ref<ContentFilterRulesWithNames | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await api('/api/v1/users/me/content-filters')
    if (res.ok) {
      filters.value = await res.json()
    }
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>

  <template v-else-if="filters">
    <div
      v-if="!filters.includeTags?.length && !filters.excludeTags?.length && !filters.includeGenres?.length && !filters.excludeGenres?.length"
      class="rounded-lg border border-border bg-muted/30 px-5 py-8 text-center"
    >
      <ShieldAlert :size="32" class="mx-auto mb-3 text-muted-foreground/60" />
      <p class="text-sm font-medium text-foreground">No content restrictions</p>
      <p class="mt-1 text-xs text-muted-foreground">Your account has full access to all content within your assigned libraries.</p>
    </div>

    <div v-else class="space-y-5">
      <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex gap-3">
        <ShieldAlert :size="18" class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p class="text-sm text-amber-700 dark:text-amber-300">
          Your account has content restrictions applied by an administrator. Some books may not be visible to you.
        </p>
      </div>

      <div v-if="filters.includeTags?.length" class="space-y-2">
        <p class="text-sm font-medium text-foreground">Allowed tags</p>
        <p class="text-xs text-muted-foreground">Only books that have at least one of these tags are shown to you.</p>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="tag in filters.includeTags"
            :key="tag.id"
            class="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
          >
            {{ tag.name }}
          </span>
        </div>
      </div>

      <div v-if="filters.excludeTags?.length" class="space-y-2">
        <p class="text-sm font-medium text-foreground">Blocked tags</p>
        <p class="text-xs text-muted-foreground">Books with any of these tags are hidden from you.</p>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="tag in filters.excludeTags"
            :key="tag.id"
            class="inline-flex items-center rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive"
          >
            {{ tag.name }}
          </span>
        </div>
      </div>

      <div v-if="filters.includeGenres?.length" class="space-y-2">
        <p class="text-sm font-medium text-foreground">Allowed genres</p>
        <p class="text-xs text-muted-foreground">Only books that have at least one of these genres are shown to you.</p>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="genre in filters.includeGenres"
            :key="genre.id"
            class="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
          >
            {{ genre.name }}
          </span>
        </div>
      </div>

      <div v-if="filters.excludeGenres?.length" class="space-y-2">
        <p class="text-sm font-medium text-foreground">Blocked genres</p>
        <p class="text-xs text-muted-foreground">Books with any of these genres are hidden from you.</p>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="genre in filters.excludeGenres"
            :key="genre.id"
            class="inline-flex items-center rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive"
          >
            {{ genre.name }}
          </span>
        </div>
      </div>
    </div>
  </template>
</template>
