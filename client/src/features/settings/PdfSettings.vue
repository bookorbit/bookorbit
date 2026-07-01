<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PdfReaderSettings } from '@bookorbit/types'
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

const { effective, load, update, reset } = useReaderDefaultSettings<PdfReaderSettings>('pdf')

onMounted(load)

const showZoom = computed(() => effective.value.zoomMode === 'custom')
</script>

<template>
  <div
    class="[&_.settings-hint]:overflow-hidden [&_.settings-hint]:text-ellipsis [&_.settings-hint]:whitespace-nowrap md:[&_.settings-hint]:overflow-visible md:[&_.settings-hint]:whitespace-normal"
  >
    <SettingsPageHeader v-if="!props.embedded" :title="t('settings.reader.pdf.title')" :subtitle="t('settings.reader.pdf.subtitle')">
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

    <!-- Layout -->
    <div class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.pdf.layout') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Scroll mode -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.pdf.scrollMode') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.pdf.scrollModeHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.scrollMode === 'page' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ scrollMode: 'page' })"
            >
              {{ t('settings.reader.pdf.page') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.scrollMode === 'vertical' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ scrollMode: 'vertical' })"
            >
              {{ t('settings.reader.pdf.scrolled') }}
            </button>
          </div>
        </div>

        <!-- Page spread -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.pdf.pageSpread') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.pdf.pageSpreadHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.spread === 'none' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ spread: 'none' })"
            >
              {{ t('settings.reader.pdf.spreadNone') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.spread === 'odd' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ spread: 'odd' })"
            >
              {{ t('settings.reader.pdf.spreadOdd') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.spread === 'even' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ spread: 'even' })"
            >
              {{ t('settings.reader.pdf.spreadEven') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Zoom -->
    <div class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.pdf.zoom') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Zoom mode -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <p class="settings-label">{{ t('settings.reader.pdf.defaultFit') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.pdf.defaultFitHint') }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in [
                { id: 'fit-page' as const, label: t('settings.reader.pdf.fitPage') },
                { id: 'fit-width' as const, label: t('settings.reader.pdf.fitWidth') },
                { id: 'custom' as const, label: t('settings.reader.pdf.custom') },
              ]"
              :key="opt.id"
              class="h-8 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                effective.zoomMode === opt.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="update({ zoomMode: opt.id })"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Custom scale (only shown when zoomMode is custom) -->
        <div v-if="showZoom" class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">{{ t('settings.reader.pdf.zoomLevel') }}</p>
              <span class="settings-value">{{ Math.round(effective.customScale * 100) }}%</span>
            </div>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.pdf.zoomLevelHint') }}
            </p>
          </div>
          <input
            type="range"
            min="0.25"
            max="4"
            step="0.05"
            class="w-full accent-primary cursor-pointer"
            :value="effective.customScale"
            @input="update({ customScale: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
      </div>
    </div>
  </div>
</template>
