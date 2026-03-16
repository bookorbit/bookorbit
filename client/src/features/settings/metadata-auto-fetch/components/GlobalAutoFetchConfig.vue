<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Save } from 'lucide-vue-next'
import type { BookMetadataFetchConfig } from '@projectx/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import ConditionConfigurator from './ConditionConfigurator.vue'
import { useBookMetadataFetchConfig } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchConfig'
import { useBookMetadataFetchActions } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchActions'
import { useEligibleCountPreview } from '@/features/book-metadata-fetch/composables/useEligibleCountPreview'

const { saveGlobalConfig } = useBookMetadataFetchConfig()
const { triggerGlobal } = useBookMetadataFetchActions()

const props = defineProps<{ config: BookMetadataFetchConfig }>()
const emit = defineEmits<{ updated: [BookMetadataFetchConfig] }>()

const local = ref<BookMetadataFetchConfig>(JSON.parse(JSON.stringify(props.config)))
const saving = ref(false)
const triggering = ref(false)
const triggerResult = ref<string | null>(null)

const conditions = computed(() => local.value.conditions)
const { count: eligibleCount, loading: countLoading } = useEligibleCountPreview(conditions)

watch(
  () => props.config,
  (c) => {
    local.value = JSON.parse(JSON.stringify(c))
  },
  { deep: true },
)

async function handleSave() {
  saving.value = true
  try {
    const updated = await saveGlobalConfig(local.value)
    emit('updated', updated)
  } finally {
    saving.value = false
  }
}

async function handleTrigger() {
  triggering.value = true
  triggerResult.value = null
  try {
    const { queued } = await triggerGlobal()
    triggerResult.value = queued > 0 ? `Queued ${queued} books` : 'No eligible books found'
  } finally {
    triggering.value = false
  }
}
</script>

<template>
  <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
    <div class="flex items-center justify-between px-5 py-4 bg-card">
      <div>
        <p class="settings-label">Enable auto-fetch</p>
        <p class="settings-hint">Automatically fetch metadata for eligible books.</p>
      </div>
      <ToggleSwitch v-model="local.enabled" />
    </div>

    <div class="flex items-center justify-between px-5 py-4 bg-card">
      <div>
        <p class="settings-label">Trigger on import</p>
        <p class="settings-hint">Queue eligible books when they are first added to a library.</p>
      </div>
      <ToggleSwitch v-model="local.triggerOnImport" :disabled="!local.enabled" />
    </div>

    <div class="px-5 py-4 bg-card">
      <p class="settings-label mb-0.5">Eligibility conditions</p>
      <p class="settings-hint mb-4">A book is eligible if it matches any enabled condition.</p>
      <ConditionConfigurator v-model="local.conditions" />
    </div>

    <div class="flex items-center gap-3 px-5 py-4 bg-card">
      <button :disabled="saving" class="settings-btn-primary" @click="handleSave">
        <Save class="size-3.5" />
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
      <div class="w-px h-4 bg-border shrink-0" />
      <button :disabled="triggering" class="settings-btn-outline" @click="handleTrigger">
        {{ triggering ? 'Running...' : 'Run for eligible books' }}
      </button>
      <span v-if="triggerResult" class="text-xs text-muted-foreground">{{ triggerResult }}</span>
      <span v-else-if="eligibleCount !== null" class="text-xs text-muted-foreground">
        {{ countLoading ? '...' : `~${eligibleCount} eligible` }}
      </span>
    </div>
  </div>
</template>
