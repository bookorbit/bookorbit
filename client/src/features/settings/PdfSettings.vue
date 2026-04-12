<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { PdfReaderSettings } from '@projectx/types'
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

const { effective, load, update, reset } = useReaderDefaultSettings<PdfReaderSettings>('pdf')

onMounted(load)

const showZoom = computed(() => effective.value.zoomMode === 'custom')
</script>

<template>
  <div
    class="[&_.settings-hint]:overflow-hidden [&_.settings-hint]:text-ellipsis [&_.settings-hint]:whitespace-nowrap md:[&_.settings-hint]:overflow-visible md:[&_.settings-hint]:whitespace-normal"
  >
    <SettingsPageHeader v-if="!props.embedded" title="PDF Reader" subtitle="Default settings applied when opening PDF files.">
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

    <!-- Layout -->
    <div class="mb-6">
      <p class="settings-group-label">Layout</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Scroll mode -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Scroll mode</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Page flips one at a time; continuous scrolls through all pages
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.scrollMode === 'page' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ scrollMode: 'page' })"
            >
              Page
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.scrollMode === 'vertical' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ scrollMode: 'vertical' })"
            >
              Scrolled
            </button>
          </div>
        </div>

        <!-- Page spread -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Page spread</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Which page number starts on the right in two-page view
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.spread === 'none' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ spread: 'none' })"
            >
              None
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.spread === 'odd' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ spread: 'odd' })"
            >
              Odd
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.spread === 'even' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ spread: 'even' })"
            >
              Even
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Zoom -->
    <div class="mb-6">
      <p class="settings-group-label">Zoom</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Zoom mode -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <p class="settings-label">Default fit</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              How pages are scaled when a PDF is opened
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in [
                { id: 'fit-page' as const, label: 'Fit Page' },
                { id: 'fit-width' as const, label: 'Fit Width' },
                { id: 'custom' as const, label: 'Custom' },
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
              <p class="settings-label">Zoom level</p>
              <span class="settings-value">{{ Math.round(effective.customScale * 100) }}%</span>
            </div>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Scale factor for custom zoom mode
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
