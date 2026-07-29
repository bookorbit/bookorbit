<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, BookOpen, Boxes, Library, Plug, Settings, ShieldCheck, Users } from '@lucide/vue'
import type { AuditCategory } from './audit-display'

const props = defineProps<{ category: AuditCategory }>()
const { t } = useI18n()

const categoryClass = computed(() => {
  if (props.category === 'authentication') {
    return 'border-[var(--audit-authentication)]/40 bg-[var(--audit-authentication)]/10 text-[var(--audit-authentication)]'
  }
  if (props.category === 'books') return 'border-[var(--audit-books)]/40 bg-[var(--audit-books)]/10 text-[var(--audit-books)]'
  if (props.category === 'users') return 'border-[var(--audit-users)]/40 bg-[var(--audit-users)]/10 text-[var(--audit-users)]'
  if (props.category === 'libraries') return 'border-[var(--audit-libraries)]/40 bg-[var(--audit-libraries)]/10 text-[var(--audit-libraries)]'
  if (props.category === 'collections') {
    return 'border-[var(--audit-collections)]/40 bg-[var(--audit-collections)]/10 text-[var(--audit-collections)]'
  }
  if (props.category === 'integrations') {
    return 'border-[var(--audit-integrations)]/40 bg-[var(--audit-integrations)]/10 text-[var(--audit-integrations)]'
  }
  if (props.category === 'settings') return 'border-[var(--audit-settings)]/40 bg-[var(--audit-settings)]/10 text-[var(--audit-settings)]'
  return 'border-border bg-muted text-muted-foreground'
})

const icon = computed(() => {
  if (props.category === 'authentication') return ShieldCheck
  if (props.category === 'books') return BookOpen
  if (props.category === 'users') return Users
  if (props.category === 'libraries') return Library
  if (props.category === 'collections') return Boxes
  if (props.category === 'integrations') return Plug
  if (props.category === 'settings') return Settings
  return Activity
})
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" :class="categoryClass">
    <component :is="icon" :size="12" aria-hidden="true" />
    {{ t(`audit.categories.${category}`) }}
  </span>
</template>
