<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw } from '@lucide/vue'
import type { RegexMetadataConfig, RegexMetadataReapplyJob } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'

const props = defineProps<{
  /** The rules the server has saved for this library. */
  stored: RegexMetadataConfig | null
  /** The rules in the form, which may not be saved yet. */
  pending: RegexMetadataConfig | null
  running: boolean
  job: RegexMetadataReapplyJob | null
  errorKey: string | null
}>()

const emit = defineEmits<{ reapply: [] }>()
const { t } = useI18n()

const confirming = ref(false)
const root = ref<HTMLElement | null>(null)
const startButton = ref<HTMLButtonElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)

const rulesKey = (config: RegexMetadataConfig | null) => JSON.stringify(config?.rules.map(({ pattern, flags }) => [pattern, flags]) ?? null)
const unsaved = computed(() => rulesKey(props.stored) !== rulesKey(props.pending))
const disabled = computed(() => props.running || !props.stored || unsaved.value)
const hint = computed(() => {
  if (unsaved.value) return t('library.creator.metadata.regex.reapply.saveFirst')
  return t('library.creator.metadata.regex.reapply.hint')
})
const progressText = computed(() => {
  const job = props.job
  if (!job) return ''
  const counters = ['processed', 'total', 'updated', 'unchanged', 'skipped', 'failed'] as const
  return t('library.creator.metadata.regex.reapply.progressSummary', Object.fromEntries(counters.map((key) => [key, formatNumber(job[key])])))
})

async function requestReapply() {
  confirming.value = true
  await nextTick()
  confirmButton.value?.focus()
}

async function cancelReapply() {
  confirming.value = false
  await nextTick()
  startButton.value?.focus()
}

async function confirmReapply() {
  if (disabled.value) return
  confirming.value = false
  emit('reapply')
  await nextTick()
  // The start button is disabled while the job runs, so focus stays on this block instead of the page.
  root.value?.focus()
}
</script>

<template>
  <div ref="root" tabindex="-1" class="mt-3 border-t border-border pt-3 outline-none">
    <div class="flex flex-wrap items-center gap-3">
      <button
        ref="startButton"
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="disabled"
        @click="requestReapply"
      >
        <RefreshCw :size="13" :class="running ? 'motion-safe:animate-spin' : ''" aria-hidden="true" />
        {{ running ? t('library.creator.metadata.regex.reapply.applying') : t('library.creator.metadata.regex.reapply.action') }}
      </button>
      <p class="min-w-0 flex-1 text-xs text-muted-foreground">{{ hint }}</p>
    </div>
    <div
      v-if="confirming"
      role="group"
      :aria-label="t('library.creator.metadata.regex.reapply.action')"
      class="mt-3 rounded-lg border border-border bg-background p-3"
    >
      <p class="text-sm text-muted-foreground">{{ t('library.creator.metadata.regex.reapply.confirm') }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          ref="confirmButton"
          type="button"
          :disabled="disabled"
          class="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          @click="confirmReapply"
        >
          {{ t('library.creator.metadata.regex.reapply.action') }}
        </button>
        <button
          type="button"
          class="h-8 rounded-md px-3 text-[13px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="cancelReapply"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
    <div v-if="job" class="mt-3 space-y-2 text-sm text-muted-foreground">
      <!-- Only the outcome is live; counters that tick every poll would be read out each second. -->
      <div role="status" class="space-y-2">
        <p>{{ t(`library.creator.metadata.regex.reapply.jobStatus.${job.status}`) }}</p>
        <p v-if="job.status !== 'running'">{{ progressText }}</p>
      </div>
      <template v-if="job.status === 'running'">
        <progress
          :value="job.total ? job.processed : undefined"
          :max="job.total || 1"
          :aria-label="t('library.creator.metadata.regex.reapply.applying')"
          class="h-2 w-full accent-primary"
        />
        <p>{{ progressText }}</p>
      </template>
      <ul v-if="job.failureSamples.length" class="space-y-1">
        <li v-for="failure in job.failureSamples" :key="failure.bookId">
          {{
            t('library.creator.metadata.regex.reapply.failureSample', {
              bookId: formatNumber(failure.bookId),
              reason: t(`library.creator.metadata.regex.reapply.failureReasons.${failure.code}`),
            })
          }}
        </li>
      </ul>
    </div>
    <p v-if="errorKey" role="alert" class="mt-3 text-sm text-destructive">{{ t(errorKey) }}</p>
  </div>
</template>
