<script setup lang="ts">
import { ref } from 'vue'

const autoScan = ref(true)
const scanOnStartup = ref(true)
const watchForChanges = ref(false)
const scanInterval = ref('hourly')

const fileTypes = ref([
  { ext: 'epub', label: 'EPUB', enabled: true },
  { ext: 'pdf', label: 'PDF', enabled: true },
  { ext: 'cbz', label: 'CBZ', enabled: true },
  { ext: 'cbr', label: 'CBR', enabled: true },
  { ext: 'cb7', label: 'CB7', enabled: true },
  { ext: 'mobi', label: 'MOBI', enabled: true },
  { ext: 'azw3', label: 'AZW3', enabled: true },
])
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Scanner</h2>
      <p class="mt-1 text-sm text-muted-foreground">Configure when and how your libraries are scanned for new content.</p>
    </div>

    <!-- Schedule -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Schedule</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Automatic scanning</p>
            <p class="text-xs text-muted-foreground mt-0.5">Periodically scan libraries for new or changed files</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="autoScan ? 'bg-primary' : 'bg-muted'"
            @click="autoScan = !autoScan"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="autoScan ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card" :class="!autoScan ? 'opacity-40 pointer-events-none' : ''">
          <div>
            <p class="text-sm font-medium text-foreground">Scan interval</p>
            <p class="text-xs text-muted-foreground mt-0.5">How often to check all library folders</p>
          </div>
          <select
            v-model="scanInterval"
            class="text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="15min">Every 15 minutes</option>
            <option value="hourly">Every hour</option>
            <option value="6h">Every 6 hours</option>
            <option value="daily">Once a day</option>
            <option value="weekly">Once a week</option>
          </select>
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Scan on startup</p>
            <p class="text-xs text-muted-foreground mt-0.5">Run a scan automatically when the server starts</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="scanOnStartup ? 'bg-primary' : 'bg-muted'"
            @click="scanOnStartup = !scanOnStartup"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="scanOnStartup ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Watch for changes</p>
            <p class="text-xs text-muted-foreground mt-0.5">Detect new files instantly using filesystem events</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="watchForChanges ? 'bg-primary' : 'bg-muted'"
            @click="watchForChanges = !watchForChanges"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="watchForChanges ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- File types -->
    <div>
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Supported file types</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div v-for="type in fileTypes" :key="type.ext" class="flex items-center justify-between px-5 py-3.5 bg-card">
          <div class="flex items-center gap-3">
            <span class="text-xs font-mono font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase"> .{{ type.ext }} </span>
            <p class="text-sm text-foreground">{{ type.label }}</p>
          </div>
          <button
            class="w-9 h-5 rounded-full transition-colors relative shrink-0"
            :class="type.enabled ? 'bg-primary' : 'bg-muted'"
            @click="type.enabled = !type.enabled"
          >
            <div
              class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="type.enabled ? 'translate-x-4' : 'translate-x-0.5'"
            />
          </button>
        </div>
      </div>
    </div>

    <p class="mt-6 text-xs text-muted-foreground">Scanner configuration will be persisted in a future update.</p>
  </div>
</template>
