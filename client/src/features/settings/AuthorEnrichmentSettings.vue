<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, Save } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import type { AuthorAutoEnrichmentConfig } from '@projectx/types'
import { api } from '@/lib/api'
import { useAuthorEligibleCountPreview } from './composables/useAuthorEligibleCountPreview'

const DEFAULT_CONFIG: AuthorAutoEnrichmentConfig = {
  enabled: false,
  triggerOnImport: true,
  writeMode: 'missing_only',
  conditions: { neverEnriched: true, missingBio: false, missingPhoto: false },
}

const config = ref<AuthorAutoEnrichmentConfig>({ ...DEFAULT_CONFIG, conditions: { ...DEFAULT_CONFIG.conditions } })
const saving = ref(false)
const authorBackfillRunning = ref(false)
const authorBackfillAllRunning = ref(false)

const eligibleConditions = computed(() => config.value.conditions)
const { count: eligibleCount, loading: countLoading } = useAuthorEligibleCountPreview(eligibleConditions)

onMounted(async () => {
  const res = await api('/api/v1/authors/enrichment/config')
  if (res.ok) {
    config.value = await res.json()
  }
})

async function saveConfig() {
  if (saving.value) return
  saving.value = true
  try {
    const res = await api('/api/v1/authors/enrichment/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.value),
    })
    if (res.ok) {
      config.value = await res.json()
      toast.success('Author enrichment settings saved')
    } else {
      toast.error('Failed to save author enrichment settings')
    }
  } catch {
    toast.error('Failed to save author enrichment settings')
  } finally {
    saving.value = false
  }
}

function toggleEnabled() {
  config.value = { ...config.value, enabled: !config.value.enabled }
}

function toggleTriggerOnImport() {
  config.value = { ...config.value, triggerOnImport: !config.value.triggerOnImport }
}

function toggleCondition(key: keyof AuthorAutoEnrichmentConfig['conditions']) {
  config.value = { ...config.value, conditions: { ...config.value.conditions, [key]: !config.value.conditions[key] } }
}

function onWriteModeChange(event: Event) {
  const mode = (event.target as HTMLSelectElement).value as AuthorAutoEnrichmentConfig['writeMode']
  config.value = { ...config.value, writeMode: mode }
}

