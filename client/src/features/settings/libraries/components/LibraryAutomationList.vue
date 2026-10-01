<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarClock, Check, ChevronDown, Eye, FileEdit, Pencil } from '@lucide/vue'
import type { Library } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SCHEDULE_PRESET_CRONS } from '@/features/library/utils/library-summary'
import { formatSchedule } from '../lib/library-schedule'

const props = withDefaults(defineProps<{ library: Library; interactive?: boolean; saving?: boolean }>(), { interactive: false, saving: false })

export type AutomationToggle = 'watch' | 'fileWriteEnabled' | 'fileRenameEnabled'

const emit = defineEmits<{
  toggle: [library: Library, setting: AutomationToggle]
  setSchedule: [library: Library, cron: string | null]
  editSchedule: [library: Library]
}>()

const { t, locale } = useI18n()

const schedule = computed(() => formatSchedule(props.library.autoScanCronExpression, t, locale.value))
const scheduleValue = computed(() => schedule.value?.label ?? t('settings.admin.libraries.stateOff'))

/**
 * Every setting keeps its row, so the four read the same way in every library. Only "on" gets a pill:
 * a column of dashed "Off" boxes was most of the ink on the page while saying nothing was happening.
 */
const rows = computed(() => {
  const on = t('settings.admin.libraries.stateOn')
  const off = t('settings.admin.libraries.stateOff')
  return [
    {
      key: 'watch',
      setting: 'watch' as AutomationToggle,
      icon: Eye,
      on: props.library.watch,
      label: t('settings.admin.libraries.capability.watch'),
      value: props.library.watch ? on : off,
      title: '',
      aria: t('settings.admin.libraries.quick.watchAria', { name: props.library.name }),
    },
    {
      key: 'schedule',
      icon: CalendarClock,
      on: Boolean(schedule.value),
      label: t('settings.admin.libraries.capability.schedule'),
      value: scheduleValue.value,
      title: schedule.value?.title ?? '',
      setting: null,
      aria: '',
    },
    {
      key: 'fileWrite',
      icon: FileEdit,
      on: props.library.fileWriteEnabled,
      label: t('settings.admin.libraries.capability.fileWrite'),
      value: props.library.fileWriteEnabled ? on : off,
      title: '',
      setting: 'fileWriteEnabled' as AutomationToggle,
      aria: t('settings.admin.libraries.quick.fileWriteAria', { name: props.library.name }),
    },
    {
      key: 'fileRename',
      icon: Pencil,
      on: props.library.fileRenameEnabled,
      label: t('settings.admin.libraries.capability.fileRename'),
      value: props.library.fileRenameEnabled ? on : off,
      title: '',
      setting: 'fileRenameEnabled' as AutomationToggle,
      aria: t('settings.admin.libraries.quick.renameAria', { name: props.library.name }),
    },
  ]
})

const presetOptions = computed(() => [
  { cron: null, label: t('settings.admin.libraries.stateOff') },
  ...SCHEDULE_PRESET_CRONS.map((preset) => ({ cron: preset.cron, label: t(`library.creator.schedule.presets.${preset.preset}`) })),
])

function requestToggle(setting: AutomationToggle) {
  emit('toggle', props.library, setting)
}

function pickSchedule(cron: string | null) {
  if (cron === (props.library.autoScanCronExpression ?? null)) return
  emit('setSchedule', props.library, cron)
}

function requestCustomSchedule() {
  emit('editSchedule', props.library)
}
</script>

<template>
  <ul class="flex flex-col gap-1.5">
    <li v-for="row in rows" :key="row.key" :data-testid="`automation-${row.key}`" class="flex min-h-5 items-center gap-2.5 text-[12.5px]">
      <component :is="row.icon" :size="13" class="shrink-0" :class="row.on ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
      <span class="whitespace-nowrap" :class="row.on ? 'text-foreground' : 'text-muted-foreground'">{{ row.label }}</span>

      <!-- Every setting changes in place. Writing and renaming only act on the next save of a book's details,
           so switching them on touches no file by itself; the bulk rewrite stays behind "Sync metadata to files". -->
      <span v-if="interactive && row.setting" class="ms-auto flex items-center gap-2">
        <span class="text-[11px] font-medium" :class="row.on ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true">{{ row.value }}</span>
        <ToggleSwitch :model-value="row.on" :disabled="saving" :aria-label="row.aria" @update:model-value="requestToggle(row.setting)" />
      </span>
      <DropdownMenu v-else-if="interactive && row.key === 'schedule'">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            data-testid="schedule-trigger"
            class="ms-auto inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            :class="
              row.on
                ? 'border-primary/35 bg-primary/12 text-primary hover:border-primary/60'
                : 'border-border text-muted-foreground hover:border-primary/45 hover:text-foreground'
            "
            :title="row.title || undefined"
            :disabled="saving"
            :aria-label="t('settings.admin.libraries.quick.scheduleAria', { name: library.name, value: row.value })"
          >
            <span class="truncate">{{ row.value }}</span>
            <ChevronDown :size="12" class="shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-56">
          <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">{{ row.label }}</DropdownMenuLabel>
          <DropdownMenuItem
            v-for="option in presetOptions"
            :key="option.cron ?? 'off'"
            :data-testid="`schedule-option-${option.cron ?? 'off'}`"
            @click="pickSchedule(option.cron)"
          >
            <Check :size="14" :class="option.cron === (library.autoScanCronExpression ?? null) ? 'opacity-100' : 'opacity-0'" aria-hidden="true" />
            {{ option.label }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="requestCustomSchedule">
            <CalendarClock :size="14" aria-hidden="true" />
            {{ t('settings.admin.libraries.quick.customSchedule') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span
        v-else-if="row.on"
        class="ms-auto inline-flex min-w-0 items-center gap-1.5 rounded-full border border-primary/35 bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary"
        :title="row.title || undefined"
      >
        <span class="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span class="truncate">{{ row.value }}</span>
      </span>
      <span v-else class="ms-auto px-1 text-[11.5px] text-muted-foreground">{{ row.value }}</span>
    </li>
  </ul>
</template>
