<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { X, RefreshCw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AuthorEnrichmentFailedPage } from '@projectx/types'
import { api } from '@/lib/api'
import { useAuthorEnrichmentActions } from '@/features/settings/composables/useAuthorEnrichmentActions'

const emit = defineEmits<{ close: [] }>()

const { retryFailed } = useAuthorEnrichmentActions()

const page = ref(1)
const limit = 50
const data = ref<AuthorEnrichmentFailedPage | null>(null)
const loading = ref(false)
const retrying = ref(false)

async function loadPage(p: number) {
  loading.value = true
  try {
    const res = await api(`/api/v1/authors/enrichment/failed?page=${p}&limit=${limit}`)
    if (res.ok) {
      data.value = await res.json()
      page.value = p
    }
  } finally {
    loading.value = false
  }
}

async function handleRetryAll() {
  retrying.value = true
  try {
    await retryFailed()
    toast.success('Failed items requeued')
    emit('close')
  } catch {
    toast.error('Failed to retry')
  } finally {
    retrying.value = false
  }
}

onMounted(() => loadPage(1))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('close')">
    <div class="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h2 class="text-sm font-semibold">Failed Author Enrichments</h2>
        <button class="text-muted-foreground hover:text-foreground" @click="emit('close')">
          <X :size="16" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="p-6 text-center text-sm text-muted-foreground">Loading...</div>

        <div v-else-if="!data || data.items.length === 0" class="p-6 text-center text-sm text-muted-foreground">No failed items.</div>

        <table v-else class="w-full text-xs">
          <thead class="sticky top-0 bg-background border-b border-border">
            <tr>
              <th class="text-left px-4 py-2 text-muted-foreground font-medium">Author</th>
              <th class="text-left px-4 py-2 text-muted-foreground font-medium">Error</th>
              <th class="text-right px-4 py-2 text-muted-foreground font-medium">HTTP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in data.items" :key="item.authorId" class="border-b border-border/50 hover:bg-muted/40">
              <td class="px-4 py-2 max-w-[200px] truncate">{{ item.name ?? `Author #${item.authorId}` }}</td>
              <td class="px-4 py-2 text-muted-foreground max-w-[320px] truncate" :title="item.error ?? ''">{{ item.error ?? '-' }}</td>
              <td class="px-4 py-2 text-right text-muted-foreground">{{ item.httpStatus ?? '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="data && data.total > 0" class="flex items-center justify-between px-4 py-3 border-t border-border shrink-0">
        <div class="flex items-center gap-2">
          <button
            :disabled="page <= 1"
            class="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-40"
            @click="loadPage(page - 1)"
          >
            Prev
          </button>
          <span class="text-xs text-muted-foreground">{{ page }} / {{ Math.ceil(data.total / limit) }}</span>
          <button
            :disabled="page >= Math.ceil(data.total / limit)"
            class="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-40"
            @click="loadPage(page + 1)"
          >
            Next
          </button>
        </div>
        <button
          :disabled="retrying"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          @click="handleRetryAll"
        >
          <RefreshCw :size="12" :class="retrying ? 'animate-spin' : ''" />
          Retry all failed
        </button>
      </div>
    </div>
  </div>
</template>
