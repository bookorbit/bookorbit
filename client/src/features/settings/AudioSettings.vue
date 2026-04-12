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
  <div
    class="[&_.settings-hint]:overflow-hidden [&_.settings-hint]:text-ellipsis [&_.settings-hint]:whitespace-nowrap md:[&_.settings-hint]:overflow-visible md:[&_.settings-hint]:whitespace-normal"
  >
    <SettingsPageHeader
      v-if="!props.embedded"
      title="Audiobook Player"
      subtitle="Default settings applied when playing M4B, MP3, and other audio formats."
    >
      <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
        Reset to defaults
      </button>
    </SettingsPageHeader>
    <template v-else>
      <div
        class="md:hidden sticky top-[5.25rem] z-10 -mx-4 mb-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
      >
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
          Reset to defaults
        </button>
      </div>
      <div class="hidden md:flex justify-end mb-4">
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
          Reset to defaults
        </button>
      </div>
    </template>

    <!-- Playback -->
    <div class="mb-6">
      <p class="settings-group-label">Playback</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Playback speed -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Default playback speed</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Speed multiplier applied when opening a new audiobook
            </p>
          </div>
          <div class="flex flex-wrap gap-2 self-start md:self-auto md:justify-end">
            <button
              v-for="speed in [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]"
              :key="speed"
              class="h-8 md:h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
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
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">Default volume</p>
              <span class="settings-value">{{ Math.round(effective.volume * 100) }}%</span>
            </div>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Initial volume level (0 to 100%)
            </p>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="effective.volume"
            class="w-full accent-primary"
            @input="update({ volume: parseFloat(($event.target as HTMLInputElement).value) })"
          />
        </div>
      </div>
    </div>

    <!-- Skip controls -->
    <div class="mb-6">
      <p class="settings-group-label">Skip controls</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Skip back -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Skip back duration</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Seconds rewound on skip-back press
            </p>
          </div>
          <div class="flex flex-wrap gap-2 self-start md:self-auto md:justify-end">
            <button
              v-for="secs in [5, 10, 15, 30]"
              :key="secs"
              class="h-8 md:h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
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
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Skip forward duration</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Seconds advanced on skip-forward press
            </p>
          </div>
          <div class="flex flex-wrap gap-2 self-start md:self-auto md:justify-end">
            <button
              v-for="secs in [10, 15, 30, 60]"
              :key="secs"
              class="h-8 md:h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
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
  </div>
</template>
