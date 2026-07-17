<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AudioReaderSettings } from '@bookorbit/types'
import { useReaderDefaultSettings } from '@/features/reader/shared/composables/useReaderSettings'
import SettingsPageHeader from './SettingsPageHeader.vue'

const { t } = useI18n()

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
    <SettingsPageHeader v-if="!props.embedded" :title="t('settings.reader.audio.title')" :subtitle="t('settings.reader.audio.subtitle')">
      <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
        {{ t('settings.reader.resetToDefaults') }}
      </button>
    </SettingsPageHeader>
    <template v-else>
      <div
        class="md:hidden sticky top-11 z-10 -mx-4 mb-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
      >
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
          {{ t('settings.reader.resetToDefaults') }}
        </button>
      </div>
      <div class="hidden md:flex justify-end mb-4">
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
          {{ t('settings.reader.resetToDefaults') }}
        </button>
      </div>
    </template>

    <!-- Playback -->
    <div class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.audio.playback') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Playback speed -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.audio.playbackSpeed') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.audio.playbackSpeedHint') }}
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
              <p class="settings-label">{{ t('settings.reader.audio.volume') }}</p>
              <span class="settings-value">{{ Math.round(effective.volume * 100) }}%</span>
            </div>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.audio.volumeHint') }}
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
      <p class="settings-group-label">{{ t('settings.reader.audio.skipControls') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Skip back -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.audio.skipBack') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.audio.skipBackHint') }}
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
            <p class="settings-label">{{ t('settings.reader.audio.skipForward') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.audio.skipForwardHint') }}
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
