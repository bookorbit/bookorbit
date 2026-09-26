<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useLegalNotices } from './useLegalNotices'

const { t } = useI18n()
const { openLegalNotices } = useLegalNotices()

const PROJECT_URL = 'https://github.com/bookorbit/bookorbit'
</script>

<template>
  <div class="relative z-10 flex items-center justify-center gap-1.5 text-[11px] text-foreground">
    <a
      :href="PROJECT_URL"
      target="_blank"
      rel="noopener noreferrer"
      class="rounded-sm outline-hidden underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {{ t('components.legalNotices.poweredBy') }}
    </a>
    <span aria-hidden="true">·</span>
    <button
      type="button"
      class="rounded-sm outline-hidden underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      @click="openLegalNotices"
    >
      {{ t('components.legalNotices.trigger') }}
    </button>
  </div>
</template>
