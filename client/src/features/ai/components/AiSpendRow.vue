<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { ChevronUp, Info, Loader2, Pencil } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

import { Button } from '@/components/ui/button'
import { formatPercent } from '@/i18n/formatters'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import { numberFieldText, parseNumberField, type NumberFieldRule } from '../lib/ai-number-field'
import { aiColumns, aiTable } from '../lib/ai-settings-ui'
import AiMeter from './AiMeter.vue'

export type AiSpendFieldId = 'monthlyBudget' | 'buildsPerMonth'

export interface AiSpendField {
  id: AiSpendFieldId
  label: string
  brief: string
  placeholder: string
  error: string
  rule: NumberFieldRule
  value: number | null
}

const props = defineProps<{
  rowKey: string
  name: string
  sub?: string
  /** The whole-server row reads as the total the others sit under. */
  strong?: boolean
  limit: string | null
  /** A limit that is borrowed rather than set, such as sharing the server's. */
  limitMuted?: boolean
  limitSub?: string | null
  spent: string | null
  spentSub?: string | null
  /** Spent over the limit, 0 to 1 and beyond; null when there is no limit to measure against. */
  used: number | null
  note?: string | null
  fields: AiSpendField[]
  open: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  save: [values: Partial<Record<AiSpendFieldId, number | null>>]
  setOpen: [open: boolean]
}>()

const { t } = useI18n()
const id = useId()

function textsOf(fields: AiSpendField[]): Partial<Record<AiSpendFieldId, string>> {
  return Object.fromEntries(fields.map((field) => [field.id, numberFieldText(field.value)]))
}

const texts = ref(textsOf(props.fields))
// A reload that brings the same values back keeps what is being typed.
watch(
  () => JSON.stringify(textsOf(props.fields)),
  () => {
    texts.value = textsOf(props.fields)
  },
)

const parsed = computed(() => Object.fromEntries(props.fields.map((field) => [field.id, parseNumberField(texts.value[field.id] ?? '', field.rule)])))
const invalid = computed(() => Object.values(parsed.value).some((entry) => !entry.ok))
const dirty = computed(() => JSON.stringify(textsOf(props.fields)) !== JSON.stringify(texts.value))

function fieldError(field: AiSpendField): string | null {
  return parsed.value[field.id]?.ok === false ? field.error : null
}

function handleSave() {
  if (invalid.value || !dirty.value) return
  const values: Partial<Record<AiSpendFieldId, number | null>> = {}
  for (const field of props.fields) {
    const entry = parsed.value[field.id]
    if (entry?.ok) values[field.id] = entry.value
  }
  emit('save', values)
}

function handleCancel() {
  texts.value = textsOf(props.fields)
  emit('setOpen', false)
}

function handleToggle() {
  emit('setOpen', !props.open)
}

const usedPercent = computed(() => (props.used === null ? '' : formatPercent(Math.max(0, props.used))))
</script>

<template>
  <li :id="`ai-spend-${rowKey}`" class="scroll-mt-24" :data-spend="rowKey">
    <div :class="[aiTable.row, aiColumns.spending, open ? aiTable.rowOpen : '']">
      <div :class="aiTable.main">
        <p :id="`${id}-name`" class="truncate text-foreground" :class="strong ? 'font-semibold' : 'font-medium'">{{ name }}</p>
        <p v-if="sub" :class="aiTable.sub">{{ sub }}</p>
      </div>
      <div :class="aiTable.meta" data-testid="ai-spend-limit">
        <p :class="limit === null || limitMuted ? 'text-muted-foreground' : 'text-foreground tabular-nums'">
          {{ limit ?? t('settings.admin.ai.spending.noLimit') }}
        </p>
        <p v-if="limitSub" :class="aiTable.sub">{{ limitSub }}</p>
      </div>
      <div :class="[aiTable.meta, aiTable.num]" data-testid="ai-spend-spent">
        <p v-if="spent !== null">{{ spent }}</p>
        <p v-if="spentSub" :class="aiTable.sub">{{ spentSub }}</p>
      </div>
      <div :class="[aiTable.wide, used === null ? aiTable.hideOnPhone : '']" data-testid="ai-spend-used">
        <div v-if="used !== null" class="flex items-center gap-2.5">
          <AiMeter class="flex-1" :used="used" :label="t('settings.admin.ai.spending.usedLabel', { name })" />
          <span class="min-w-[34px] text-end text-[13px] tabular-nums">{{ usedPercent }}</span>
        </div>
      </div>
      <div :class="aiTable.actions">
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('settings.admin.ai.spending.editNamed', { name })"
          :title="t('settings.admin.ai.spending.editNamed', { name })"
          :aria-expanded="open"
          :aria-controls="`${id}-editor`"
          data-testid="ai-spend-toggle"
          @click="handleToggle"
        >
          <ChevronUp v-if="open" class="size-4" />
          <Pencil v-else class="size-4" />
        </Button>
      </div>
      <p v-if="note" :class="[aiTable.note, 'text-foreground']" data-testid="ai-spend-note">
        <Info :class="[aiTable.noteIcon, 'text-muted-foreground']" aria-hidden="true" />
        <span class="min-w-0">{{ note }}</span>
      </p>
    </div>

    <div v-if="open" :id="`${id}-editor`" :class="aiTable.editor" role="group" :aria-labelledby="`${id}-name`" data-testid="ai-spend-editor">
      <div class="grid max-w-[560px] gap-x-4 gap-y-3.5 md:grid-cols-2">
        <SettingsField
          v-for="field in fields"
          :key="field.id"
          :label="field.label"
          :input-id="`${id}-${field.id}`"
          :brief="field.brief"
          :error="fieldError(field)"
        >
          <template #default="{ describedBy, invalid: fieldInvalid }">
            <input
              :id="`${id}-${field.id}`"
              v-model="texts[field.id]"
              type="text"
              :inputmode="field.rule.integer ? 'numeric' : 'decimal'"
              class="settings-control tabular-nums"
              :placeholder="field.placeholder"
              :aria-describedby="describedBy"
              :aria-invalid="fieldInvalid"
              :data-testid="`ai-spend-${field.id}`"
            />
          </template>
        </SettingsField>
      </div>
      <div :class="aiTable.foot">
        <span class="flex-1" />
        <Button variant="ghost" size="sm" @click="handleCancel">{{ t('common.cancel') }}</Button>
        <Button size="sm" :disabled="!dirty || invalid || saving" data-testid="ai-spend-save" @click="handleSave">
          <Loader2 v-if="saving" class="size-3.5 animate-spin" />
          {{ t('settings.admin.ai.spending.save') }}
        </Button>
      </div>
    </div>
  </li>
</template>
