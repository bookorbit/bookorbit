<script setup lang="ts" generic="Field extends string">
import { computed, inject, toValue } from 'vue'
import { useI18n } from 'vue-i18n'
import { Lock, LockOpen } from '@lucide/vue'
import { PODCAST_LOCKS_ENABLED } from '../lib/podcast-locks'

const props = defineProps<{
  label: string
  /** A lock field name from whichever set the surrounding editor owns: shows and episodes lock different fields. */
  field: Field
  inputId: string
  locked: boolean
  willLock?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ toggle: [field: Field] }>()

const { t } = useI18n()

/**
 * A lock pins a field against the next feed refresh. Local content is never refreshed, so the
 * surrounding editor turns the toggles off rather than offering a control that protects nothing.
 */
const locksSource = inject(PODCAST_LOCKS_ENABLED, true)
const locksEnabled = computed(() => toValue(locksSource))

const lockLabel = computed(() => {
  if (props.locked) return t('podcast.edit.unlockField', { field: props.label })
  if (props.willLock) return t('podcast.edit.willLockField', { field: props.label })
  return t('podcast.edit.lockField', { field: props.label })
})

function handleToggle() {
  emit('toggle', props.field)
}
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center justify-between gap-2">
      <label :for="inputId" class="text-xs font-medium">{{ label }}</label>
      <button
        v-if="locksEnabled"
        type="button"
        class="inline-flex size-6 items-center justify-center rounded-md border border-input bg-background transition-colors hover:bg-muted outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
        :class="locked || willLock ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
        :aria-pressed="locked"
        :aria-label="lockLabel"
        :title="lockLabel"
        :disabled="disabled"
        @click="handleToggle"
      >
        <Lock v-if="locked || willLock" class="size-3.5" :class="willLock && !locked ? 'opacity-70' : ''" />
        <LockOpen v-else class="size-3.5" />
      </button>
    </div>
    <slot />
    <p v-if="locksEnabled && willLock && !locked" class="text-xs text-muted-foreground">{{ t('podcast.edit.willLockHint') }}</p>
  </div>
</template>
