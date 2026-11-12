<script setup lang="ts">
import { reactive } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  AI_SLOTS,
  type AiConnection,
  type AiModelList,
  type AiSettings,
  type AiSlot,
  type AiTryResult,
  type UpdateAiSlotRequest,
} from '@bookorbit/types'

import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import { errorMessage } from '@/lib/api-json'
import * as aiApi from '../api/ai.api'
import type { AiLoadState } from '../composables/useAiAdmin'
import { slotLabel, tryFailureText } from '../lib/ai-format'
import AiSlotRow from './AiSlotRow.vue'

defineProps<{
  settings: AiSettings | null
  state: AiLoadState
  connections: AiConnection[]
  modelLists: Record<number, AiModelList | 'loading' | 'error'>
}>()

const emit = defineEmits<{
  retry: []
  updated: [settings: AiSettings]
  tried: []
  needModels: [connectionId: number, force: boolean]
  addAnthropic: [connection: AiConnection]
}>()

const { t } = useI18n()

interface SlotRun {
  saving: boolean
  trying: boolean
  result: AiTryResult | null
  error: { text: string; providerMessage: string | null } | null
}

const runs = reactive<Record<AiSlot, SlotRun>>({
  fast: { saving: false, trying: false, result: null, error: null },
  careful: { saving: false, trying: false, result: null, error: null },
  vision: { saving: false, trying: false, result: null, error: null },
})

async function handleSave(slot: AiSlot, request: UpdateAiSlotRequest) {
  const run = runs[slot]
  run.saving = true
  try {
    const next = await aiApi.updateSlots({ [slot]: request })
    // A new model makes the last Try it answer about a different model.
    run.result = null
    run.error = null
    emit('updated', next)
    toast.success(t('settings.admin.ai.models.saved', { slot: slotLabel(slot) }))
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.admin.ai.models.saveFailed'))
  } finally {
    run.saving = false
  }
}

async function handleTry(slot: AiSlot) {
  const run = runs[slot]
  run.trying = true
  run.error = null
  run.result = null
  try {
    run.result = await aiApi.tryModel(slot)
  } catch (reason) {
    run.error = tryFailureText(reason)
  } finally {
    run.trying = false
    emit('tried')
  }
}
</script>

<template>
  <section aria-labelledby="ai-models-title" class="flex flex-col gap-3" data-testid="ai-models">
    <div>
      <h3 id="ai-models-title" class="settings-group-label mb-0">{{ t('settings.admin.ai.models.title') }}</h3>
      <p class="settings-hint">{{ t('settings.admin.ai.models.brief') }}</p>
    </div>

    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error' || !settings" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.models.loadFailed')" @retry="emit('retry')" />
    </div>

    <template v-else>
      <p v-if="connections.length === 0" class="settings-empty-state text-xs" data-testid="ai-models-no-connections">
        {{ t('settings.admin.ai.models.noConnections') }}
      </p>
      <div class="settings-card">
        <AiSlotRow
          v-for="slot in AI_SLOTS"
          :key="slot"
          :slot-id="slot"
          :value="settings.slots[slot]"
          :health="settings.slotHealth[slot]"
          :connections="connections"
          :model-lists="modelLists"
          :saving="runs[slot].saving"
          :trying="runs[slot].trying"
          :try-result="runs[slot].result"
          :try-error="runs[slot].error"
          @need-models="(id, force) => emit('needModels', id, force)"
          @save="(request) => handleSave(slot, request)"
          @try="handleTry(slot)"
          @add-anthropic="(connection) => emit('addAnthropic', connection)"
        />
      </div>
      <p class="settings-hint mt-0" data-testid="ai-models-measured">{{ t('settings.admin.ai.models.measured') }}</p>
    </template>
  </section>
</template>
