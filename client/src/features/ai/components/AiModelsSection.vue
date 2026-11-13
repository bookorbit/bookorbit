<script setup lang="ts">
import { reactive } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  AI_FEATURE_DEFINITIONS,
  AI_SLOTS,
  type AiConnection,
  type AiFeatureDefinition,
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
import { aiColumns, aiTable } from '../lib/ai-settings-ui'
import AiSectionHeader from './AiSectionHeader.vue'
import AiSlotRow from './AiSlotRow.vue'

defineProps<{
  settings: AiSettings | null
  state: AiLoadState
  connections: AiConnection[]
  modelLists: Record<number, AiModelList | 'loading' | 'error'>
  /** Which slot editors are open, as `slot:<id>` keys the page shares with its other tables. */
  openKeys: ReadonlySet<string>
}>()

const emit = defineEmits<{
  retry: []
  updated: [settings: AiSettings]
  tried: []
  needModels: [connectionId: number, force: boolean]
  addAnthropic: [connection: AiConnection]
  setOpen: [key: string, open: boolean]
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

const DEFINITIONS: AiFeatureDefinition[] = Object.values(AI_FEATURE_DEFINITIONS)

/** Which features send to each slot, from the definitions, so a slot's row says who it serves. */
const USED_BY: Record<AiSlot, Array<{ id: string; optional: boolean }>> = {
  fast: usersOf('fast'),
  careful: usersOf('careful'),
  vision: usersOf('vision'),
}

function usersOf(slot: AiSlot): Array<{ id: string; optional: boolean }> {
  return DEFINITIONS.flatMap((definition): Array<{ id: string; optional: boolean }> => {
    if (definition.slots.includes(slot)) return [{ id: definition.id, optional: false }]
    if (definition.optionalSlots?.includes(slot)) return [{ id: definition.id, optional: true }]
    return []
  })
}

function keyOf(slot: AiSlot): string {
  return `slot:${slot}`
}

async function save(slot: AiSlot, request: UpdateAiSlotRequest): Promise<boolean> {
  const run = runs[slot]
  run.saving = true
  try {
    const next = await aiApi.updateSlots({ [slot]: request })
    // A new model makes the last Try it answer about a different model.
    run.result = null
    run.error = null
    emit('updated', next)
    toast.success(t('settings.admin.ai.models.saved', { slot: slotLabel(slot) }))
    return true
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.admin.ai.models.saveFailed'))
    return false
  } finally {
    run.saving = false
  }
}

async function handleSave(slot: AiSlot, request: UpdateAiSlotRequest) {
  if (await save(slot, request)) emit('setOpen', keyOf(slot), false)
}

/** Try it from a closed row opens it, so the answer has somewhere to show. */
async function handleTry(slot: AiSlot, request: UpdateAiSlotRequest | null) {
  emit('setOpen', keyOf(slot), true)
  if (request && !(await save(slot, request))) return
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

function handleRetry() {
  emit('retry')
}

function handleNeedModels(connectionId: number, force: boolean) {
  emit('needModels', connectionId, force)
}

function handleAddAnthropic(connection: AiConnection) {
  emit('addAnthropic', connection)
}

function handleSetOpen(slot: AiSlot, open: boolean) {
  emit('setOpen', keyOf(slot), open)
}
</script>

<template>
  <section aria-labelledby="ai-models-title" class="flex min-w-0 flex-col gap-2.5" data-testid="ai-models">
    <AiSectionHeader title-id="ai-models-title" :title="t('settings.admin.ai.models.title')" :hint="t('settings.admin.ai.models.hint')" />

    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error' || !settings" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.models.loadFailed')" @retry="handleRetry" />
    </div>

    <template v-else>
      <div :class="aiTable.card">
        <div :class="[aiTable.head, aiColumns.models]" aria-hidden="true">
          <span>{{ t('settings.admin.ai.models.columns.slot') }}</span>
          <span>{{ t('settings.admin.ai.models.columns.model') }}</span>
          <span class="text-end">{{ t('settings.admin.ai.models.columns.price') }}</span>
          <span>{{ t('settings.admin.ai.models.columns.status') }}</span>
          <span />
        </div>
        <ul :class="aiTable.list" aria-labelledby="ai-models-title">
          <AiSlotRow
            v-for="slot in AI_SLOTS"
            :key="slot"
            :slot-id="slot"
            :value="settings.slots[slot]"
            :health="settings.slotHealth[slot]"
            :connections="connections"
            :model-lists="modelLists"
            :used-by="USED_BY[slot]"
            :open="openKeys.has(keyOf(slot))"
            :saving="runs[slot].saving"
            :trying="runs[slot].trying"
            :try-result="runs[slot].result"
            :try-error="runs[slot].error"
            @need-models="handleNeedModels"
            @save="handleSave(slot, $event)"
            @try="handleTry(slot, $event)"
            @add-anthropic="handleAddAnthropic"
            @set-open="handleSetOpen(slot, $event)"
          />
        </ul>
      </div>
      <p class="text-xs leading-4 text-muted-foreground" data-testid="ai-models-measured">{{ t('settings.admin.ai.models.measured') }}</p>
    </template>
  </section>
</template>
