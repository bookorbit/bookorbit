<script setup lang="ts">
import { onMounted } from 'vue'
import type { CbxReaderSettings } from '@projectx/types'
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

const { effective, load, update, reset } = useReaderDefaultSettings<CbxReaderSettings>('cbx')

onMounted(load)
</script>

<template>
  <div
    class="[&_.settings-hint]:overflow-hidden [&_.settings-hint]:text-ellipsis [&_.settings-hint]:whitespace-nowrap md:[&_.settings-hint]:overflow-visible md:[&_.settings-hint]:whitespace-normal"
  >
    <SettingsPageHeader v-if="!props.embedded" title="Comics Reader" subtitle="Default settings applied when opening CBZ, CBR, and CB7 files.">
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

    <!-- View -->
    <div class="mb-6">
      <p class="settings-group-label">View</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Scroll mode -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Reading mode</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              How pages are navigated
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.scrollMode === 'paginated' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ scrollMode: 'paginated' })"
            >
              Paginated
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.scrollMode === 'infinite' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ scrollMode: 'infinite' })"
            >
              Infinite
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.scrollMode === 'long-strip' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ scrollMode: 'long-strip' })"
            >
              Long strip
            </button>
          </div>
        </div>

        <!-- View mode -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Page view</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Show one or two pages side by side
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.viewMode === 'single' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ viewMode: 'single' })"
            >
              Single
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.viewMode === 'two-page' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ viewMode: 'two-page' })"
            >
              Two-page
            </button>
          </div>
        </div>

        <!-- Fit mode -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Fit mode</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              How pages are scaled to fit the screen
            </p>
          </div>
          <div class="flex flex-wrap gap-2 self-start md:self-auto md:justify-end">
            <button
              v-for="opt in [
                { id: 'fit-page' as const, label: 'Page' },
                { id: 'fit-width' as const, label: 'Width' },
                { id: 'fit-height' as const, label: 'Height' },
                { id: 'actual' as const, label: 'Actual' },
              ]"
              :key="opt.id"
              class="h-8 md:h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
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
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Reading direction</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Left-to-right for western comics; right-to-left for manga
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.direction === 'ltr' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ direction: 'ltr' })"
            >
              L to R
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.direction === 'rtl' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ direction: 'rtl' })"
            >
              R to L
            </button>
          </div>
        </div>

        <!-- Spread alignment -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Spread alignment</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Shift pairing by one page after the cover for off-by-one scans
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.spreadAlignment === 'normal' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ spreadAlignment: 'normal' })"
            >
              Normal
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.spreadAlignment === 'shifted' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ spreadAlignment: 'shifted' })"
            >
              Shifted
            </button>
          </div>
        </div>

        <!-- Wide page handling -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Wide-page handling</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Auto shows wide scans alone in two-page paginated mode
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.widePageSingletonMode === 'auto' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ widePageSingletonMode: 'auto' })"
            >
              Auto
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.widePageSingletonMode === 'disable'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ widePageSingletonMode: 'disable' })"
            >
              Disable
            </button>
          </div>
        </div>

        <!-- Force two-page -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Force two-page on small screens</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Bypass mobile auto-fallback when paginated two-page mode is selected
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="!effective.forceTwoPage ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ forceTwoPage: false })"
            >
              Off
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.forceTwoPage ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ forceTwoPage: true })"
            >
              On
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
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Background color</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              Canvas color behind pages
            </p>
          </div>
          <div class="flex flex-wrap gap-2 self-start">
            <button
              v-for="opt in [
                { id: 'black' as const, label: 'Black' },
                { id: 'gray' as const, label: 'Gray' },
                { id: 'white' as const, label: 'White' },
              ]"
              :key="opt.id"
              class="h-8 md:h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
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
  </div>
</template>
