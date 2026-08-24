<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarClock, Eye, FileEdit, Pencil } from '@lucide/vue'
import type { Library } from '@bookorbit/types'
import { parseCronToHuman } from '@/features/library/utils/cron'

const props = defineProps<{ library: Library }>()

const { t } = useI18n()

/**
 * Every setting renders in both states with its real value, so a schedule reads as its actual
 * cron description rather than an icon, and "off" is stated rather than left out.
 */
const rows = computed(() => {
  const schedule = parseCronToHuman(props.library.autoScanCronExpression)
  const off = t('settings.admin.libraries.stateOff')
  const on = t('settings.admin.libraries.stateOn')
  return [
    {
      key: 'watch',
      icon: Eye,
      on: props.library.watch,
      label: t('settings.admin.libraries.capability.watch'),
      value: props.library.watch ? on : off,
    },
    { key: 'schedule', icon: CalendarClock, on: Boolean(schedule), label: t('settings.admin.libraries.capability.schedule'), value: schedule ?? off },
    {
      key: 'fileWrite',
      icon: FileEdit,
      on: props.library.fileWriteEnabled,
      label: t('settings.admin.libraries.capability.fileWrite'),
      value: props.library.fileWriteEnabled ? on : off,
    },
    {
      key: 'fileRename',
      icon: Pencil,
      on: props.library.fileRenameEnabled,
      label: t('settings.admin.libraries.capability.fileRename'),
      value: props.library.fileRenameEnabled ? on : off,
    },
  ]
})
</script>

<template>
  <ul class="flex flex-col gap-1.5">
    <li v-for="row in rows" :key="row.key" class="flex items-center gap-2.5 text-[12.5px]">
      <component :is="row.icon" :size="13" class="shrink-0" :class="row.on ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
      <span class="whitespace-nowrap" :class="row.on ? 'text-foreground' : 'text-muted-foreground'">{{ row.label }}</span>
      <!-- On and off differ by fill and border style as well as wording, so the state is readable
           without relying on colour or on reading the value. -->
      <span
        class="ms-auto inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        :class="row.on ? 'border-primary/35 bg-primary/12 text-primary' : 'border-dashed border-border text-muted-foreground'"
      >
        <span class="size-1.5 shrink-0 rounded-full" :class="row.on ? 'bg-primary' : 'border border-muted-foreground'" aria-hidden="true" />
        <span class="truncate">{{ row.value }}</span>
      </span>
    </li>
  </ul>
</template>
