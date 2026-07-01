<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye } from '@lucide/vue'

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

function humanReadableCron(cron: string | null): string {
  if (!cron) return t('library.creator.schedule.human.disabled')
  const map: Record<string, string> = {
    '0 * * * *': t('library.creator.schedule.human.hourly'),
    '0 */6 * * *': t('library.creator.schedule.human.every6Hours'),
    '0 */12 * * *': t('library.creator.schedule.human.every12Hours'),
    '0 0 * * *': t('library.creator.schedule.human.dailyMidnight'),
    '0 0 * * 1': t('library.creator.schedule.human.weeklyMonday'),
  }
  return map[cron] ?? t('library.creator.schedule.human.cron', { cron })
}
</script>

<template>
  <div class="px-6 py-6 space-y-8">
    <!-- Watch folders -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">{{ t('library.creator.schedule.fileWatching') }}</p>
      <div class="rounded-lg border border-border overflow-hidden divide-y divide-border">
        <label class="flex items-center justify-between px-5 py-4 bg-card cursor-pointer">
          <div>
            <p class="text-sm font-medium text-foreground">{{ t('library.creator.schedule.watchFolders.title') }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">{{ t('library.creator.schedule.watchFolders.hint') }}</p>
          </div>
          <button
            role="switch"
            :aria-checked="watch"
            class="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            :class="watch ? 'bg-primary' : 'bg-muted-foreground/30'"
            @click="emit('update:watch', !watch)"
          >
            <span
              class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
              :class="watch ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
        </label>
      </div>
    </div>

    <!-- Auto-scan schedule -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">{{ t('library.creator.schedule.autoScanSchedule') }}</p>
      <div class="grid grid-cols-3 gap-2 mb-4">
        <button
          v-for="preset in presets"
          :key="String(preset.value)"
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
        <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('library.creator.schedule.cronExpression') }}</label>
        <input
          type="text"
          :value="autoScanCronExpression ?? ''"
          placeholder="0 0 * * *"
          class="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2"
          :class="isCronValid ? 'border-border focus:ring-ring' : 'border-destructive focus:ring-destructive'"
          @input="emit('update:autoScanCronExpression', ($event.target as HTMLInputElement).value || null)"
        />
        <p v-if="!isCronValid" class="mt-1 text-xs text-destructive">{{ t('library.creator.schedule.cronInvalid') }}</p>
        <p v-else class="mt-1 text-xs text-muted-foreground">{{ t('library.creator.schedule.cronFormat') }}</p>
      </div>

      <!-- Human readable preview -->
      <div class="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        <Eye :size="12" />
        {{ humanReadableCron(autoScanCronExpression) }}
      </div>
    </div>
  </div>
</template>
