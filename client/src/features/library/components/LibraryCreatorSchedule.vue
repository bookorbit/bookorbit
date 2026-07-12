<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye } from '@lucide/vue'
import cronstrue from 'cronstrue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const { t } = useI18n()

const props = defineProps<{
  watch: boolean
  autoScanCronExpression: string | null
}>()

const emit = defineEmits<{
  'update:watch': [value: boolean]
  'update:autoScanCronExpression': [value: string | null]
}>()

const presets = computed(() => [
  { label: t('library.creator.schedule.presets.never'), value: null },
  { label: t('library.creator.schedule.presets.hourly'), value: '0 * * * *' },
  { label: t('library.creator.schedule.presets.every6Hours'), value: '0 */6 * * *' },
  { label: t('library.creator.schedule.presets.every12Hours'), value: '0 */12 * * *' },
  { label: t('library.creator.schedule.presets.daily'), value: '0 0 * * *' },
  { label: t('library.creator.schedule.presets.weekly'), value: '0 0 * * 1' },
  { label: t('library.creator.schedule.presets.custom'), value: '__custom__' },
])

const CRON_REGEX = /^((\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)? ){4}(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/

const isCustom = computed(() => {
  if (props.autoScanCronExpression === null) return false
  return !presets.value.some((p) => p.value === props.autoScanCronExpression)
})

const isCronValid = computed(() => {
  if (!isCustom.value || !props.autoScanCronExpression) return true
  return CRON_REGEX.test(props.autoScanCronExpression)
})

const selectedPreset = computed(() => {
  if (props.autoScanCronExpression === null) return null
  if (isCustom.value) return '__custom__'
  return props.autoScanCronExpression
})

function selectPreset(value: string | null) {
  if (value === '__custom__') {
    emit('update:autoScanCronExpression', '*/30 * * * *')
  } else {
    emit('update:autoScanCronExpression', value)
  }
}

function handleWatchUpdate(value: boolean) {
  emit('update:watch', value)
}

function handleCronInput(event: Event) {
  emit('update:autoScanCronExpression', (event.target as HTMLInputElement).value || null)
}

function humanReadableCron(cron: string | null): string {
  if (!cron) return t('library.creator.schedule.human.disabled')
  const map: Record<string, string> = {
    '0 * * * *': t('library.creator.schedule.human.hourly'),
    '0 */6 * * *': t('library.creator.schedule.human.every6Hours'),
    '0 */12 * * *': t('library.creator.schedule.human.every12Hours'),
    '0 0 * * *': t('library.creator.schedule.human.dailyMidnight'),
    '0 0 * * 1': t('library.creator.schedule.human.weeklyMonday'),
  }
  if (map[cron]) return map[cron]
  try {
    return cronstrue.toString(cron)
  } catch {
    return 'Enter a valid schedule to see a preview'
  }
}
</script>

<template>
  <div class="px-6 py-6 space-y-8">
    <!-- Watch folders -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">{{ t('library.creator.schedule.fileWatching') }}</p>
      <div class="overflow-hidden rounded-lg border border-border">
        <div class="flex items-center justify-between gap-4 bg-card px-4 py-4 sm:px-5">
          <div>
            <p class="text-sm font-medium text-foreground">{{ t('library.creator.schedule.watchFolders.title') }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">{{ t('library.creator.schedule.watchFolders.hint') }}</p>
          </div>
          <ToggleSwitch :model-value="watch" :aria-label="t('library.creator.schedule.watchFolders.title')" @update:model-value="handleWatchUpdate" />
        </div>
      </div>
    </div>

    <!-- Auto-scan schedule -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">{{ t('library.creator.schedule.autoScanSchedule') }}</p>
      <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <button
          v-for="preset in presets"
          :key="String(preset.value)"
          type="button"
          class="px-3 py-2 rounded-lg border text-xs font-medium transition-colors"
          :class="
            selectedPreset === preset.value
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
          "
          @click="selectPreset(preset.value)"
        >
          {{ preset.label }}
        </button>
      </div>

      <!-- Custom cron input -->
      <div v-if="isCustom || selectedPreset === '__custom__'" class="mt-2">
        <label for="library-scan-cron" class="mb-1.5 block text-xs font-medium text-muted-foreground">
          {{ t('library.creator.schedule.cronExpression') }}
        </label>
        <input
          id="library-scan-cron"
          type="text"
          :value="autoScanCronExpression ?? ''"
          placeholder="0 0 * * *"
          class="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2"
          :class="isCronValid ? 'border-border focus:ring-ring' : 'border-destructive focus:ring-destructive'"
          :aria-invalid="!isCronValid"
          aria-describedby="library-scan-cron-help"
          @input="handleCronInput"
        />
        <p v-if="!isCronValid" id="library-scan-cron-help" class="mt-1 text-xs text-destructive">
          {{ t('library.creator.schedule.cronInvalid') }}
        </p>
        <p v-else id="library-scan-cron-help" class="mt-1 text-xs text-muted-foreground">{{ t('library.creator.schedule.cronFormat') }}</p>
      </div>

      <!-- Human readable preview -->
      <div class="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        <Eye :size="12" />
        {{ humanReadableCron(autoScanCronExpression) }}
      </div>
    </div>
  </div>
</template>
