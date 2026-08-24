<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarClock, Eye, FileEdit, Pencil } from '@lucide/vue'
import type { Library } from '@bookorbit/types'
import { parseCronToHuman } from '@/features/library/utils/cron'

const props = defineProps<{ library: Library }>()

const { t } = useI18n()

/**
 * Every slot renders in both states. An omitted chip and a disabled setting used to look the same,
 * which made a library's configuration unreadable from the list.
 */
const slots = computed(() => {
  const schedule = parseCronToHuman(props.library.autoScanCronExpression)
  return [
    { key: 'watch', icon: Eye, on: props.library.watch, label: t('settings.admin.libraries.capability.watch'), detail: null },
    { key: 'schedule', icon: CalendarClock, on: Boolean(schedule), label: t('settings.admin.libraries.capability.schedule'), detail: schedule },
    { key: 'fileWrite', icon: FileEdit, on: props.library.fileWriteEnabled, label: t('settings.admin.libraries.capability.fileWrite'), detail: null },
    {
      key: 'fileRename',
      icon: Pencil,
      on: props.library.fileRenameEnabled,
      label: t('settings.admin.libraries.capability.fileRename'),
      detail: null,
    },
  ]
})

function slotTitle(slot: { label: string; on: boolean; detail: string | null }): string {
  if (!slot.on) return t('settings.admin.libraries.capability.off', { name: slot.label })
  return slot.detail ? `${slot.label}: ${slot.detail}` : t('settings.admin.libraries.capability.on', { name: slot.label })
}
</script>

<template>
  <ul class="flex items-center gap-1">
    <li
      v-for="slot in slots"
      :key="slot.key"
      :title="slotTitle(slot)"
      class="flex size-6 items-center justify-center rounded-md border"
      :class="slot.on ? 'border-border bg-foreground/6 text-foreground' : 'border-dashed border-border/70 text-muted-foreground opacity-45'"
    >
      <component :is="slot.icon" :size="12" aria-hidden="true" />
      <span class="sr-only">{{ slotTitle(slot) }}</span>
    </li>
  </ul>
</template>
