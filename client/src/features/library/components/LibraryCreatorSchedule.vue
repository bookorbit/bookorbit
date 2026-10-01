<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarClock, Eye } from '@lucide/vue'
import { isFiveFieldCronExpression } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { parseCronToHuman } from '@/features/library/utils/cron'

const { t, locale } = useI18n()

const CUSTOM = '__custom__'
const NEVER = '__never__'

const props = withDefaults(
  defineProps<{
    watch: boolean
    autoScanCronExpression: string | null
    showAutoScanSchedule?: boolean
  }>(),
  { showAutoScanSchedule: true },
)

const emit = defineEmits<{
  'update:watch': [value: boolean]
  'update:autoScanCronExpression': [value: string | null]
}>()

const presets = computed(() => [
  { label: t('library.creator.schedule.presets.never'), value: NEVER },
  { label: t('library.creator.schedule.presets.hourly'), value: '0 * * * *' },
  { label: t('library.creator.schedule.presets.every6Hours'), value: '0 */6 * * *' },
  { label: t('library.creator.schedule.presets.every12Hours'), value: '0 */12 * * *' },
  { label: t('library.creator.schedule.presets.daily'), value: '0 0 * * *' },
  { label: t('library.creator.schedule.presets.weekly'), value: '0 0 * * 1' },
  { label: t('library.creator.schedule.presets.custom'), value: CUSTOM },
])

const selectedPreset = computed(() => {
  if (props.autoScanCronExpression === null) return NEVER
  return presets.value.some((preset) => preset.value === props.autoScanCronExpression) ? props.autoScanCronExpression : CUSTOM
})
const isCustom = computed(() => selectedPreset.value === CUSTOM)
const isCronValid = computed(() => !isCustom.value || !props.autoScanCronExpression || isFiveFieldCronExpression(props.autoScanCronExpression))

const humanSchedule = computed(() => {
  const cron = props.autoScanCronExpression
  if (!cron) return t('library.creator.schedule.human.disabled')
  const known: Record<string, string> = {
    '0 * * * *': t('library.creator.schedule.human.hourly'),
    '0 */6 * * *': t('library.creator.schedule.human.every6Hours'),
    '0 */12 * * *': t('library.creator.schedule.human.every12Hours'),
    '0 0 * * *': t('library.creator.schedule.human.dailyMidnight'),
    '0 0 * * 1': t('library.creator.schedule.human.weeklyMonday'),
  }
  if (known[cron]) return known[cron]
  const description = parseCronToHuman(cron, locale.value)
  return !description || description === cron ? t('library.creator.schedule.human.invalid') : description
})

function handleWatchUpdate(value: boolean) {
  emit('update:watch', value)
}

function selectPreset(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === NEVER) emit('update:autoScanCronExpression', null)
  else if (value === CUSTOM) emit('update:autoScanCronExpression', '*/30 * * * *')
  else emit('update:autoScanCronExpression', value)
}

function handleCronInput(event: Event) {
  emit('update:autoScanCronExpression', (event.target as HTMLInputElement).value || null)
}
</script>

<template>
  <section class="divide-y divide-border rounded-xl border border-border bg-card">
    <div class="flex items-start gap-3.5 px-4 py-3.5">
      <Eye :size="17" class="mt-0.5 shrink-0 text-foreground" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-foreground">{{ t('library.creator.schedule.watchFolders.title') }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ t('library.creator.schedule.watchFolders.hint') }}</p>
      </div>
      <ToggleSwitch :model-value="watch" :aria-label="t('library.creator.schedule.watchFolders.title')" @update:model-value="handleWatchUpdate" />
    </div>

    <div v-if="showAutoScanSchedule" class="flex items-start gap-3.5 px-4 py-3.5">
      <CalendarClock :size="17" class="mt-0.5 shrink-0 text-foreground" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <label for="library-scan-preset" class="text-sm font-semibold text-foreground">{{ t('library.creator.schedule.autoScanSchedule') }}</label>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <select
            id="library-scan-preset"
            :value="selectedPreset"
            class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring @md:w-48"
            aria-describedby="library-scan-summary"
            @change="selectPreset"
          >
            <option v-for="preset in presets" :key="preset.value" :value="preset.value">{{ preset.label }}</option>
          </select>
          <p id="library-scan-summary" class="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <Eye :size="12" class="shrink-0" aria-hidden="true" />
            {{ humanSchedule }}
          </p>
        </div>

        <div v-if="isCustom" class="mt-3">
          <label for="library-scan-cron" class="mb-1.5 block text-xs font-medium text-muted-foreground">{{
            t('library.creator.schedule.cronExpression')
          }}</label>
          <input
            id="library-scan-cron"
            type="text"
            dir="ltr"
            :value="autoScanCronExpression ?? ''"
            placeholder="0 0 * * *"
            class="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 @md:w-60"
            :class="isCronValid ? 'border-input focus:ring-ring' : 'border-destructive focus:ring-destructive'"
            :aria-invalid="!isCronValid"
            aria-describedby="library-scan-cron-help"
            @input="handleCronInput"
          />
          <p v-if="!isCronValid" id="library-scan-cron-help" class="mt-1 text-xs text-destructive">{{ t('library.creator.schedule.cronInvalid') }}</p>
          <p v-else id="library-scan-cron-help" class="mt-1 text-xs text-muted-foreground">{{ t('library.creator.schedule.cronFormat') }}</p>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">{{ t('library.creator.schedule.timezoneHint') }}</p>
      </div>
    </div>
  </section>
</template>
