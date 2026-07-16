<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import HardcoverConnectionCard from '../components/HardcoverConnectionCard.vue'
import HardcoverImportStatus from '../components/HardcoverImportStatus.vue'
import HardcoverSyncProgress from '../components/HardcoverSyncProgress.vue'
import { useHardcoverSettings } from '../composables/useHardcoverSettings'
import { useHardcoverSync } from '../composables/useHardcoverSync'

const { t } = useI18n()

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

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
    <SettingsPageHeader v-if="!props.embedded" title="Hardcover" :subtitle="t('hardcover.settings.subtitle')" />

    <HardcoverConnectionCard />

    <HardcoverSyncProgress v-if="settings?.tokenConfigured" />

    <HardcoverImportStatus v-if="settings?.tokenConfigured" />
  </div>
</template>
