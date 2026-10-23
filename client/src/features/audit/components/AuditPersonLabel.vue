<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot } from '@lucide/vue'
import UserAvatar from '@/components/UserAvatar.vue'
import type { AuditPerson } from '../audit-display'

const props = withDefaults(defineProps<{ person: AuditPerson; size?: 'xs' | 'sm' | 'md'; showMeta?: boolean; quiet?: boolean }>(), {
  size: 'sm',
  showMeta: true,
  quiet: false,
})
const { t } = useI18n()

const boxClass = computed(
  () => ({ xs: 'size-4 rounded-[4px] text-[9px]', sm: 'size-[22px] rounded-sm text-[10px]', md: 'size-8 rounded-sm text-[11px]' })[props.size],
)
const iconSize = computed(() => ({ xs: 10, sm: 13, md: 18 })[props.size])
const displayName = computed(() => (props.person.kind === 'system' ? t('audit.person.system') : props.person.name))
const initial = computed(() => props.person.name.trim().slice(0, 1).toUpperCase() || '?')
</script>

<template>
  <span class="inline-flex min-w-0 max-w-full items-center gap-2">
    <span
      v-if="person.kind === 'system'"
      class="inline-grid shrink-0 place-items-center bg-muted text-muted-foreground ring-1 ring-border ring-inset"
      :class="boxClass"
      aria-hidden="true"
    >
      <Bot :size="iconSize" />
    </span>
    <span
      v-else-if="person.kind === 'deleted'"
      class="inline-grid shrink-0 place-items-center font-semibold text-muted-foreground outline-1 -outline-offset-1 outline-dashed outline-muted-foreground/55"
      :class="boxClass"
      aria-hidden="true"
    >
      {{ initial }}
    </span>
    <span v-else class="inline-flex shrink-0" :class="boxClass" aria-hidden="true">
      <UserAvatar :name="person.name" size-class="size-full" text-class="font-semibold" />
    </span>
    <span
      class="min-w-0 truncate"
      :class="quiet ? 'text-muted-foreground' : 'font-medium text-foreground'"
      :title="person.kind === 'deleted' ? t('audit.person.deleted') : undefined"
      >{{ displayName }}</span
    >
    <span v-if="person.kind === 'deleted'" :class="showMeta ? 'shrink-0 text-xs text-muted-foreground' : 'sr-only'">{{
      t('audit.person.deleted')
    }}</span>
  </span>
</template>
