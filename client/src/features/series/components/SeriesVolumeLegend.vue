<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const KEYS = ['read', 'reading', 'unread', 'missing'] as const
</script>

<template>
  <ul class="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-muted-foreground">
    <li v-for="key in KEYS" :key="key" class="flex items-center gap-1.5">
      <span class="legend-swatch h-2 w-3 shrink-0 rounded-[2px]" :data-status="key" aria-hidden="true" />
      {{ t(`series.legend.${key}`) }}
    </li>
  </ul>
</template>

<style scoped>
.legend-swatch {
  background: var(--volume-unread);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--foreground) 12%, transparent);
}

.legend-swatch[data-status='read'] {
  background: var(--volume-read);
  box-shadow: none;
}

.legend-swatch[data-status='reading'] {
  background: var(--volume-reading);
  box-shadow: none;
}

.legend-swatch[data-status='missing'] {
  background: repeating-linear-gradient(
    135deg,
    color-mix(in oklch, var(--volume-missing) 38%, transparent) 0 2px,
    color-mix(in oklch, var(--volume-missing) 7%, transparent) 2px 5px
  );
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--volume-missing) 50%, transparent);
}
</style>
