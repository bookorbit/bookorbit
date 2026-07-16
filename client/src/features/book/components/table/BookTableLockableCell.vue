<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Lock, LockOpen } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { t } = useI18n()

defineProps<{
  isLocked: boolean
  hasLockField: boolean
}>()

defineEmits<{
  'toggle-lock': []
}>()
</script>

<template>
  <div v-if="hasLockField" class="group/cell flex min-w-0 w-full items-center gap-1">
    <div class="min-w-0 flex-1">
      <slot />
    </div>
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          :aria-pressed="isLocked"
          :aria-label="isLocked ? t('book.table.locks.unlockField') : t('book.table.locks.lockField')"
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors"
          :class="
            isLocked
              ? 'text-primary/90 hover:text-primary'
              : 'opacity-0 text-muted-foreground/80 group-hover/cell:opacity-100 hover:text-muted-foreground'
          "
          @click.stop="$emit('toggle-lock')"
        >
          <Lock v-if="isLocked" :size="11" />
          <LockOpen v-else :size="11" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {{ isLocked ? t('book.table.locks.clickToUnlock') : t('book.table.locks.clickToLock') }}
      </TooltipContent>
    </Tooltip>
  </div>
  <slot v-else />
</template>
