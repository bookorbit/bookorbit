<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Save } from 'lucide-vue-next'
import type { BookMetadataFetchConfig, BookMetadataFetchLibraryConfig, Library } from '@projectx/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import ConditionConfigurator from './ConditionConfigurator.vue'
import { useBookMetadataFetchConfig } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchConfig'
import { useBookMetadataFetchActions } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchActions'
import { useEligibleCountPreview } from '@/features/book-metadata-fetch/composables/useEligibleCountPreview'

const props = defineProps<{
  library: Library
  globalConfig: BookMetadataFetchConfig
}>()

const { fetchLibraryConfig, saveLibraryConfig } = useBookMetadataFetchConfig()
const { triggerForLibrary } = useBookMetadataFetchActions()

const libraryData = ref<BookMetadataFetchLibraryConfig | null>(null)
const inheriting = ref(true)
const local = ref<BookMetadataFetchConfig | null>(null)
const saving = ref(false)
const triggering = ref(false)
const triggerResult = ref<string | null>(null)
const loading = ref(true)

const conditions = computed(() => (inheriting.value ? props.globalConfig.conditions : (local.value?.conditions ?? null)))
const { count: eligibleCount, loading: countLoading } = useEligibleCountPreview(conditions, props.library.id)

const lastRunLabel = computed(() => {
  if (!libraryData.value?.lastRunAt) return null
  const date = new Date(libraryData.value.lastRunAt)
  const diffMs = Date.now() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffMins = Math.floor(diffMs / (1000 * 60))
  let when: string
  if (diffMins < 2) when = 'just now'
  else if (diffMins < 60) when = `${diffMins}m ago`
  else if (diffHours < 24) when = `${diffHours}h ago`
  else if (diffDays === 1) when = 'yesterday'
  else when = `${diffDays} days ago`
  const queued = libraryData.value.lastQueuedCount
  if (queued === null) return `Last run: ${when}`
  return queued > 0 ? `Last run: ${when} - queued ${queued} books` : `Last run: ${when} - no eligible books`
})

onMounted(async () => {
  try {
    libraryData.value = await fetchLibraryConfig(props.library.id)
    local.value = JSON.parse(JSON.stringify(libraryData.value))
  } finally {
    loading.value = false
  }
})

const displayConfig = computed(() => (inheriting.value ? props.globalConfig : local.value) ?? props.globalConfig)

function handleInheritToggle(isInheriting: boolean) {
  inheriting.value = isInheriting
  if (isInheriting) {
    local.value = JSON.parse(JSON.stringify(props.globalConfig))
  }
}

async function handleSave() {
  if (!local.value) return
  saving.value = true
  try {
    const override = inheriting.value ? null : local.value
    await saveLibraryConfig(props.library.id, override)
  } finally {
    saving.value = false
  }
}

async function handleTrigger() {
  triggering.value = true
  triggerResult.value = null
  try {
    const { queued } = await triggerForLibrary(props.library.id)
    triggerResult.value = queued > 0 ? `Queued ${queued} books` : 'No eligible books found'
    if (libraryData.value) {
      libraryData.value.lastRunAt = new Date().toISOString()
      libraryData.value.lastQueuedCount = queued
    }
  } finally {
    triggering.value = false
  }
}
</script>

<template>
  <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
    <div class="flex items-center justify-between px-5 py-4 bg-card">
      <div>
        <p class="settings-label">{{ props.library.name }}</p>
        <p v-if="lastRunLabel" class="text-xs text-muted-foreground mt-0.5">{{ lastRunLabel }}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">Inherit from global</span>
        <ToggleSwitch :model-value="inheriting" @update:model-value="handleInheritToggle" />
      </div>
    </div>

    <div v-if="loading" class="px-5 py-4 bg-card text-xs text-muted-foreground">Loading...</div>

    <template v-else>
      <div v-if="inheriting" class="px-5 py-4 bg-card">
        <p class="text-xs text-muted-foreground italic">Using global defaults.</p>
      </div>

      <div v-else class="px-5 py-4 bg-card">
        <ConditionConfigurator v-model="local!.conditions" :disabled="!displayConfig.enabled" />
      </div>

      <div class="flex items-center gap-3 px-5 py-4 bg-card">
        <button v-if="!inheriting" :disabled="saving" class="settings-btn-primary" @click="handleSave">
          <Save class="size-3.5" />
          {{ saving ? 'Saving...' : 'Save override' }}
        </button>
        <button :disabled="triggering" class="settings-btn-outline" @click="handleTrigger">
          {{ triggering ? 'Running...' : 'Run now' }}
        </button>
        <span v-if="triggerResult" class="text-xs text-muted-foreground">{{ triggerResult }}</span>
        <span v-else-if="eligibleCount !== null" class="text-xs text-muted-foreground">
          {{ countLoading ? '...' : `~${eligibleCount} eligible` }}
        </span>
      </div>
    </template>
  </div>
</template>
