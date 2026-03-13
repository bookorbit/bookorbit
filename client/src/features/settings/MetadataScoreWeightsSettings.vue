<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { RefreshCw, Save } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { MetadataScoreWeights, MetadataScoreField } from '@projectx/types'
import { DEFAULT_METADATA_SCORE_WEIGHTS, METADATA_SCORE_FIELDS, METADATA_SCORE_GROUP_LABELS, type MetadataScoreGroup } from '@projectx/types'
import { api } from '@/lib/api'
import { useMetadataScoreWeights } from '@/features/metadata-score/composables/useMetadataScoreWeights'

const { resetFetchCache } = useMetadataScoreWeights()

const weights = reactive<MetadataScoreWeights>({ ...DEFAULT_METADATA_SCORE_WEIGHTS })
const saving = ref(false)
const recalculating = ref(false)

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
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="text-sm font-semibold">Metadata Score Weights</h2>
        <p class="text-xs text-muted-foreground mt-0.5">
          Assign a weight to each field. Fields with weight 0 are excluded from the score. Total max weight:
          <span class="font-medium text-foreground">{{ totalWeight }}</span
          >.
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          class="flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-50"
          :disabled="recalculating"
          @click="recalculateAll"
        >
          <RefreshCw class="size-3.5" :class="{ 'animate-spin': recalculating }" />
          Recalculate All
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="saving"
          @click="saveWeights"
        >
          <Save class="size-3.5" />
          Save
        </button>
      </div>
    </div>

    <div class="space-y-6">
      <div v-for="group in groups" :key="group.group">
        <div class="flex items-baseline justify-between mb-3">
          <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{{ group.label }}</h3>
          <span class="text-xs text-muted-foreground">subtotal: {{ groupTotal(group) }}</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div v-for="entry in group.fields" :key="entry.field" class="flex items-center gap-2">
            <label :for="`weight-${entry.field}`" class="text-sm text-foreground flex-1 min-w-0 truncate">
              {{ entry.label }}
            </label>
            <input
              :id="`weight-${entry.field}`"
              v-model.number="weights[entry.field]"
              type="number"
              min="0"
              class="w-16 h-8 px-2 text-sm text-right rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
