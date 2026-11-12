<script setup lang="ts">
import { computed } from 'vue'
import { Check, ImageOff, Loader2, Minus, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { AI_TEST_STEPS, type AiConnectionTest, type AiTestStep, type AiTestStepId } from '@bookorbit/types'

import { failureText } from '../lib/ai-format'

const props = defineProps<{
  result: AiConnectionTest | null
  running: boolean
}>()

const { t } = useI18n()

interface Row {
  id: AiTestStepId
  /** `limited`: the row found something the connection cannot do, which only some features need. */
  state: 'running' | 'pass' | 'fail' | 'limited' | 'skipped'
  label: string
  detail: string | null
  providerMessage: string | null
}

function passLabel(step: AiTestStep, host: string): string {
  switch (step.id) {
    case 'reach':
      return step.durationMs !== undefined
        ? t('settings.admin.ai.test.steps.reachDone', { host, ms: step.durationMs })
        : t('settings.admin.ai.test.steps.reach')
    case 'models':
      return step.modelCount !== undefined && step.code !== 'no-model-list'
        ? t('settings.admin.ai.test.steps.modelsDone', { count: step.modelCount })
        : t('settings.admin.ai.test.steps.models')
    case 'json':
      return step.jsonSupport
        ? t('settings.admin.ai.test.steps.jsonDone', { how: t(`settings.admin.ai.test.jsonSupport.${step.jsonSupport}`) })
        : t('settings.admin.ai.test.steps.json')
    default:
      return t(`settings.admin.ai.test.steps.${step.id}`)
  }
}

const rows = computed<Row[]>(() =>
  AI_TEST_STEPS.map((id) => {
    const label = t(`settings.admin.ai.test.steps.${id}`)
    if (props.running || !props.result) return { id, state: 'running', label, detail: null, providerMessage: null }
    const step = props.result.steps.find((entry) => entry.id === id)
    if (!step || step.ok === null) return { id, state: 'skipped', label, detail: t('settings.admin.ai.test.notRun'), providerMessage: null }
    if (step.ok) {
      // A provider without a model list still passes this row: the model is typed instead.
      const detail = step.code === 'no-model-list' ? failureText(step.code) : null
      return { id, state: 'pass', label: passLabel(step, props.result.host), detail, providerMessage: null }
    }
    const detail = failureText(step.code, { retryAfterSeconds: step.retryAfterSeconds, message: step.message })
    const providerMessage = step.message && detail !== step.message ? step.message : null
    return { id, state: step.code === 'no-image-input' ? 'limited' : 'fail', label, detail, providerMessage }
  }),
)
</script>

<template>
  <ol class="flex flex-col gap-3" :aria-busy="running" data-testid="ai-test-checklist">
    <li v-for="row in rows" :key="row.id" class="flex items-start gap-3" :data-step="row.id" :data-state="row.state">
      <span
        class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
        :class="{
          'bg-success/15 text-success': row.state === 'pass',
          'bg-destructive/15 text-destructive': row.state === 'fail',
          'bg-warning/15 text-warning': row.state === 'limited',
          'bg-muted text-muted-foreground': row.state === 'skipped' || row.state === 'running',
        }"
        aria-hidden="true"
      >
        <Loader2 v-if="row.state === 'running'" class="size-3 animate-spin" />
        <Check v-else-if="row.state === 'pass'" class="size-3" />
        <X v-else-if="row.state === 'fail'" class="size-3" />
        <ImageOff v-else-if="row.state === 'limited'" class="size-3" />
        <Minus v-else class="size-3" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm" :class="row.state === 'skipped' ? 'text-muted-foreground' : 'text-foreground'">{{ row.label }}</p>
        <p v-if="row.detail" class="mt-0.5 text-xs" :class="row.state === 'fail' ? 'text-destructive' : 'text-muted-foreground'">
          {{ row.detail }}
        </p>
        <p v-if="row.providerMessage" class="mt-1 break-words font-mono text-xs text-muted-foreground">
          {{ t('settings.admin.ai.connections.providerSaid', { message: row.providerMessage }) }}
        </p>
      </div>
    </li>
  </ol>
</template>
