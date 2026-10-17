<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/** Column labels over a family ledger, on the same grid as FontFamilyRow and only where it is a grid. */
defineProps<{ useLabel: string }>()

const { t } = useI18n()
</script>

<template>
  <div
    aria-hidden="true"
    class="hidden grid-cols-[12rem_minmax(0,1fr)_8.75rem_9rem_2.25rem] gap-5 ps-[25px] pe-[21px] pt-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase @min-[60rem]:grid"
  >
    <span>{{ t('settings.admin.serverFonts.columns.family') }}</span>
    <span>{{ t('settings.admin.serverFonts.columns.specimen') }}</span>
    <span>{{ t('settings.admin.serverFonts.columns.styles') }}</span>
    <span>{{ useLabel }}</span>
  </div>
</template>
