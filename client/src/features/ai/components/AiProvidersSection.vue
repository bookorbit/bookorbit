<script setup lang="ts">
import { Loader2, Plus } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { AI_PRESETS, type AiConnection, type AiPresetId } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import type { AiLoadState } from '../composables/useAiAdmin'
import { aiColumns, aiTable } from '../lib/ai-settings-ui'
import AiProviderRow from './AiProviderRow.vue'
import AiSectionHeader from './AiSectionHeader.vue'

defineProps<{
  connections: AiConnection[]
  state: AiLoadState
  testingId: number | null
}>()

const emit = defineEmits<{
  retry: []
  /** A preset to start from, or null for the dialog's own list. */
  add: [preset: AiPresetId | null]
  test: [connection: AiConnection]
  edit: [connection: AiConnection]
  delete: [connection: AiConnection]
}>()

const { t } = useI18n()

/** The presets most servers start from; Other opens the full list, which also has CLIProxyAPI, vLLM and Azure. */
const QUICK_PRESETS: Array<{ id: AiPresetId; swatch: string }> = [
  { id: 'anthropic', swatch: 'bg-[var(--pill-source-orange)]' },
  { id: 'openai', swatch: 'bg-[var(--pill-source-green)]' },
  { id: 'gemini', swatch: 'bg-[var(--pill-source-blue)]' },
  { id: 'openrouter', swatch: 'bg-[var(--pill-source-indigo)]' },
  { id: 'ollama', swatch: 'bg-muted-foreground' },
  { id: 'lmstudio', swatch: 'bg-[var(--pill-source-purple)]' },
]

function handleRetry() {
  emit('retry')
}

function handleAdd() {
  emit('add', null)
}

function handlePreset(id: AiPresetId) {
  emit('add', id)
}

function handleTest(connection: AiConnection) {
  emit('test', connection)
}

function handleEdit(connection: AiConnection) {
  emit('edit', connection)
}

function handleDelete(connection: AiConnection) {
  emit('delete', connection)
}
</script>

<template>
  <section aria-labelledby="ai-providers-title" class="flex min-w-0 flex-col gap-2.5" data-testid="ai-connections">
    <AiSectionHeader
      title-id="ai-providers-title"
      :title="t('settings.admin.ai.providers.title')"
      :count="state === 'ready' && connections.length > 0 ? connections.length : null"
    >
      <Button v-if="state === 'ready' && connections.length > 0" size="sm" @click="handleAdd">
        <Plus class="size-3.5" />
        {{ t('settings.admin.ai.connections.add') }}
      </Button>
    </AiSectionHeader>

    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error'" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.connections.loadFailed')" @retry="handleRetry" />
    </div>

    <div v-else-if="connections.length === 0" :class="[aiTable.card, 'px-5 py-7 text-center']" data-testid="ai-connections-empty">
      <p class="text-sm font-semibold text-foreground">{{ t('settings.admin.ai.connections.emptyTitle') }}</p>
      <p class="mx-auto mt-1 max-w-[56ch] text-xs leading-4 text-muted-foreground">{{ t('settings.admin.ai.providers.emptyBrief') }}</p>
      <ul class="mt-3.5 flex flex-wrap justify-center gap-2" :aria-label="t('settings.admin.ai.providers.presetsLabel')">
        <li v-for="preset in QUICK_PRESETS" :key="preset.id">
          <button
            type="button"
            class="inline-flex h-[34px] items-center gap-2 rounded-md border border-input bg-input/30 px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-input/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            :data-preset="preset.id"
            @click="handlePreset(preset.id)"
          >
            <span class="size-4 shrink-0 rounded-sm" :class="preset.swatch" aria-hidden="true" />
            {{ AI_PRESETS[preset.id].name }}
          </button>
        </li>
        <li>
          <button
            type="button"
            class="inline-flex h-[34px] items-center gap-2 rounded-md border border-input bg-input/30 px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-input/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            data-preset="other"
            @click="handleAdd"
          >
            <span class="size-4 shrink-0 rounded-sm border border-dashed border-muted-foreground" aria-hidden="true" />
            {{ t('settings.admin.ai.presets.other') }}
          </button>
        </li>
      </ul>
    </div>

    <div v-else :class="aiTable.card">
      <div :class="[aiTable.head, aiColumns.providers]" aria-hidden="true">
        <span>{{ t('settings.admin.ai.providers.columns.provider') }}</span>
        <span>{{ t('settings.admin.ai.providers.columns.address') }}</span>
        <span>{{ t('settings.admin.ai.providers.columns.status') }}</span>
        <span class="text-end">{{ t('settings.admin.ai.providers.columns.month') }}</span>
        <span />
      </div>
      <ul :class="aiTable.list" aria-labelledby="ai-providers-title">
        <AiProviderRow
          v-for="connection in connections"
          :key="connection.id"
          :connection="connection"
          :testing="testingId === connection.id"
          @test="handleTest(connection)"
          @edit="handleEdit(connection)"
          @delete="handleDelete(connection)"
        />
      </ul>
    </div>
  </section>
</template>
