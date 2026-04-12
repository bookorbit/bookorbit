<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, Save } from 'lucide-vue-next'
import type { BookMetadataFetchConfig } from '@projectx/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import ConditionConfigurator from './ConditionConfigurator.vue'
import { useBookMetadataFetchConfig } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchConfig'
import { useBookMetadataFetchActions } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchActions'
import { useEligibleCountPreview } from '@/features/book-metadata-fetch/composables/useEligibleCountPreview'
import { useMediaQuery } from '@vueuse/core'

const { saveGlobalConfig } = useBookMetadataFetchConfig()
const { triggerGlobal } = useBookMetadataFetchActions()

const props = defineProps<{ config: BookMetadataFetchConfig }>()
const emit = defineEmits<{ updated: [BookMetadataFetchConfig] }>()

const local = ref<BookMetadataFetchConfig>(JSON.parse(JSON.stringify(props.config)))
const saving = ref(false)
const triggering = ref(false)
const triggerResult = ref<string | null>(null)
const isMobile = useMediaQuery('(max-width: 767px)')
const conditionsOpen = ref(true)

const conditions = computed(() => local.value.conditions)
const { count: eligibleCount, loading: countLoading } = useEligibleCountPreview(conditions)
const activeConditionSummary = computed(() => {
  const c = local.value.conditions
  const parts: string[] = []
  if (c.neverFetched.enabled) parts.push('Never fetched')
  if (c.scoreThreshold.enabled) parts.push(`Score < ${c.scoreThreshold.threshold}`)
  if (c.missingFields.enabled && c.missingFields.fields.length > 0)
    parts.push(`Missing ${c.missingFields.fields.length} field${c.missingFields.fields.length === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(' • ') : 'No conditions enabled'
})

watch(
  () => props.config,
  (c) => {
    local.value = JSON.parse(JSON.stringify(c))
  },
  { deep: true },
)
watch(
  isMobile,
  () => {
    conditionsOpen.value = true
  },
  { immediate: true },
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
    <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="settings-label">Enable auto-fetch</p>
          <p class="settings-hint">Automatically fetch metadata for eligible books.</p>
        </div>
        <ToggleSwitch class="self-start" v-model="local.enabled" />
      </div>
    </div>

    <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="settings-label">Trigger on import</p>
          <p class="settings-hint">Queue eligible books when they are first added to a library.</p>
        </div>
        <ToggleSwitch class="self-start" v-model="local.triggerOnImport" :disabled="!local.enabled" />
      </div>
    </div>

    <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
      <button class="w-full flex items-center justify-between gap-2 text-left" @click="conditionsOpen = !conditionsOpen">
        <p class="settings-label">Eligibility conditions</p>
        <ChevronUp v-if="conditionsOpen" :size="15" class="text-muted-foreground shrink-0" />
        <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
      </button>
      <p class="settings-hint mt-1 mb-4">A book is eligible if it matches any enabled condition.</p>
      <p class="text-xs text-muted-foreground mb-3">{{ activeConditionSummary }}</p>
      <ConditionConfigurator v-if="conditionsOpen" v-model="local.conditions" />
    </div>

    <div class="md:hidden sticky bottom-2 z-10 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <div class="flex items-center gap-2 flex-wrap">
        <button :disabled="saving" class="settings-btn-primary h-9 px-3 justify-center" @click="handleSave">
          <Save class="size-3.5" />
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <button :disabled="triggering" class="settings-btn-outline h-9 px-3" @click="handleTrigger">
          {{ triggering ? 'Running...' : 'Run now' }}
        </button>
        <span v-if="triggerResult" class="text-xs text-muted-foreground">{{ triggerResult }}</span>
      </div>
    </div>

    <div class="hidden md:flex items-center gap-3 px-5 py-4 bg-card">
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
