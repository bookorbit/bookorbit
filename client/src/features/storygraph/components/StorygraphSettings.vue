<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import StorygraphConnectionCard from '../components/StorygraphConnectionCard.vue'
import StorygraphLinkedBooks from '../components/StorygraphLinkedBooks.vue'
import StorygraphSyncProgress from '../components/StorygraphSyncProgress.vue'
import { useStorygraphSettings } from '../composables/useStorygraphSettings'
import { useStorygraphSync } from '../composables/useStorygraphSync'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { settings } = useStorygraphSettings()
const { fetchStatus, stopSyncTracking } = useStorygraphSync()

onMounted(async () => {
  await fetchStatus()
})

onUnmounted(() => {
  stopSyncTracking()
})
</script>

<template>
  <div class="space-y-6">
    <SettingsPageHeader v-if="!props.embedded" title="StoryGraph" subtitle="Sync your reading progress and status to The StoryGraph." />

    <StorygraphConnectionCard />

    <StorygraphSyncProgress v-if="settings?.cookiesConfigured" />
    <StorygraphLinkedBooks v-if="settings?.cookiesConfigured" />
  </div>
</template>
