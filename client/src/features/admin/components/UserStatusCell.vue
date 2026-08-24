<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, KeyRound, Lock, ShieldAlert } from '@lucide/vue'

import { relativeTimestamp } from '../lib/relative-time'
import type { UserRow } from '../composables/useUsers'
import StatusPill from './StatusPill.vue'

const props = defineProps<{ user: UserRow }>()

const { t } = useI18n()

const isLocked = computed(() => Boolean(props.user.lockedUntil && new Date(props.user.lockedUntil).getTime() > Date.now()))

/**
 * One chip for the state, one line for the thing an administrator has to act on. Keeping the
 * reason out of the chip is what lets a single column say "active, but still on the password
 * it was created with" instead of two pills that say neither.
 */
const reason = computed<{ icon: typeof Clock; text: string } | null>(() => {
  if (isLocked.value) return { icon: Lock, text: t('adminFeature.usersPage.status.unlocksIn', { when: relativeTimestamp(props.user.lockedUntil!) }) }
  if (!props.user.active) return null
  if (props.user.lastAuthenticatedAt === null) return { icon: Clock, text: t('adminFeature.usersPage.status.neverSignedIn') }
  if (props.user.isDefaultPassword) return { icon: KeyRound, text: t('adminFeature.usersPage.status.defaultPassword') }
  if (props.user.hasContentFilters) return { icon: ShieldAlert, text: t('adminFeature.usersPage.status.contentFiltered') }
  return null
})
</script>

<template>
  <div class="flex flex-col items-start gap-1">
    <StatusPill v-if="isLocked" tone="warning">
      <Lock :size="11" aria-hidden="true" />
      {{ t('adminFeature.usersPage.statusLocked') }}
    </StatusPill>
    <StatusPill v-else-if="user.active" tone="success">
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {{ t('adminFeature.usersPage.statusActive') }}
    </StatusPill>
    <StatusPill v-else tone="neutral">
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {{ t('adminFeature.usersPage.statusInactive') }}
    </StatusPill>
    <span v-if="reason" class="flex items-center gap-1.5 text-xs text-[var(--pill-warning)]">
      <component :is="reason.icon" :size="11" aria-hidden="true" />
      {{ reason.text }}
    </span>
  </div>
</template>
