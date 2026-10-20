<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { RotateCcw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useSidebarCustomizeMode } from '@/composables/useSidebarCustomizeMode'
import { useSidebarLayout } from '@/composables/useSidebarLayout'

const { t } = useI18n()
const { resetLayout, restoreLayout } = useSidebarLayout()
const { stopCustomizing } = useSidebarCustomizeMode()

function handleReset() {
  const previous = resetLayout()
  toast.success(t('components.sidebar.customize.resetDone'), {
    action: { label: t('common.undo'), onClick: () => restoreLayout(previous) },
  })
}

function handleDone() {
  stopCustomizing()
}
</script>

<template>
  <!-- Takes the dock's place while editing; the footer row below stays. -->
  <div class="flex shrink-0 items-center gap-1.5 border-t border-sidebar-border px-2 py-[7px]" data-testid="sidebar-customize-bar">
    <Button
      variant="ghost"
      size="sm"
      class="min-w-0 gap-2 px-2 text-[13px] text-sidebar-foreground hover:bg-(--shell-accent-wash)"
      @click="handleReset"
    >
      <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        <RotateCcw :size="15" aria-hidden="true" />
      </span>
      <span class="truncate">{{ t('components.sidebar.customize.reset') }}</span>
    </Button>
    <Button size="sm" class="ms-auto shrink-0 px-4 text-[13px]" @click="handleDone">{{ t('components.sidebar.customize.done') }}</Button>
  </div>
</template>
