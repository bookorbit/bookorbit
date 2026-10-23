<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { KoreaderCredentials, KoreaderDeviceInfo, KoreaderDeviceSweepInfo } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ReadAloudDeliverySelect from '@/features/delivery/components/ReadAloudDeliverySelect.vue'
import { useKoreaderDeliverySettings } from '@/features/koreader/composables/useKoreaderDeliverySettings'

const props = defineProps<{ credentials: KoreaderCredentials | null; devices: KoreaderDeviceInfo[]; sweeps: KoreaderDeviceSweepInfo[] }>()
const emit = defineEmits<{ updated: [] }>()
const { t } = useI18n()
const devices = computed(() => [
  ...new Map([...props.devices, ...props.sweeps].filter((device) => device.retiredAt === null).map((device) => [device.deviceId, device])).values(),
])
const { defaultDraft, deviceDrafts, saving, saved, error, defaultChanged, deviceChanged, save } = useKoreaderDeliverySettings(
  toRef(props, 'credentials'),
  devices,
  handleUpdated,
)
function handleUpdated() {
  emit('updated')
}
function saveDefault() {
  void save()
}
function saveDevice(deviceId: string) {
  void save(deviceId)
}
function deviceName(device: KoreaderDeviceInfo | KoreaderDeviceSweepInfo) {
  return 'device' in device ? device.device : device.deviceModel
}
</script>

<template>
  <div class="mb-8 space-y-3">
    <p class="settings-group-label">{{ t('delivery.readAloud.koreaderDefaultTitle') }}</p>
    <div class="settings-card">
      <div class="space-y-3 px-4 py-4 bg-card md:px-5">
        <ReadAloudDeliverySelect v-model="defaultDraft" :disabled="saving !== null" />
        <p class="settings-hint">{{ t('delivery.readAloud.koreaderDefaultHint') }}</p>
        <Button :disabled="saving !== null || !defaultChanged" @click="saveDefault">{{ t('common.save') }}</Button>
      </div>
      <div v-for="device in devices" :key="device.deviceId" role="group" :aria-label="deviceName(device)" class="space-y-3 px-4 py-4 bg-card md:px-5">
        <p class="settings-label">{{ deviceName(device) }}</p>
        <p class="settings-hint break-all">{{ device.deviceId }}</p>
        <ReadAloudDeliverySelect
          v-model="deviceDrafts[device.deviceId]"
          :disabled="saving !== null"
          :inherit-label="t('delivery.readAloud.koreaderUseDefault')"
        />
        <Button :disabled="saving !== null || !deviceChanged(device)" @click="saveDevice(device.deviceId)">{{ t('common.save') }}</Button>
      </div>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ t('delivery.readAloud.koreaderSaveFailed') }}</p>
    <p v-if="saved" role="status" class="text-sm text-muted-foreground">{{ t('delivery.readAloud.koreaderSaved') }}</p>
  </div>
</template>