async function runAuthorBackfill() {
  if (authorBackfillRunning.value) return
  authorBackfillRunning.value = true
  try {
    const res = await api('/api/v1/authors/enrichment/backfill', { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { queued } = await res.json()
    if (queued === 0) toast.info('No eligible authors found')
  } catch {
    toast.error('Failed to queue author backfill')
  } finally {
    authorBackfillRunning.value = false
  }
}

async function runAuthorBackfillAll() {
  if (authorBackfillAllRunning.value) return
  authorBackfillAllRunning.value = true
  try {
    const res = await api('/api/v1/authors/enrichment/backfill-all', { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { queued } = await res.json()
    if (queued === 0) toast.info('No authors to enrich')
  } catch {
    toast.error('Failed to queue author backfill')
  } finally {
    authorBackfillAllRunning.value = false
  }
}
</script>

<template>
  <p class="settings-group-label">Configuration</p>
  <div
    class="md:hidden sticky top-[5.25rem] z-10 -mx-4 mb-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
  >
    <div class="flex items-center gap-2 flex-wrap">
      <button class="settings-btn-primary flex-1 justify-center" :disabled="saving" @click="saveConfig">
        <Save class="size-3.5" />
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
      <button class="settings-btn-outline" :disabled="authorBackfillRunning" @click="runAuthorBackfill">
        <RefreshCw :size="13" :class="authorBackfillRunning ? 'animate-spin' : ''" />
        {{ authorBackfillRunning ? 'Running...' : 'Run eligible' }}
      </button>
      <button class="settings-btn-outline" :disabled="authorBackfillAllRunning" @click="runAuthorBackfillAll">
        <RefreshCw :size="13" :class="authorBackfillAllRunning ? 'animate-spin' : ''" />
        {{ authorBackfillAllRunning ? 'Running...' : 'Run all' }}
      </button>
    </div>
  </div>
  <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
    <div class="px-4 py-3.5 md:px-5 md:py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6 bg-card">
      <div>
        <p class="settings-label">Enable auto author enrichment</p>
        <p class="settings-hint">Automatically fetch author biographies and profile photos when books are added or updated.</p>
      </div>
      <ToggleSwitch class="self-start" :model-value="config.enabled" :disabled="saving" @update:model-value="toggleEnabled" />
    </div>

    <div class="px-4 py-3.5 md:px-5 md:py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6 bg-card">
      <div>
        <p class="settings-label">Update strategy</p>
        <p class="settings-hint">What to do when an author already has a biography or photo.</p>
      </div>
      <select class="select-field w-full md:w-64" :value="config.writeMode" :disabled="saving" @change="onWriteModeChange">
        <option value="missing_only">Only fill missing data (recommended)</option>
        <option value="always_refetch">Always refresh existing data</option>
      </select>
    </div>

    <template v-if="config.enabled">
      <div class="px-4 py-3.5 md:px-5 md:py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6 bg-card">
        <div>
          <p class="settings-label">Trigger on import</p>
          <p class="settings-hint">Queue authors for enrichment when books are first added to a library.</p>
        </div>
        <ToggleSwitch class="self-start" :model-value="config.triggerOnImport" :disabled="saving" @update:model-value="toggleTriggerOnImport" />
      </div>
    </template>

    <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
      <p class="settings-label mb-1">Eligibility conditions</p>
      <p class="settings-hint mb-3">An author is eligible if it matches any enabled condition.</p>
      <div class="flex flex-col gap-4">
        <label class="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            class="w-4 h-4 rounded border-border accent-primary"
            :checked="config.conditions.neverEnriched"
            :disabled="saving"
            @change="toggleCondition('neverEnriched')"
          />
          <div>
            <span class="text-sm font-medium">Never enriched</span>
            <p class="text-xs text-muted-foreground">Enrich authors that have never had a successful enrichment.</p>
          </div>
        </label>
        <label class="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            class="w-4 h-4 rounded border-border accent-primary"
            :checked="config.conditions.missingBio"
            :disabled="saving"
            @change="toggleCondition('missingBio')"
          />
          <div>
            <span class="text-sm font-medium">Missing bio</span>
            <p class="text-xs text-muted-foreground">Enrich if the author has no biography.</p>
          </div>
        </label>
        <label class="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            class="w-4 h-4 rounded border-border accent-primary"
            :checked="config.conditions.missingPhoto"
            :disabled="saving"
            @change="toggleCondition('missingPhoto')"
          />
          <div>
            <span class="text-sm font-medium">Missing photo</span>
            <p class="text-xs text-muted-foreground">Enrich if the author has no profile photo.</p>
          </div>
        </label>
      </div>
    </div>

    <div class="hidden md:flex items-center gap-3 px-5 py-4 bg-card">
      <button class="settings-btn-primary" :disabled="saving" @click="saveConfig">
        <Save class="size-3.5" />
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
      <div class="w-px h-4 bg-border shrink-0" />
      <button class="settings-btn-outline" :disabled="authorBackfillRunning" @click="runAuthorBackfill">
        <RefreshCw :size="13" :class="authorBackfillRunning ? 'animate-spin' : ''" />
        {{ authorBackfillRunning ? 'Running...' : 'Run for eligible authors' }}
      </button>
      <span v-if="eligibleCount !== null" class="text-xs text-muted-foreground">
        {{ countLoading ? '...' : `~${eligibleCount} eligible` }}
      </span>
      <div class="w-px h-4 bg-border shrink-0" />
      <button class="settings-btn-outline" :disabled="authorBackfillAllRunning" @click="runAuthorBackfillAll">
        <RefreshCw :size="13" :class="authorBackfillAllRunning ? 'animate-spin' : ''" />
        {{ authorBackfillAllRunning ? 'Running...' : 'Run for all authors' }}
      </button>
    </div>
  </div>
</template>
