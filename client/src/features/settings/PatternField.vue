<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleHelp, Loader2, Save } from '@lucide/vue'
import PatternPreview from './PatternPreview.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  fieldId: string
  label: string
  hint: string
  modelValue: string
  placeholder: string
  preview: string
  error?: string
  loading?: boolean
  saving?: boolean
  dirty?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string]; save: []; help: [] }>()

const { t } = useI18n()

const hintId = computed(() => `${props.fieldId}-hint`)
const errorId = computed(() => `${props.fieldId}-error`)
const describedBy = computed(() => (props.error ? `${hintId.value} ${errorId.value}` : hintId.value))

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function handleSave() {
  emit('save')
}

function handleHelp() {
  emit('help')
}
</script>

<template>
  <div class="space-y-3 px-4 py-4 md:px-5 md:py-5">
    <div class="max-w-2xl">
      <div class="flex items-center gap-1.5">
        <label :for="fieldId" class="settings-label">{{ label }}</label>
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('settings.reader.fileNaming.patternHelp')"
              @click="handleHelp"
            >
              <CircleHelp :size="14" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('settings.reader.fileNaming.patternHelp') }}</TooltipContent>
        </Tooltip>
      </div>
      <p :id="hintId" class="settings-hint">{{ hint }}</p>
    </div>

    <input
      :id="fieldId"
      :value="modelValue"
      type="text"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :placeholder="placeholder"
      class="input-field w-full font-mono"
      :class="error ? 'border-destructive focus:border-destructive focus:ring-destructive/40' : ''"
      :disabled="loading"
      :aria-describedby="describedBy"
      :aria-invalid="error ? 'true' : undefined"
      @input="handleInput"
    />
    <p v-if="error" :id="errorId" role="alert" class="text-xs font-medium text-destructive">{{ error }}</p>

    <PatternPreview :value="preview" :label="label" />

    <div class="flex justify-end">
      <button type="button" class="settings-btn-primary" :disabled="loading || saving || !dirty || !!error" @click="handleSave">
        <Loader2 v-if="saving" :size="14" class="animate-spin" aria-hidden="true" />
        <Save v-else :size="14" aria-hidden="true" />
        {{ t('common.save') }}
      </button>
    </div>
  </div>
</template>
