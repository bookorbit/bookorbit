<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ban, Check } from '@lucide/vue'
import { INDEXER_COLORS, type IndexerColor } from '@bookorbit/types'
import { sourceDotClass } from '@/features/book-requests/sourceColors'

/**
 * The colour an operator gives one request integration. A closed palette rather than a colour input:
 * every swatch here resolves to a token tuned separately for light and dark, which a hex value
 * picked by eye in one theme cannot be, and the picker is the only place that promise can be kept.
 */
const props = defineProps<{
  modelValue: IndexerColor | null
  inputName: string
  label?: string
  hint?: string
  noneLabel?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: IndexerColor | null] }>()

const { t } = useI18n()

/** Radios cannot carry null, so "no colour" travels as the empty string and is mapped back here. */
const selected = computed({
  get: () => props.modelValue ?? '',
  set: (value: string) => emit('update:modelValue', value === '' ? null : (value as IndexerColor)),
})

function colorLabel(color: IndexerColor): string {
  return t(`settings.system.requests.indexers.color.options.${color}`)
}
</script>

<template>
  <fieldset>
    <legend class="settings-label">{{ label ?? t('settings.system.requests.indexers.color.label') }}</legend>
    <p class="settings-hint">{{ hint ?? t('settings.system.requests.indexers.color.hint') }}</p>

    <div class="mt-3 flex flex-wrap gap-2">
      <label v-for="color in INDEXER_COLORS" :key="color" class="cursor-pointer">
        <input v-model="selected" type="radio" class="peer sr-only" :name="inputName" :value="color" />
        <span
          class="flex size-8 items-center justify-center rounded-lg ring-offset-2 ring-offset-card peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
          :class="sourceDotClass(color)"
        >
          <!-- Legible on both, because --background inverts with the theme in the same direction
               the swatch tokens do: near-white behind a darkened light-mode hue, near-black
               behind a lifted dark-mode one. -->
          <Check v-if="modelValue === color" :size="15" class="text-background" aria-hidden="true" />
        </span>
        <span class="sr-only">{{ colorLabel(color) }}</span>
      </label>

      <label class="cursor-pointer">
        <input v-model="selected" type="radio" class="peer sr-only" :name="inputName" value="" />
        <span
          class="flex size-8 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground ring-offset-2 ring-offset-card peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
        >
          <Check v-if="modelValue === null" :size="15" class="text-foreground" aria-hidden="true" />
          <Ban v-else :size="15" aria-hidden="true" />
        </span>
        <span class="sr-only">{{ noneLabel ?? t('settings.system.requests.indexers.color.none') }}</span>
      </label>
    </div>
  </fieldset>
</template>
