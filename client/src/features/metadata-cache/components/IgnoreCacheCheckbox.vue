<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  disabled?: boolean
  /** Hides the hint line for tight spots such as an action bar; it stays available to assistive technology and as a tooltip. */
  compact?: boolean
  /** Replaces the default explanation, for places where the checkbox only applies to one action. */
  hint?: string
}>()

const model = defineModel<boolean>({ default: false })

const { t } = useI18n()
const hintId = useId()

const hintText = computed(() => props.hint ?? t('metadataCache.ignoreCache.hint'))
const labelClass = computed(() => [
  props.compact ? 'items-center whitespace-nowrap' : 'items-start',
  props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
])
</script>

<template>
  <label class="flex gap-2 text-sm text-foreground" :class="labelClass" :title="compact ? hintText : undefined">
    <input
      v-model="model"
      type="checkbox"
      class="size-4 shrink-0 rounded-xs border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="compact ? '' : 'mt-0.5'"
      :disabled="disabled"
      :aria-describedby="hintId"
      data-testid="ignore-cache-checkbox"
    />
    <span class="min-w-0">
      <span class="block font-medium">{{ t('metadataCache.ignoreCache.label') }}</span>
      <span :id="hintId" class="block text-xs text-muted-foreground" :class="compact ? 'sr-only' : ''">{{ hintText }}</span>
    </span>
  </label>
</template>
