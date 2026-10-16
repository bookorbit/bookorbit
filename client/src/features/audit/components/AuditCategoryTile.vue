<script setup lang="ts">
import { computed } from 'vue'
import type { AuditCategory } from '@bookorbit/types'
import { AUDIT_CATEGORY_STYLE } from '../audit-display'

const props = withDefaults(defineProps<{ category: AuditCategory; size?: 'xs' | 'sm' | 'md' | 'lg' }>(), { size: 'sm' })

const style = computed(() => AUDIT_CATEGORY_STYLE[props.category])
const boxClass = computed(
  () => ({ xs: 'size-4 rounded-full', sm: 'size-6 rounded-sm', md: 'size-8 rounded-sm', lg: 'size-9 rounded-md' })[props.size],
)
const iconSize = computed(() => ({ xs: 10, sm: 13, md: 16, lg: 17 })[props.size])
</script>

<template>
  <span
    class="inline-grid shrink-0 place-items-center bg-[var(--c)]/12 text-[var(--c)] dark:bg-[var(--c)]/14"
    :class="boxClass"
    :style="{ '--c': style.color }"
    aria-hidden="true"
  >
    <component :is="style.icon" :size="iconSize" />
  </span>
</template>
