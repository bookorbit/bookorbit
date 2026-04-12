<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { RefreshCw, Save, RotateCcw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { MetadataScoreWeights, MetadataScoreField } from '@projectx/types'
import { DEFAULT_METADATA_SCORE_WEIGHTS, METADATA_SCORE_FIELDS, METADATA_SCORE_GROUP_LABELS, type MetadataScoreGroup } from '@projectx/types'
import { api } from '@/lib/api'
import { useMetadataScoreWeights } from '@/features/metadata-score/composables/useMetadataScoreWeights'

const { resetFetchCache } = useMetadataScoreWeights()

const weights = reactive<MetadataScoreWeights>({ ...DEFAULT_METADATA_SCORE_WEIGHTS })
const saving = ref(false)
const recalculating = ref(false)
const resetConfirming = ref(false)
let resetConfirmTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  const res = await api('/api/v1/metadata-score/weights')
  if (res.ok) {
    const data: MetadataScoreWeights = await res.json()
    Object.assign(weights, data)
  }
})

const totalWeight = computed(() => Object.values(weights).reduce((s, w) => s + (w ?? 0), 0))

const groupOrder: MetadataScoreGroup[] = ['core', 'publishing', 'classification', 'enrichment', 'providers']

type FieldEntry = { field: MetadataScoreField; label: string }
type GroupEntry = { group: MetadataScoreGroup; label: string; fields: FieldEntry[] }

const groups = computed<GroupEntry[]>(() => {
  const map = new Map<MetadataScoreGroup, FieldEntry[]>()
  for (const [field, meta] of Object.entries(METADATA_SCORE_FIELDS) as [MetadataScoreField, (typeof METADATA_SCORE_FIELDS)[MetadataScoreField]][]) {
    const list = map.get(meta.group) ?? []
    list.push({ field, label: meta.label })
    map.set(meta.group, list)
  }
  return groupOrder.filter((g) => map.has(g)).map((g) => ({ group: g, label: METADATA_SCORE_GROUP_LABELS[g], fields: map.get(g)! }))
})

function groupTotal(entry: GroupEntry): number {
  return entry.fields.reduce((s, f) => s + (weights[f.field] ?? 0), 0)
}

async function saveWeights() {
  if (saving.value) return
  saving.value = true
  try {
    const res = await api('/api/v1/metadata-score/weights', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(weights),
    })
    if (res.ok) {
      resetFetchCache()
      toast.success('Score weights saved. Recalculating library scores...')
    } else {
      toast.error('Failed to save score weights')
    }
  } catch {
    toast.error('Failed to save score weights')
  } finally {
    saving.value = false
  }
}

async function recalculateAll() {
  if (recalculating.value) return
  recalculating.value = true
  try {
    const res = await api('/api/v1/metadata-score/recalculate', { method: 'POST' })
    if (res.ok) {
      toast.success('Score recalculation started in the background')
    } else {
      toast.error('Recalculation failed')
    }
  } catch {
    toast.error('Recalculation failed')
  } finally {
    recalculating.value = false
  }
}

function handleResetClick() {
  if (!resetConfirming.value) {
    resetConfirming.value = true
    resetConfirmTimer = setTimeout(() => {
      resetConfirming.value = false
    }, 3000)
    return
  }
  if (resetConfirmTimer) clearTimeout(resetConfirmTimer)
  resetConfirmTimer = null
  resetConfirming.value = false
  Object.assign(weights, DEFAULT_METADATA_SCORE_WEIGHTS)
  toast.success('Weights reset to defaults. Save to apply.')
}
</script>

<template>
  <div class="mb-4">
    <div class="md:flex md:items-start md:justify-between md:gap-4">
      <div>
        <p class="settings-group-label !mb-0">Score Weights</p>
        <p class="settings-hint mt-0.5">
          Assign a weight to each field. Total weight:
          <span class="font-medium text-foreground">{{ totalWeight }}</span
          >.
        </p>
      </div>
      <div class="hidden md:flex items-center gap-2 shrink-0">
        <button
          type="button"
          class="settings-btn-outline"
          :class="resetConfirming ? '!border-destructive !text-destructive hover:!bg-destructive/10' : ''"
          @click="handleResetClick"
        >
          <RotateCcw class="size-3.5" />
          {{ resetConfirming ? 'Are you sure?' : 'Reset to defaults' }}
        </button>
        <button type="button" class="settings-btn-outline" :disabled="recalculating" @click="recalculateAll">
          <RefreshCw class="size-3.5" :class="{ 'animate-spin': recalculating }" />
          Recalculate all
        </button>
        <button type="button" class="settings-btn-primary" :disabled="saving" @click="saveWeights">
          <Save class="size-3.5" />
          Save
        </button>
      </div>
    </div>
  </div>
  <div
    class="md:hidden sticky top-[5.25rem] z-10 -mx-4 mb-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
  >
    <div class="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        class="settings-btn-outline"
        :class="resetConfirming ? '!border-destructive !text-destructive hover:!bg-destructive/10' : ''"
        @click="handleResetClick"
      >
        <RotateCcw class="size-3.5" />
        {{ resetConfirming ? 'Confirm reset' : 'Reset' }}
      </button>
      <button type="button" class="settings-btn-outline" :disabled="recalculating" @click="recalculateAll">
        <RefreshCw class="size-3.5" :class="{ 'animate-spin': recalculating }" />
        Recalculate
      </button>
      <button type="button" class="settings-btn-primary flex-1 justify-center" :disabled="saving" @click="saveWeights">
        <Save class="size-3.5" />
        Save
      </button>
    </div>
  </div>

  <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
    <div v-for="group in groups" :key="group.group" class="px-5 py-4 bg-card">
      <div class="flex items-center justify-between mb-3">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{{ group.label }}</p>
        <span class="text-xs text-muted-foreground">subtotal: {{ groupTotal(group) }}</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
        <div v-for="entry in group.fields" :key="entry.field" class="flex items-start md:items-center gap-2">
          <input
            :id="`weight-${entry.field}`"
            v-model.number="weights[entry.field]"
            type="number"
            min="0"
            class="w-14 h-7 px-2 text-xs text-center rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring shrink-0"
          />
          <label :for="`weight-${entry.field}`" class="text-[13px] leading-snug md:truncate">
            {{ entry.label }}
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
