<script setup lang="ts">
import { ref } from 'vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'

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
  <SettingsPageHeader title="Scanner" subtitle="Configure when and how your libraries are scanned for new content." />

  <!-- Schedule -->
  <div class="mb-6">
    <p class="settings-group-label">Schedule</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Automatic scanning</p>
          <p class="settings-hint">Periodically scan libraries for new or changed files</p>
        </div>
        <ToggleSwitch v-model="autoScan" />
      </div>

      <div class="flex items-center justify-between px-5 py-4 bg-card" :class="!autoScan ? 'opacity-40 pointer-events-none' : ''">
        <div>
          <p class="settings-label">Scan interval</p>
          <p class="settings-hint">How often to check all library folders</p>
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
          <p class="settings-label">Scan on startup</p>
          <p class="settings-hint">Run a scan automatically when the server starts</p>
        </div>
        <ToggleSwitch v-model="scanOnStartup" />
      </div>

      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="settings-label">Watch for changes</p>
          <p class="settings-hint">Detect new files instantly using filesystem events</p>
        </div>
        <ToggleSwitch v-model="watchForChanges" />
      </div>
    </div>
  </div>

  <!-- File types -->
  <div>
    <p class="settings-group-label">Supported file types</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div v-for="type in fileTypes" :key="type.ext" class="flex items-center justify-between px-5 py-3.5 bg-card">
        <div class="flex items-center gap-3">
          <span class="text-xs font-mono font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase"> .{{ type.ext }} </span>
          <p class="text-sm text-foreground">{{ type.label }}</p>
        </div>
        <ToggleSwitch v-model="type.enabled" />
      </div>
    </div>
  </div>

  <p class="mt-6 text-xs text-muted-foreground">Scanner configuration will be persisted in a future update.</p>
</template>
