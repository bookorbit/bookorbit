<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Check, RefreshCw, Sparkles } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { api } from '@/lib/api'

const running = ref(false)
const queued = ref<number | null>(null)
const error = ref<string | null>(null)

async function rebuildEmbeddings() {
  running.value = true
  queued.value = null
  error.value = null
  try {
    const res = await api('/api/v1/books/embed-all', { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: { queued: number } = await res.json()
    queued.value = data.queued
    toast.success(`${data.queued} books queued for embedding`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed'
    toast.error(`Failed to rebuild embeddings: ${error.value ?? 'Unknown error'}`)
  } finally {
    running.value = false
  }
}

onMounted(() => {})
</script>

<template>
  <SettingsPageHeader title="Operations" subtitle="Background jobs and data operations." />

  <div>
    <p class="settings-group-label">Recommendations</p>
    <div class="border border-border rounded-lg bg-card px-5 py-5">
      <div class="flex items-start justify-between gap-6">
        <div class="flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles :size="16" class="text-primary" />
          </div>
          <div>
            <p class="settings-label">Rebuild recommendation embeddings</p>
            <p class="settings-hint leading-relaxed max-w-sm">
              Generates vector embeddings for all books. Run this after a large import or if recommendations seem off. Processes in the background.
            </p>
            <p v-if="queued !== null" class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mt-2">
              <Check :size="12" />
              {{ queued }} books queued for processing
            </p>
            <p v-if="error" class="text-xs text-destructive mt-2">{{ error }}</p>
          </div>
        </div>
        <button class="settings-btn-outline" :disabled="running" @click="rebuildEmbeddings">
          <RefreshCw :size="13" :class="running ? 'animate-spin' : ''" />
          {{ running ? 'Running...' : 'Run' }}
        </button>
      </div>
    </div>
  </div>
</template>
