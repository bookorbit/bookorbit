<script setup lang="ts">
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import FieldHint from './FieldHint.vue'

/**
 * Switch first, label after. A binary set at one end of a wide row and read at the other takes the
 * longest eye-travel on the form for the least information.
 */
const props = defineProps<{
  modelValue: boolean
  label: string
  inputId: string
  brief?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

function handleChange(value: boolean) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <div class="flex items-center gap-2.5">
      <!-- `button` is a labelable element, so the label activates the switch the way a checkbox's would. -->
      <ToggleSwitch
        :id="inputId"
        :model-value="modelValue"
        :disabled="disabled"
        :aria-describedby="brief ? `${inputId}-hint` : undefined"
        @update:model-value="handleChange"
      />
      <label :for="inputId" class="settings-label cursor-pointer">{{ props.label }}</label>
    </div>
    <FieldHint v-if="brief" :id="`${inputId}-hint`" :brief="brief" class="ps-[2.875rem]" />
  </div>
</template>
