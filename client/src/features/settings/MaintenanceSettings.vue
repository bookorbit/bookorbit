<script setup lang="ts">
import { ref } from 'vue'
import { Check, RefreshCw, Sparkles } from 'lucide-vue-next'

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
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed'
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl mx-auto">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Maintenance</h2>
      <p class="mt-1 text-sm text-muted-foreground">System maintenance and data operations.</p>
    </div>

    <div>
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recommendations</p>
      <div class="border border-border rounded-lg bg-card px-5 py-5">
        <div class="flex items-start justify-between gap-6">
          <div class="flex items-start gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles :size="16" class="text-primary" />
            </div>
            <div>
              <p class="text-sm font-medium text-foreground">Rebuild recommendation embeddings</p>
              <p class="text-xs text-muted-foreground mt-1 leading-relaxed max-w-sm">
                Generates vector embeddings for all books. Run this after a large import or if recommendations seem off. Processes in the background.
              </p>
              <p v-if="queued !== null" class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mt-2">
                <Check :size="12" />
                {{ queued }} books queued for processing
              </p>
              <p v-if="error" class="text-xs text-destructive mt-2">{{ error }}</p>
            </div>
          </div>
          <button
            class="flex shrink-0 items-center gap-2 h-8 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            :disabled="running"
            @click="rebuildEmbeddings"
          >
            <RefreshCw :size="13" :class="running ? 'animate-spin' : ''" />
            {{ running ? 'Running...' : 'Run' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
