<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { INVITATION_LIFETIMES_MINUTES, type InvitationLifetimeMinutes } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatNumber } from '@/i18n/formatters'
import { useInvitationLifetime } from '../composables/useInvitationLifetime'

const { t } = useI18n()
const { saved, draft, busy, status, load, save } = useInvitationLifetime()
onMounted(load)

const units = {
  15: [15, 'minute'],
  1440: [24, 'hour'],
  10080: [7, 'day'],
} as const satisfies Record<InvitationLifetimeMinutes, [number, string]>

function durationLabel(minutes: InvitationLifetimeMinutes) {
  const [value, unit] = units[minutes]
  return formatNumber(value, { style: 'unit', unit, unitDisplay: 'long' })
}
</script>

<template>
  <section class="space-y-3 rounded-lg border border-border bg-card p-4 shadow-xs">
    <div>
      <label for="invitation-lifetime" class="settings-label">{{ t('adminFeature.usersPage.invitationLifetime.label') }}</label>
      <p id="invitation-lifetime-hint" class="settings-hint">{{ t('adminFeature.usersPage.invitationLifetime.hint') }}</p>
    </div>
    <div v-if="saved !== null" class="flex flex-wrap items-center gap-2">
      <Select id="invitation-lifetime" v-model="draft" aria-describedby="invitation-lifetime-hint" :disabled="busy" class="w-auto">
        <option v-for="minutes in INVITATION_LIFETIMES_MINUTES" :key="minutes" :value="minutes">{{ durationLabel(minutes) }}</option>
      </Select>
      <Button type="button" size="sm" variant="outline" :disabled="busy || saved === draft" @click="save">{{ t('common.save') }}</Button>
    </div>
    <p v-if="status === 'loadError' || status === 'saveError'" role="alert" class="text-sm text-destructive">
      {{ t(`adminFeature.usersPage.invitationLifetime.${status}`) }}
    </p>
    <Button v-if="status === 'loadError'" type="button" size="sm" variant="outline" @click="load">{{ t('common.retry') }}</Button>
    <p role="status" class="sr-only">{{ status === 'saved' ? t('adminFeature.usersPage.invitationLifetime.saved') : '' }}</p>
  </section>
</template>
