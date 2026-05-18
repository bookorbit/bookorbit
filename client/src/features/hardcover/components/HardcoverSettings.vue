<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import HardcoverConnectionCard from '../components/HardcoverConnectionCard.vue'
import HardcoverSyncProgress from '../components/HardcoverSyncProgress.vue'
import { useHardcoverSettings } from '../composables/useHardcoverSettings'
import { useHardcoverSync } from '../composables/useHardcoverSync'

const { settings } = useHardcoverSettings()
const { fetchStatus, stopSyncTracking } = useHardcoverSync()

onMounted(async () => {
  await fetchStatus()
})

onUnmounted(() => {
  stopSyncTracking()
})
</script>

<template>
  <div class="space-y-6">
    <SettingsPageHeader title="Hardcover" subtitle="Sync your reading progress, status, and ratings to Hardcover." />

    <HardcoverConnectionCard />

    <HardcoverSyncProgress v-if="settings?.tokenConfigured" />
  </div>
</template>
