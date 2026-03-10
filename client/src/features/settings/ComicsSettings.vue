<script setup lang="ts">
import { onMounted } from 'vue'
import type { CbxReaderSettings } from '@projectx/types'
import { useReaderDefaultSettings } from '@/features/reader/composables/useReaderSettings'
import SettingsPageHeader from './SettingsPageHeader.vue'

const { effective, load, update, reset } = useReaderDefaultSettings<CbxReaderSettings>('cbx')

onMounted(load)
</script>

<template>
  <SettingsPageHeader title="Comics Reader" subtitle="Default settings applied when opening CBZ, CBR, and CB7 files.">
    <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
      Reset to defaults
    </button>
  </SettingsPageHeader>

  <!-- View -->
  <div class="mb-6">
    <p class="settings-group-label">View</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <!-- Scroll mode -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Reading mode</p>
          <p class="settings-hint">How pages are navigated</p>
        </div>
        <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="effective.scrollMode === 'paginated' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="update({ scrollMode: 'paginated' })"
          >
            Paginated
          </button>
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="effective.scrollMode === 'infinite' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="update({ scrollMode: 'infinite' })"
          >
            Infinite
          </button>
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="effective.scrollMode === 'long-strip' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="update({ scrollMode: 'long-strip' })"
          >
            Long strip
          </button>
        </div>
      </div>

      <!-- View mode -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Page view</p>
          <p class="settings-hint">Show one or two pages side by side</p>
        </div>
        <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="effective.viewMode === 'single' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="update({ viewMode: 'single' })"
          >
            Single
          </button>
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="effective.viewMode === 'two-page' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="update({ viewMode: 'two-page' })"
          >
            Two-page
          </button>
        </div>
      </div>

      <!-- Fit mode -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Fit mode</p>
          <p class="settings-hint">How pages are scaled to fit the screen</p>
        </div>
        <div class="flex flex-wrap justify-end gap-1.5">
          <button
            v-for="opt in [
              { id: 'fit-page' as const, label: 'Page' },
              { id: 'fit-width' as const, label: 'Width' },
              { id: 'fit-height' as const, label: 'Height' },
              { id: 'actual' as const, label: 'Actual' },
            ]"
            :key="opt.id"
            class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
            :class="
              effective.fitMode === opt.id
                ? 'border-primary text-primary bg-primary/8'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            "
            @click="update({ fitMode: opt.id })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Reading direction -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Reading direction</p>
          <p class="settings-hint">Left-to-right for western comics; right-to-left for manga</p>
        </div>
        <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="effective.direction === 'ltr' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="update({ direction: 'ltr' })"
          >
            L to R
          </button>
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="effective.direction === 'rtl' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="update({ direction: 'rtl' })"
          >
            R to L
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Display -->
  <div class="mb-6">
    <p class="settings-group-label">Display</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <!-- Background color -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Background color</p>
          <p class="settings-hint">Canvas color behind pages</p>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            v-for="opt in [
              { id: 'black' as const, label: 'Black' },
              { id: 'gray' as const, label: 'Gray' },
              { id: 'white' as const, label: 'White' },
            ]"
            :key="opt.id"
            class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
            :class="
              effective.bgColor === opt.id
                ? 'border-primary text-primary bg-primary/8'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            "
            @click="update({ bgColor: opt.id })"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
