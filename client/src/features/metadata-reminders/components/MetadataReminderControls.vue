<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { METADATA_REMINDER_FIELDS, type MetadataReminderField } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { useMetadataReminders } from '../composables/useMetadataReminders'
import { useAuth } from '@/features/auth/composables/useAuth'

const { t } = useI18n()
const { fields, saving, saveFields } = useMetadataReminders()
const { user } = useAuth()
const id = useId()
const failedFields = ref<MetadataReminderField[] | null>(null)
const saved = ref(false)
const isDefault = computed(() => fields.value.length === METADATA_REMINDER_FIELDS.length)

watch(
  () => user.value?.id,
  () => {
    failedFields.value = null
    saved.value = false
  },
)

async function persist(next: MetadataReminderField[]) {
  const userId = user.value?.id
  failedFields.value = null
  saved.value = false
  const success = await saveFields(next)
  if (user.value?.id !== userId) return
  if (success) saved.value = true
  else failedFields.value = next
}

function handleFieldChange(field: MetadataReminderField, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = checked ? [...fields.value, field] : fields.value.filter((value) => value !== field)
  void persist(next)
}

function resetDefaults() {
  void persist([...METADATA_REMINDER_FIELDS])
}

function retrySave() {
  if (failedFields.value) void persist([...failedFields.value])
}
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1">
      <p class="text-xs font-medium text-primary">{{ t('metadataReminders.personal') }}</p>
      <p class="text-sm text-muted-foreground">{{ t('metadataReminders.description') }}</p>
    </div>

    <fieldset class="settings-card" :disabled="saving" :aria-busy="saving">
      <legend class="sr-only">{{ t('metadataReminders.fieldsHeading') }}</legend>
      <label
        v-for="field in METADATA_REMINDER_FIELDS"
        :key="field"
        class="flex cursor-pointer items-start gap-3 bg-card px-4 py-3.5 focus-within:bg-muted/30 hover:bg-muted/30 md:px-5"
        :class="saving ? 'cursor-wait' : ''"
      >
        <input
          type="checkbox"
          :value="field"
          :checked="fields.includes(field)"
          :aria-describedby="`${id}-${field}-hint`"
          class="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          @change="handleFieldChange(field, $event)"
        />
        <span class="min-w-0">
          <span class="settings-label block">{{ t(`metadataReminders.fields.${field}.label`) }}</span>
          <span :id="`${id}-${field}-hint`" class="settings-hint block">{{ t(`metadataReminders.fields.${field}.hint`) }}</span>
        </span>
      </label>
    </fieldset>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-muted-foreground" role="status" aria-live="polite">
        {{ saving ? t('metadataReminders.saving') : saved ? t('metadataReminders.saved') : t('metadataReminders.autoSave') }}
      </p>
      <Button type="button" variant="outline" size="sm" :disabled="saving || isDefault" @click="resetDefaults">
        {{ t('metadataReminders.reset') }}
      </Button>
    </div>
    <p v-if="fields.length === 0" class="text-sm text-muted-foreground">{{ t('metadataReminders.disabled') }}</p>
    <div v-if="failedFields" class="flex flex-wrap items-center gap-3" role="alert">
      <p class="text-sm text-destructive">{{ t('metadataReminders.saveFailed') }}</p>
      <Button type="button" variant="outline" size="sm" :disabled="saving" @click="retrySave">{{ t('common.retry') }}</Button>
    </div>
  </div>
</template>
