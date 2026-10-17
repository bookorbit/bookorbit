<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, Globe, House, Minus, Server } from '@lucide/vue'
import type { AuditSourceKind } from '../audit-display'

const props = withDefaults(defineProps<{ kind: AuditSourceKind; ip: string | null; showIp?: boolean }>(), { showIp: true })
const { t } = useI18n()

const icon = computed(() => ({ server: Server, local: House, internet: Globe, job: Bot, unknown: Minus })[props.kind])
const quiet = computed(() => props.kind === 'job' || props.kind === 'unknown')
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
    <component :is="icon" :size="13" class="shrink-0" aria-hidden="true" />
    <span :class="quiet ? 'text-muted-foreground' : 'text-foreground'">{{ t(`audit.source.${kind}`) }}</span>
    <span v-if="showIp && ip" class="truncate font-mono text-xs @max-[77rem]:hidden">{{ ip }}</span>
  </span>
</template>
