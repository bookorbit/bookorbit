<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import type { AuditTargetView } from '../audit-display'

defineProps<{ target: AuditTargetView | null }>()
const { t } = useI18n()
</script>

<template>
  <span v-if="!target" class="text-muted-foreground" :aria-label="t('audit.target.none')">-</span>
  <span v-else class="min-w-0">
    <span :class="target.unnamed || target.typeOnly ? 'text-muted-foreground' : 'text-foreground'">{{ target.name }}</span>
    <span v-if="target.more > 0" class="ms-1.5 whitespace-nowrap text-xs text-muted-foreground">{{
      t('audit.target.more', { count: formatNumber(target.more) })
    }}</span>
    <span
      v-if="target.gone === 'since'"
      class="ms-1.5 inline-flex items-center whitespace-nowrap rounded-full px-1.5 align-[1px] text-[11px] leading-4 font-medium text-muted-foreground ring-1 ring-border ring-inset"
      >{{ t('audit.target.sinceDeleted') }}</span
    >
  </span>
</template>
