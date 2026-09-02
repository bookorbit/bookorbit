<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import FieldHint from './FieldHint.vue'

/**
 * The one field layout. Label above, control below, at most one line of hint under that. Width is
 * the control's business, not the field's, so a number box and a URL box can differ without the
 * form growing a second layout for them.
 */
const props = defineProps<{
  label: string
  inputId: string
  required?: boolean
  brief?: string
  /** A validation failure for this field. Replaces the hint, because it is the more urgent fact. */
  error?: string | null
}>()

const { t } = useI18n()

const hintId = computed(() => `${props.inputId}-hint`)
const errorId = computed(() => `${props.inputId}-error`)

/**
 * Handed to the control through the slot rather than applied here: the control is whatever the
 * caller renders, and it is the element that has to carry its own description and invalid state.
 */
const describedBy = computed(() => {
  if (props.error) return errorId.value
  return props.brief ? hintId.value : undefined
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1.5">
    <label :for="inputId" class="settings-label">
      {{ label }}
      <template v-if="required">
        <span class="text-primary" aria-hidden="true">*</span>
        <span class="sr-only">{{ t('settings.field.required') }}</span>
      </template>
    </label>

    <slot :described-by="describedBy" :invalid="Boolean(error)" />

    <p v-if="error" :id="errorId" role="alert" class="text-xs text-destructive">{{ error }}</p>
    <FieldHint v-else-if="brief" :id="hintId" :brief="brief" />
  </div>
</template>
