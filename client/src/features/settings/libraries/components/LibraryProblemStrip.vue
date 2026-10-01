<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, RefreshCw, TriangleAlert } from '@lucide/vue'
import type { Library } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { relativeTimestamp } from '@/lib/relative-time'
import type { LibraryProblem } from '../lib/library-problems'

const props = defineProps<{ library: Library; problem: LibraryProblem }>()
const emit = defineEmits<{ scan: [library: Library] }>()

const { t } = useI18n()

const tone = computed(() => (props.problem.kind === 'failed' ? 'error' : 'warning'))
const icon = computed(() => (props.problem.kind === 'failed' ? CircleAlert : TriangleAlert))

const title = computed(() => {
  const problem = props.problem
  if (problem.kind === 'never') return t('settings.admin.libraries.problem.neverTitle')
  return t('settings.admin.libraries.problem.failedTitle', { time: relativeTimestamp(problem.scan.startedAt) })
})

const body = computed(() => {
  const problem = props.problem
  if (problem.kind === 'never') return t('settings.admin.libraries.problem.neverBody', { count: props.library.folders.length })
  return problem.scan.errorMessage ?? ''
})

function requestScan() {
  emit('scan', props.library)
}
</script>

<template>
  <div
    data-testid="library-problem"
    class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-2.5 text-[13px]"
    :class="tone === 'error' ? 'border-destructive/25 bg-destructive/7' : 'border-[var(--pill-warning)]/25 bg-[var(--pill-warning)]/7'"
  >
    <component
      :is="icon"
      :size="14"
      class="shrink-0"
      :class="tone === 'error' ? 'text-destructive' : 'text-[var(--pill-warning)]'"
      aria-hidden="true"
    />
    <p class="min-w-0 flex-1 text-foreground">
      <span class="font-semibold">{{ title }}</span>
      <span v-if="body" :class="problem.kind === 'failed' ? 'font-mono text-xs' : ''"> {{ body }}</span>
    </p>
    <Button v-if="problem.kind === 'never'" size="sm" type="button" class="h-7" @click="requestScan">
      <RefreshCw :size="13" aria-hidden="true" />
      {{ t('settings.admin.libraries.problem.scanNow') }}
    </Button>
    <Button v-else variant="outline" size="sm" type="button" class="h-7" @click="requestScan">
      <RefreshCw :size="13" aria-hidden="true" />
      {{ t('settings.admin.libraries.problem.retry') }}
    </Button>
  </div>
</template>
