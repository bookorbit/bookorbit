<script setup lang="ts">
import { computed } from 'vue'
import { Eye } from '@lucide/vue'
import cronstrue from 'cronstrue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const props = defineProps<{
  watch: boolean
  autoScanCronExpression: string | null
}>()

const emit = defineEmits<{
  'update:watch': [value: boolean]
  'update:autoScanCronExpression': [value: string | null]
}>()

const PRESETS = [
  { label: 'Never', value: null },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Daily', value: '0 0 * * *' },
  { label: 'Weekly', value: '0 0 * * 1' },
  { label: 'Custom', value: '__custom__' },
]

const CRON_REGEX = /^((\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)? ){4}(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/

const isCustom = computed(() => {
  if (props.autoScanCronExpression === null) return false
  return !PRESETS.some((p) => p.value === props.autoScanCronExpression)
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
  if (!cron) return 'Auto-scan disabled'
  const map: Record<string, string> = {
    '0 * * * *': 'Every hour',
    '0 */6 * * *': 'Every 6 hours',
    '0 */12 * * *': 'Every 12 hours',
    '0 0 * * *': 'Daily at midnight',
    '0 0 * * 1': 'Weekly on Monday at midnight',
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
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">File watching</p>
      <div class="overflow-hidden rounded-lg border border-border">
        <div class="flex items-center justify-between gap-4 bg-card px-4 py-4 sm:px-5">
          <div>
            <p class="text-sm font-medium text-foreground">Watch folders</p>
            <p class="text-xs text-muted-foreground mt-0.5">Automatically detect new files added to library folders.</p>
          </div>
          <ToggleSwitch :model-value="watch" aria-label="Watch folders" @update:model-value="handleWatchUpdate" />
        </div>
      </div>
    </div>

    <!-- Auto-scan schedule -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">Auto-scan schedule</p>
      <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <button
          v-for="preset in PRESETS"
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
        <label for="library-scan-cron" class="mb-1.5 block text-xs font-medium text-muted-foreground">Cron expression</label>
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
        <p v-if="!isCronValid" id="library-scan-cron-help" class="mt-1 text-xs text-destructive">Enter a valid 5-field cron expression.</p>
        <p v-else id="library-scan-cron-help" class="mt-1 text-xs text-muted-foreground">Format: minute hour day month weekday</p>
      </div>

      <!-- Human readable preview -->
      <div class="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        <Eye :size="12" />
        {{ humanReadableCron(autoScanCronExpression) }}
      </div>
    </div>
  </div>
</template>
