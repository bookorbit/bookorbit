<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw, X } from '@lucide/vue'
import type { Library, LibraryScanHistoryEntry } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import LibraryScanHistory from './LibraryScanHistory.vue'

const HISTORY_LIMIT = 10

const props = defineProps<{ library: Library; open: boolean; scanning: boolean }>()
const emit = defineEmits<{ close: []; scan: [library: Library] }>()

const { t } = useI18n()

const entries = ref<LibraryScanHistoryEntry[] | null>(null)
const failed = ref(false)

/** Loads each time it opens: a scan may have finished since, and the list is ten rows. */
async function load() {
  entries.value = null
  failed.value = false
  try {
    const res = await api(`/api/v1/scanner/libraries/${props.library.id}/scan-history?limit=${HISTORY_LIMIT}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: unknown = await res.json()
    entries.value = Array.isArray(data) ? (data as LibraryScanHistoryEntry[]) : []
  } catch {
    failed.value = true
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void load()
  },
  { immediate: true },
)

function requestClose() {
  emit('close')
}

function requestScan() {
  emit('scan', props.library)
}
</script>

<template>
  <div class="w-[36rem] max-w-[calc(100vw-2rem)]" role="group" :aria-label="t('settings.admin.libraries.historyFor', { name: library.name })">
    <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
      <p class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {{ t('settings.admin.libraries.historyFor', { name: library.name }) }}
      </p>
      <Button variant="ghost" size="icon-sm" type="button" :aria-label="t('common.close')" @click="requestClose">
        <X :size="15" aria-hidden="true" />
      </Button>
    </div>
    <div class="max-h-80 overflow-y-auto px-4 py-3">
      <div v-if="entries === null && !failed" class="space-y-1.5" aria-hidden="true">
        <Skeleton v-for="index in 4" :key="index" class="h-6 w-full" />
      </div>
      <p v-else-if="failed" role="alert" class="text-[12.5px] text-destructive">{{ t('settings.admin.libraries.detail.historyFailed') }}</p>
      <p v-else-if="entries && entries.length === 0" class="text-[12.5px] text-muted-foreground">
        {{ t('settings.admin.libraries.detail.historyEmpty') }}
      </p>
      <LibraryScanHistory v-else-if="entries" :entries="entries" />
    </div>
    <div class="flex justify-end border-t border-border px-4 py-2.5">
      <Button variant="outline" size="sm" type="button" :disabled="scanning" @click="requestScan">
        <RefreshCw :size="14" :class="scanning ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true" />
        {{ t('settings.admin.libraries.problem.scanNow') }}
      </Button>
    </div>
  </div>
</template>
