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
  grow?: boolean
}>()

const emit = defineEmits<{ toggle: [field: BookMetadataLockField] }>()

const { t } = useI18n()
const loading = computed(() => props.isUpdating?.(props.field) ?? false)

function handleToggle() {
  emit('toggle', props.field)
}
</script>

<template>
  <div class="group/field space-y-1" :class="grow ? 'flex min-h-0 flex-col' : ''">
    <label class="text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase">{{ label }}</label>
    <div class="relative" :class="grow ? 'min-h-0 flex-1' : ''">
      <slot />
      <button
        type="button"
        class="absolute right-1.5 z-10 inline-flex size-7 cursor-pointer items-center justify-center rounded-md border transition-[color,background-color,border-color,opacity] disabled:cursor-not-allowed sm:size-6"
        :class="[
          multiline ? 'top-1.5 sm:top-1' : 'top-1/2 -translate-y-1/2',
          locked
            ? 'border-primary/30 bg-primary/15 text-primary hover:bg-primary/25'
            : 'border-transparent text-muted-foreground hover:border-input hover:bg-muted hover:text-foreground focus-visible:border-input focus-visible:bg-muted',
          loading ? 'opacity-60' : '',
        ]"
        :aria-label="locked ? t('book.detail.editMetadata.unlockField', { field: label }) : t('book.detail.editMetadata.lockField', { field: label })"
        :title="locked ? t('book.detail.editMetadata.unlockField', { field: label }) : t('book.detail.editMetadata.lockField', { field: label })"
        :disabled="loading"
        @click="handleToggle"
      >
        <Transition name="icon" mode="out-in">
          <Loader2 v-if="loading" key="loading" class="size-3.5 animate-spin" aria-hidden="true" />
          <Lock v-else-if="locked" key="locked" class="size-4 sm:size-3.5 text-primary" aria-hidden="true" />
          <LockOpen v-else key="unlocked" class="size-4 sm:size-3.5" aria-hidden="true" />
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
