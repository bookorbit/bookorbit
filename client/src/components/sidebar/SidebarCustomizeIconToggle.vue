<script setup lang="ts">
import { useId } from 'vue'
import { LayoutGrid } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

defineProps<{ label: string; modelValue: boolean }>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const switchId = `sidebar-icon-style-${useId()}`

function handleUpdate(value: boolean) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="mt-1 flex min-h-8 items-center gap-2 px-2">
    <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
      <LayoutGrid :size="15" aria-hidden="true" />
    </span>
    <label :for="switchId" class="min-w-0 flex-1 cursor-pointer text-[13px] leading-snug text-sidebar-foreground">
      {{ label }}
    </label>
    <ToggleSwitch :id="switchId" :model-value="modelValue" @update:model-value="handleUpdate" />
  </div>
</template>
