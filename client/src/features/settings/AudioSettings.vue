<script setup lang="ts">
import { onMounted } from 'vue'
import type { AudioReaderSettings } from '@projectx/types'
import { useReaderDefaultSettings } from '@/features/reader/shared/composables/useReaderSettings'
import SettingsPageHeader from './SettingsPageHeader.vue'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  {
    embedded: false,
  },
)

const { effective, load, update, reset } = useReaderDefaultSettings<AudioReaderSettings>('m4b')

onMounted(load)
</script>

<template>
  <SettingsPageHeader
    v-if="!props.embedded"
    title="Audiobook Player"
    subtitle="Default settings applied when playing M4B, MP3, and other audio formats."
  >
    <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
      Reset to defaults
    </button>
  </SettingsPageHeader>
  <div v-else class="flex justify-end mb-4">
    <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
      Reset to defaults
    </button>
  </div>

  <!-- Playback -->
  <div class="mb-6">
    <p class="settings-group-label">Playback</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <!-- Playback speed -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Default playback speed</p>
          <p class="settings-hint">Speed multiplier applied when opening a new audiobook</p>
        </div>
        <div class="flex flex-wrap justify-end gap-1.5">
          <button
            v-for="speed in [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]"
            :key="speed"
            class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
            :class="
              effective.playbackSpeed === speed
                ? 'border-primary text-primary bg-primary/8'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            "
            @click="update({ playbackSpeed: speed })"
          >
            {{ speed }}x
          </button>
        </div>
      </div>

      <!-- Volume -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Default volume</p>
          <p class="settings-hint">Initial volume level (0 to 100%)</p>
        </div>
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="effective.volume"
            class="w-32 accent-primary"
            @input="update({ volume: parseFloat(($event.target as HTMLInputElement).value) })"
          />
          <span class="text-sm text-muted-foreground w-10 text-right">{{ Math.round(effective.volume * 100) }}%</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Skip controls -->
  <div class="mb-6">
    <p class="settings-group-label">Skip controls</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <!-- Skip back -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Skip back duration</p>
          <p class="settings-hint">Seconds rewound on skip-back press</p>
        </div>
        <div class="flex flex-wrap justify-end gap-1.5">
          <button
            v-for="secs in [5, 10, 15, 30]"
            :key="secs"
            class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
            :class="
              effective.skipBackSeconds === secs
                ? 'border-primary text-primary bg-primary/8'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            "
            @click="update({ skipBackSeconds: secs })"
          >
            {{ secs }}s
          </button>
        </div>
      </div>

      <!-- Skip forward -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Skip forward duration</p>
          <p class="settings-hint">Seconds advanced on skip-forward press</p>
        </div>
        <div class="flex flex-wrap justify-end gap-1.5">
          <button
            v-for="secs in [10, 15, 30, 60]"
            :key="secs"
            class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
            :class="
              effective.skipForwardSeconds === secs
                ? 'border-primary text-primary bg-primary/8'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            "
            @click="update({ skipForwardSeconds: secs })"
          >
            {{ secs }}s
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
