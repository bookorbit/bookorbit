<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Skeleton } from '@/components/ui/skeleton'

/** Placeholder rows for a list that has never loaded, announced so a screen reader knows to wait. */
withDefaults(defineProps<{ rows?: number; label?: string }>(), { rows: 6, label: undefined })

const { t } = useI18n()
</script>

<template>
  <div class="space-y-2.5" role="status" aria-live="polite">
    <span class="sr-only">{{ label ?? t('common.loading') }}</span>
    <Skeleton v-for="index in rows" :key="index" class="h-24 w-full rounded-xl" />
  </div>
</template>
