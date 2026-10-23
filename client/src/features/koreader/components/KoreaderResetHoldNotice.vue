<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from '@lucide/vue'
import type { KoreaderResetHeldDevice } from '@bookorbit/types'
import { formatPercent } from '@/i18n/formatters'

// Release is a callback rather than an event because a successful release refetches the holds,
// which unmounts this notice when it was the last one before an emitted event could be heard.
const props = defineProps<{
  held: KoreaderResetHeldDevice[]
  release: (deviceId: string) => Promise<boolean>
}>()

const { t } = useI18n()

const releasingDeviceIds = ref<string[]>([])
const failedReleaseDeviceIds = ref<string[]>([])

function isReleasing(deviceId: string): boolean {
  return releasingDeviceIds.value.includes(deviceId)
}

function hasReleaseFailed(deviceId: string): boolean {
  return failedReleaseDeviceIds.value.includes(deviceId)
}

// A held device is never at the start or the end, so rounding must not report it as 0% or 100%.
function heldPercent(percentage: number): string {
  const clamped = Math.max(0, Math.min(100, percentage))
  const shown = clamped > 0 && clamped < 1 ? 1 : clamped > 99 && clamped < 100 ? 99 : Math.round(clamped)
  return formatPercent(shown / 100)
}

async function handleRelease(deviceId: string) {
  if (isReleasing(deviceId)) return
  releasingDeviceIds.value = [...releasingDeviceIds.value, deviceId]
  failedReleaseDeviceIds.value = failedReleaseDeviceIds.value.filter((id) => id !== deviceId)
  try {
    const released = await props.release(deviceId).catch(() => false)
    // A button that re-enables with the hold still showing reads as nothing having happened.
    if (!released) failedReleaseDeviceIds.value = [...failedReleaseDeviceIds.value, deviceId]
  } finally {
    releasingDeviceIds.value = releasingDeviceIds.value.filter((id) => id !== deviceId)
  }
}
</script>

<template>
  <div role="status" class="flex flex-col gap-2">
    <div v-for="device in held" :key="device.deviceId" class="flex items-start gap-1.5" data-testid="koreader-reset-hold">
      <TriangleAlert class="mt-0.5 size-3 shrink-0 text-warning" aria-hidden="true" />
      <div class="min-w-0">
        <p class="text-[11px] text-warning">
          {{ t('book.detail.details.resetHoldNotice', { device: device.device, percent: heldPercent(device.percentage) }) }}
        </p>
        <button
          type="button"
          class="mt-0.5 rounded-xs text-[11px] text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"
          :disabled="isReleasing(device.deviceId)"
          @click="handleRelease(device.deviceId)"
        >
          {{ isReleasing(device.deviceId) ? t('book.detail.details.resetHoldReleasing') : t('book.detail.details.resetHoldRelease') }}
        </button>
        <p v-if="hasReleaseFailed(device.deviceId)" role="alert" class="text-[11px] text-destructive">
          {{ t('book.detail.details.resetHoldReleaseFailed') }}
        </p>
      </div>
    </div>
  </div>
</template>
