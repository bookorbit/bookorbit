<script setup lang="ts">
import { computed } from 'vue'
import { ShieldCheck } from '@lucide/vue'

import { formatNumber } from '@/i18n/formatters'
import { accessTier } from '../lib/access-tier'
import StatusPill from './StatusPill.vue'

const props = defineProps<{ user: { isSuperuser: boolean; permissions?: string[] | null } }>()

const tier = computed(() => accessTier(props.user))
const grantedCount = computed(() => props.user.permissions?.length ?? 0)
/** The count only earns its place where the tier name alone leaves the question open. */
const showsCount = computed(() => tier.value === 'admin' || tier.value === 'custom')
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <StatusPill v-if="tier === 'superuser'" tone="accent">
      <ShieldCheck :size="11" aria-hidden="true" />
      {{ $t('adminFeature.usersPage.accessTier.superuser') }}
    </StatusPill>
    <StatusPill v-else-if="tier === 'admin'" tone="accent">{{ $t('adminFeature.usersPage.accessTier.admin') }}</StatusPill>
    <span v-else-if="tier === 'none'" class="text-sm text-muted-foreground">{{ $t('adminFeature.usersPage.accessTier.none') }}</span>
    <span v-else class="text-sm font-medium text-foreground">{{ $t(`adminFeature.usersPage.accessTier.${tier}`) }}</span>
    <span v-if="showsCount" class="text-xs tabular-nums text-muted-foreground">{{ formatNumber(grantedCount) }}</span>
  </span>
</template>
