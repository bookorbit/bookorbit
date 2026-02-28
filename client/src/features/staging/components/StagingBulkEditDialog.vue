<script setup lang="ts">
import { reactive, ref } from 'vue'
import { X, Loader2 } from 'lucide-vue-next'
import type { StagingBulkEditResult, StagingMetadata } from '@projectx/types'
import { api } from '@/lib/api'

const props = defineProps<{
  selectionPayload: { fileIds?: number[]; selectAll?: boolean; excludedIds?: number[] }
  selectionCount: number
}>()

const emit = defineEmits<{
  close: []
  edited: []
}>()

const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<StagingBulkEditResult | null>(null)

const FIELDS: { key: keyof StagingMetadata; label: string; type: 'text' | 'number' | 'array' }[] = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'authors', label: 'Authors', type: 'array' },
  { key: 'publisher', label: 'Publisher', type: 'text' },
  { key: 'publishedYear', label: 'Year', type: 'number' },
  { key: 'language', label: 'Language', type: 'text' },
  { key: 'isbn13', label: 'ISBN-13', type: 'text' },
  { key: 'isbn10', label: 'ISBN-10', type: 'text' },
  { key: 'seriesName', label: 'Series', type: 'text' },
  { key: 'seriesIndex', label: 'Series #', type: 'number' },
  { key: 'genres', label: 'Genres', type: 'array' },
]

const enabledFields = reactive<Set<string>>(new Set())
const values = reactive<Record<string, string>>({})
const mergeArrays = ref(true)

function toggleField(key: string) {
  if (enabledFields.has(key)) enabledFields.delete(key)
  else enabledFields.add(key)
}

async function submit() {
  if (enabledFields.size === 0) return
  loading.value = true
  error.value = null

  const fields: Partial<StagingMetadata> = {}
  for (const f of FIELDS) {
    if (!enabledFields.has(f.key)) continue
    const raw = values[f.key] ?? ''
    if (f.type === 'array') {
      (fields as Record<string, unknown>)[f.key] = raw.split(',').map((s) => s.trim()).filter(Boolean)
    } else if (f.type === 'number') {
      const n = parseFloat(raw)
      if (!isNaN(n)) (fields as Record<string, unknown>)[f.key] = n
    } else {
      (fields as Record<string, unknown>)[f.key] = raw || undefined
    }
  }

  try {
    const res = await api('/api/v1/staging/files/bulk-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...props.selectionPayload,
        fields,
        enabledFields: [...enabledFields],
        mergeArrays: mergeArrays.value,
      }),
    })
    if (res.ok) {
      result.value = await res.json()
    } else {
      const body = await res.json().catch(() => null)
      error.value = (body as { message?: string } | null)?.message ?? `Error ${res.status}`
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Bulk edit failed'
  } finally {
    loading.value = false
  }
}

function handleClose() {
  if (result.value) emit('edited')
  else emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 class="text-base font-semibold text-foreground">
            {{ result ? 'Bulk Edit Results' : `Bulk Edit ${selectionCount} file${selectionCount === 1 ? '' : 's'}` }}
          </h2>
          <button class="size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all" @click="handleClose">
            <X class="size-4" />
          </button>
        </div>

        <div v-if="!result" class="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <p class="text-xs text-muted-foreground">Toggle the fields you want to update. Only enabled fields will be applied.</p>

          <div class="space-y-2">
            <div v-for="f in FIELDS" :key="f.key" class="flex items-center gap-2">
              <input type="checkbox" :checked="enabledFields.has(f.key)" class="size-3.5 rounded border-input accent-primary shrink-0" @change="toggleField(f.key)" />
              <label class="flex-1">
                <span class="text-xs font-medium text-muted-foreground block mb-0.5">{{ f.label }}</span>
                <input v-model="values[f.key]" :disabled="!enabledFields.has(f.key)" :placeholder="f.type === 'array' ? 'comma-separated' : ''" class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-40" />
              </label>
            </div>
          </div>

          <label class="flex items-center gap-2 text-xs text-muted-foreground">
            <input v-model="mergeArrays" type="checkbox" class="size-3.5 rounded border-input accent-primary" />
            Merge arrays (add to existing values instead of replacing)
          </label>

          <p v-if="error" class="text-xs text-red-500 bg-red-500/10 rounded-lg p-2">{{ error }}</p>

          <div class="flex items-center justify-end gap-2 pt-2">
            <button class="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-all" @click="handleClose">
              Cancel
            </button>
            <button class="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95 disabled:opacity-50" :disabled="enabledFields.size === 0 || loading" @click="submit">
              <Loader2 v-if="loading" class="size-3.5 animate-spin" />
              Apply
            </button>
          </div>
        </div>

        <div v-else class="px-5 py-4 space-y-4">
          <div class="rounded-lg bg-emerald-500/10 p-3">
            <p class="text-sm font-medium">Updated {{ result.updated }} of {{ result.total }} files</p>
            <p v-if="result.failed > 0" class="text-xs text-muted-foreground mt-0.5">{{ result.failed }} failed</p>
          </div>
          <div class="flex justify-end">
            <button class="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95" @click="handleClose">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

