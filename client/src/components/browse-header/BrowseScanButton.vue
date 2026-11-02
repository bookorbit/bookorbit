<script setup lang="ts">
import { cn } from '@/lib/utils'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, RefreshCw } from '@lucide/vue'
import type { Library } from '@bookorbit/types'
import { useLibraryScan } from '@/features/scanner/composables/useLibraryScan'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'
import { outlineButton } from './browse-header'

/**
 * Starts a scan and then shows it: the button fills with the scan's progress, which replaces the
 * progress bar that used to sit above the grid.
 */
const props = defineProps<{
  library: Pick<Library, 'id' | 'name'>
}>()

const { t } = useI18n()
const { getProgress } = useScanProgress()
const { scanLibrary } = useLibraryScan()

const starting = ref(false)
const announcement = ref('')

const progress = computed(() => getProgress(props.library.id))
const scanning = computed(() => progress.value?.status === 'running')
const percent = computed(() => {
  const event = progress.value
  if (!event || event.total <= 0) return 0
  return Math.min(100, Math.round((event.processed / event.total) * 100))
})

watch(scanning, (now, before) => {
  if (now && !before) announcement.value = t('components.browseHeader.scan.started', { name: props.library.name })
  else if (!now && before) announcement.value = t('components.browseHeader.scan.finished', { name: props.library.name })
})

async function handleScan() {
  if (scanning.value || starting.value) return
  starting.value = true
  try {
    await scanLibrary(props.library)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      :class="cn(outlineButton, 'relative overflow-hidden', scanning && 'border-primary/45')"
      :aria-busy="scanning || starting || undefined"
      :disabled="starting"
      @click="handleScan"
    >
      <span
        v-if="scanning"
        class="absolute inset-y-0 start-0 bg-primary/12 transition-[width] duration-500 motion-reduce:transition-none"
        :style="{ width: `${percent}%` }"
        aria-hidden="true"
      />
      <LoaderCircle v-if="scanning || starting" :size="14" class="relative text-primary motion-safe:animate-spin" aria-hidden="true" />
      <RefreshCw v-else :size="14" class="relative text-muted-foreground" aria-hidden="true" />
      <span class="relative">{{ scanning ? t('components.browseHeader.scan.scanning') : t('settings.admin.libraries.scan') }}</span>
      <span v-if="scanning && progress" class="relative hidden text-muted-foreground tabular-nums lg:inline">{{
        t('components.sidebar.scanProgress', { processed: progress.processed, total: progress.total })
      }}</span>
    </button>
    <span class="sr-only" role="status" aria-live="polite">{{ announcement }}</span>
  </div>
</template>
