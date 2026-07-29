<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, ChartNoAxesCombined, Plug, Settings, Tags, UserRound } from '@lucide/vue'
import { getAuditResourceBadgeClass, getAuditResourceDomain, getAuditResourceLabelKey } from './audit-resources'

const props = defineProps<{ resource: string }>()
const { t } = useI18n()

const icon = computed(() => {
  const domain = getAuditResourceDomain(props.resource)
  if (domain === 'content') return BookOpen
  if (domain === 'people') return UserRound
  if (domain === 'metadata') return Tags
  if (domain === 'integrations') return Plug
  if (domain === 'settings') return Settings
  return ChartNoAxesCombined
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
    :class="getAuditResourceBadgeClass(props.resource)"
  >
    <component :is="icon" :size="12" aria-hidden="true" />
    {{ t(getAuditResourceLabelKey(props.resource)) }}
  </span>
</template>
