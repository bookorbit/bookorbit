<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ role: string }>()
const { t } = useI18n()

/**
 * `supplement` and `cover` are real roles the scanner assigns and the old tab never showed, so a
 * folder looked like six interchangeable copies of the book when two of them are not copies at all.
 */
const ROLES: Record<string, { label: string; class: string }> = {
  primary: { label: 'book.detail.files.roles.primary', class: 'bg-primary/15 text-primary' },
  supplement: { label: 'book.detail.files.roles.supplement', class: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  cover: { label: 'book.detail.files.roles.cover', class: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
}

const role = computed(() => ROLES[props.role] ?? null)
</script>

<template>
  <span
    v-if="role"
    class="inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
    :class="role.class"
  >
    {{ t(role.label) }}
  </span>
</template>
