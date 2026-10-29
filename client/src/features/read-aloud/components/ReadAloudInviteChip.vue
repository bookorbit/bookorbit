<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ReadAloudSparkles from './ReadAloudSparkles.vue'

const emit = defineEmits<{ create: [] }>()

const { t } = useI18n()

function handleClick() {
  emit('create')
}
</script>

<template>
  <button
    type="button"
    data-test="read-aloud-chip"
    class="inline-flex items-center gap-1 rounded-xs border border-dashed border-primary/60 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :title="t('book.detail.details.readAloudInvite.title')"
    @click="handleClick"
  >
    <ReadAloudSparkles class="size-3 text-primary" />
    {{ t('book.detail.details.readAloudInvite.chip') }}
  </button>
</template>
