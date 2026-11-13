<script setup lang="ts">
import { computed } from 'vue'
import { CircleAlert, Loader2, Pencil, Trash2, Zap } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { AiConnection } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { relativeTimestamp } from '@/lib/relative-time'
import { apiTypeLabel, connectionHost, failureText, formatAiCost, maskedHint } from '../lib/ai-format'
import { aiColumns, aiTable, type AiStatusTone } from '../lib/ai-settings-ui'
import AiStatusText from './AiStatusText.vue'

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

const status = computed<{ tone: AiStatusTone; label: string }>(() => {
  const connection = props.connection
  if (connection.status === 'failing') {
    return {
      tone: 'error',
      label: t('settings.admin.ai.connections.statusFailing', { time: relativeTimestamp(connection.failingSince ?? connection.updatedAt) }),
    }
  }
  if (connection.status === 'working' && connection.lastTest) {
    return { tone: 'ok', label: t('settings.admin.ai.connections.statusWorking', { time: relativeTimestamp(connection.lastTest.at) }) }
  }
  return { tone: 'idle', label: t('settings.admin.ai.connections.statusUntested') }
})

/** Plain words first; the provider's own text only when it adds something. */
const failure = computed(() => {
  const connection = props.connection
  if (connection.status !== 'failing') return null
  const words = failureText(connection.failingCode, { message: connection.failingReason })
  return { words, providerMessage: connection.failingReason && connection.failingReason !== words ? connection.failingReason : null }
})

function handleTest() {
  emit('test')
}

function handleEdit() {
  emit('edit')
}

function handleDelete() {
  emit('delete')
}
</script>

<template>
  <li :id="`ai-connection-${connection.id}`" class="scroll-mt-24" :data-connection-id="connection.id">
    <div :class="[aiTable.row, aiColumns.providers]">
      <div :class="aiTable.main">
        <p :class="aiTable.name">{{ connection.name }}</p>
        <p :class="aiTable.sub">{{ apiTypeLabel(connection.apiType) }}</p>
      </div>
      <div :class="[aiTable.meta, aiTable.hideOnPhone]">
        <p :class="[aiTable.mono, 'truncate text-foreground']">{{ connectionHost(connection.baseUrl) }}</p>
        <p class="mt-px font-mono text-[12.5px] leading-4 text-muted-foreground" data-testid="ai-connection-key">{{ keyLabel }}</p>
      </div>
      <div :class="aiTable.meta">
        <AiStatusText :tone="status.tone" :label="status.label" />
      </div>
      <div :class="[aiTable.meta, aiTable.num]" data-testid="ai-connection-month">
        <p>{{ t('settings.admin.ai.providers.requests', { count: connection.month.requests }) }}</p>
        <p :class="aiTable.sub">{{ formatAiCost(connection.month.costMicros) }}</p>
      </div>
      <div :class="aiTable.actions">
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="testing || !connection.usable"
          :aria-label="t('settings.admin.ai.providers.testNamed', { name: connection.name })"
          :title="t('settings.admin.ai.providers.testNamed', { name: connection.name })"
          @click="handleTest"
        >
          <Loader2 v-if="testing" class="size-4 animate-spin" />
          <Zap v-else class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('settings.admin.ai.providers.editNamed', { name: connection.name })"
          :title="t('settings.admin.ai.providers.editNamed', { name: connection.name })"
          @click="handleEdit"
        >
          <Pencil class="size-4" />
        </Button>
        <Button
          variant="destructive-ghost"
          size="icon-sm"
          :aria-label="t('settings.admin.ai.connections.deleteNamed', { name: connection.name })"
          :title="t('settings.admin.ai.connections.deleteNamed', { name: connection.name })"
          @click="handleDelete"
        >
          <Trash2 class="size-4" />
        </Button>
      </div>
      <p v-if="failure" :class="[aiTable.note, 'text-destructive']" data-testid="ai-connection-failure">
        <CircleAlert :class="aiTable.noteIcon" aria-hidden="true" />
        <span class="min-w-0">
          {{ failure.words }}
          <span v-if="failure.providerMessage" class="font-mono break-words text-muted-foreground">{{ failure.providerMessage }}</span>
        </span>
      </p>
      <p v-if="!connection.usable" :class="[aiTable.note, 'text-destructive']">
        <CircleAlert :class="aiTable.noteIcon" aria-hidden="true" />
        <span class="min-w-0">{{ t('settings.admin.ai.connections.unusable') }}</span>
      </p>
    </div>
  </li>
</template>
