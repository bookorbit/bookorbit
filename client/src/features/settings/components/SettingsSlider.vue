<script setup lang="ts">
/**
 * A score slider has eleven or twenty-one stops, so a full-width track spends most of its travel
 * between two values it cannot express. Keep it short and put the number where the eye already is.
 */
const props = defineProps<{ id: string; modelValue: number; min: number; max: number; step: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: number]; change: [] }>()

function handleInput(event: Event) {
  emit('update:modelValue', Number((event.target as HTMLInputElement).value))
}

function handleChange() {
  emit('change')
}
</script>

<template>
  <div class="flex w-full items-center gap-3 md:w-auto">
    <input
      :id="props.id"
      type="range"
      class="w-full accent-primary cursor-pointer md:w-36"
      :value="props.modelValue"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      @input="handleInput"
      @change="handleChange"
    />
    <span class="settings-value w-7 shrink-0 text-right">{{ props.modelValue }}</span>
  </div>
</template>
