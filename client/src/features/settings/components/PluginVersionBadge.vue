<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ version?: string }>()

const { t } = useI18n()

const accessibleLabel = computed(() =>
  props.version
    ? t('settings.system.requests.indexers.plugins.versionLabel', { version: props.version })
    : t('settings.system.requests.indexers.plugins.versionUnknown'),
)
</script>

<template>
  <span class="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground" :aria-label="accessibleLabel" :title="accessibleLabel">
    v{{ version ?? '?' }}
  </span>
</template>
