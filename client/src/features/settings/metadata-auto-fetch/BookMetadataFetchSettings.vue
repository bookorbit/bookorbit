<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { BookMetadataFetchConfig } from '@projectx/types'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useBookMetadataFetchConfig } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchConfig'
import GlobalAutoFetchConfig from './components/GlobalAutoFetchConfig.vue'
import LibraryAutoFetchConfig from './components/LibraryAutoFetchConfig.vue'

const { globalConfig, fetchGlobalConfig } = useBookMetadataFetchConfig()
const { libraries, fetchLibraries } = useLibraries()
const loading = ref(true)

onMounted(async () => {
  try {
    await Promise.all([fetchGlobalConfig(), fetchLibraries()])
  } finally {
    loading.value = false
  }
})

function handleGlobalUpdated(updated: BookMetadataFetchConfig) {
  globalConfig.value = updated
}
</script>

<template>
  <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>

  <template v-else>
    <p class="settings-group-label">Global Settings</p>
    <GlobalAutoFetchConfig v-if="globalConfig" :config="globalConfig" @updated="handleGlobalUpdated" />

    <template v-if="libraries.length > 0">
      <p class="settings-group-label mt-8">Per-Library Overrides</p>
      <div class="flex flex-col gap-3">
        <LibraryAutoFetchConfig v-for="lib in libraries" :key="lib.id" :library="lib" :global-config="globalConfig!" />
      </div>
    </template>
  </template>
</template>
