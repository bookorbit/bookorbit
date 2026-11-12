<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, Pencil, Trash2, Zap } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { AiConnection } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { relativeTimestamp } from '@/lib/relative-time'
import { apiTypeLabel, connectionHost, failureText, formatAiCost, maskedHint } from '../lib/ai-format'

const props = defineProps<{
  connection: AiConnection
  testing: boolean
}>()

const emit = defineEmits<{
  test: []
  edit: []
  delete: []
}>()

const { t } = useI18n()

const keyLabel = computed(() => {
  if (!props.connection.hasKey) return t('settings.admin.ai.connections.noKey')
  return props.connection.keyHint ? maskedHint(props.connection.keyHint) : t('settings.admin.ai.connections.keySaved')
})

const status = computed(() => {
  const connection = props.connection
  if (connection.status === 'failing') {
    return {
      tone: 'error' as const,
      label: t('settings.admin.ai.connections.statusFailing', { time: relativeTimestamp(connection.failingSince ?? connection.updatedAt) }),
    }
  }
  if (connection.status === 'working' && connection.lastTest) {
    return { tone: 'ok' as const, label: t('settings.admin.ai.connections.statusWorking', { time: relativeTimestamp(connection.lastTest.at) }) }
  }
  return { tone: 'idle' as const, label: t('settings.admin.ai.connections.statusUntested') }
})

/** Plain words first; the provider's own text only when it adds something. */
const failure = computed(() => {
  const connection = props.connection
  if (connection.status !== 'failing') return null
  const words = failureText(connection.failingCode, { message: connection.failingReason })
  return { words, providerMessage: connection.failingReason && connection.failingReason !== words ? connection.failingReason : null }
})

const monthLabel = computed(() =>
  t('settings.admin.ai.connections.month', { count: props.connection.month.requests, cost: formatAiCost(props.connection.month.costMicros) }),
)
</script>

<template>
  <article :id="`ai-connection-${connection.id}`" class="rounded-lg border border-border bg-card shadow-xs" :data-connection-id="connection.id">
    <div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h4 class="truncate font-semibold text-foreground">{{ connection.name }}</h4>
          <span class="text-xs text-muted-foreground">{{ apiTypeLabel(connection.apiType) }}</span>
        </div>
        <p class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span class="font-mono">{{ connectionHost(connection.baseUrl) }}</span>
          <span class="font-mono" data-testid="ai-connection-key">{{ keyLabel }}</span>
        </p>
        <p class="mt-2 flex items-center gap-2 text-xs" role="status">
          <span
            class="size-2 shrink-0 rounded-full"
            :class="{
              'bg-success': status.tone === 'ok',
              'bg-destructive': status.tone === 'error',
              'bg-muted-foreground/50': status.tone === 'idle',
            }"
            aria-hidden="true"
          />
          <span :class="status.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'">{{ status.label }}</span>
          <span class="text-muted-foreground" aria-hidden="true">·</span>
          <span class="text-muted-foreground">{{ monthLabel }}</span>
        </p>
        <div v-if="failure" class="mt-2 text-xs" data-testid="ai-connection-failure">
          <p class="text-destructive">{{ failure.words }}</p>
          <p v-if="failure.providerMessage" class="mt-1 break-words font-mono text-muted-foreground">
            {{ t('settings.admin.ai.connections.providerSaid', { message: failure.providerMessage }) }}
          </p>
        </div>
        <p v-if="!connection.usable" class="mt-2 text-xs text-destructive">{{ t('settings.admin.ai.connections.unusable') }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" :disabled="testing || !connection.usable" @click="emit('test')">
          <Loader2 v-if="testing" class="size-3.5 animate-spin" />
          <Zap v-else class="size-3.5" />
          {{ t('settings.admin.ai.connections.test') }}
        </Button>
        <Button variant="outline" size="sm" @click="emit('edit')">
          <Pencil class="size-3.5" />
          {{ t('settings.admin.ai.connections.edit') }}
        </Button>
        <Button
          variant="destructive-ghost"
          size="icon-sm"
          :aria-label="t('settings.admin.ai.connections.deleteNamed', { name: connection.name })"
          @click="emit('delete')"
        >
          <Trash2 class="size-4" />
        </Button>
      </div>
    </div>
  </article>
</template>
