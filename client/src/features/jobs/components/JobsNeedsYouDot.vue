<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useJobsSummary } from '../composables/useJobsSummary'

/**
 * A dot on a phone menu button while jobs wait on the viewer, since the sidebar and its count sit
 * behind that button. Failures do not light it: they have nothing to answer.
 */
const props = withDefaults(defineProps<{ descriptionId: string; ring?: 'background' | 'shell' }>(), { ring: 'background' })

const { t } = useI18n()
const { summary } = useJobsSummary()

const count = computed(() => summary.value?.needsYou ?? 0)
const ringClass = computed(() => (props.ring === 'shell' ? 'ring-(--shell-surface)' : 'ring-background'))
</script>

<template>
  <template v-if="count > 0">
    <span class="pointer-events-none absolute end-1.5 top-1.5 size-2 rounded-full bg-primary ring-2" :class="ringClass" aria-hidden="true" />
    <span :id="descriptionId" hidden>{{ t('components.sidebar.jobs.needsYou', { count }) }}</span>
  </template>
</template>
