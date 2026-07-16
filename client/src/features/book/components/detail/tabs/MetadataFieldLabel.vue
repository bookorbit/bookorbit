<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Lock, LockOpen } from '@lucide/vue'
import type { BookMetadataLockField } from '@bookorbit/types'

const props = defineProps<{
  label: string
  field: BookMetadataLockField
  locked: boolean
  isUpdating?: (field: BookMetadataLockField) => boolean
  multiline?: boolean
}>()

const emit = defineEmits<{ toggle: [field: BookMetadataLockField] }>()

const { t } = useI18n()
const loading = computed(() => props.isUpdating?.(props.field) ?? false)

function handleToggle() {
  emit('toggle', props.field)
}
</script>

<template>
  <div class="space-y-1">
    <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ label }}</label>
    <div class="relative">
      <slot />
      <button
        type="button"
        class="absolute right-2 z-10 inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-input bg-background/95 text-muted-foreground shadow-sm transition-[colors,opacity] hover:text-foreground hover:bg-muted disabled:cursor-not-allowed"
        :class="[multiline ? 'top-1' : 'top-1/2 -translate-y-1/2', loading ? 'opacity-60' : 'opacity-100']"
        :aria-label="locked ? t('book.detail.editMetadata.unlockField', { field: label }) : t('book.detail.editMetadata.lockField', { field: label })"
        :title="locked ? t('book.detail.editMetadata.unlockField', { field: label }) : t('book.detail.editMetadata.lockField', { field: label })"
        :disabled="loading"
        @click="handleToggle"
      >
        <Transition name="icon" mode="out-in">
          <Loader2 v-if="loading" key="loading" class="size-3.5 animate-spin" />
          <Lock v-else-if="locked" key="locked" class="size-3.5 text-primary" />
          <LockOpen v-else key="unlocked" class="size-3.5" />
        </Transition>
      </button>
    </div>
  </div>
</template>

<style scoped>
.icon-enter-active,
.icon-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}
.icon-enter-from {
  opacity: 0;
  transform: scale(0.7);
}
.icon-leave-to {
  opacity: 0;
  transform: scale(0.7);
}
</style>
