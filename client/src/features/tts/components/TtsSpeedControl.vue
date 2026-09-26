<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const props = defineProps<{ speed: number }>()
const emit = defineEmits<{ 'update:speed': [speed: number] }>()

const PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]
const MIN_SPEED = 0.25
const MAX_SPEED = 4

const { t } = useI18n()

function handleSliderInput(event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value)
  emit('update:speed', value)
}

function handlePreset(value: number) {
  emit('update:speed', value)
}
</script>

<template>
  <div class="space-y-3 pt-2 border-t border-border">
    <div class="flex items-center justify-between text-sm text-muted-foreground">
      <span>{{ t('tts.speed.value', { speed: MIN_SPEED }) }}</span>
      <span class="font-semibold text-foreground text-base">{{ t('tts.speed.value', { speed: props.speed }) }}</span>
      <span>{{ t('tts.speed.value', { speed: MAX_SPEED }) }}</span>
    </div>
    <input
      type="range"
      :min="MIN_SPEED"
      :max="MAX_SPEED"
      step="0.25"
      :value="props.speed"
      class="w-full accent-primary"
      :aria-label="t('tts.speed.label')"
      :aria-valuetext="t('tts.speed.value', { speed: props.speed })"
      @input="handleSliderInput"
    />
    <div class="flex flex-wrap gap-2 justify-center">
      <button
        v-for="preset in PRESETS"
        :key="preset"
        class="px-2.5 py-1 rounded-full text-xs border transition-colors"
        :class="props.speed === preset ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent text-foreground'"
        :aria-pressed="props.speed === preset"
        @click="handlePreset(preset)"
      >
        {{ t('tts.speed.value', { speed: preset }) }}
      </button>
    </div>
  </div>
</template>
