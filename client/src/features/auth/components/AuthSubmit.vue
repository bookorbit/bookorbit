<script setup lang="ts">
import { ArrowRight, LoaderCircle } from '@lucide/vue'

withDefaults(defineProps<{ label: string; loadingLabel: string; loading?: boolean; disabled?: boolean }>(), { loading: false, disabled: false })
</script>

<template>
  <button
    type="submit"
    class="group mt-2.5 flex h-10 w-full items-center justify-center gap-2 rounded-[3px] bg-primary px-4 text-sm font-semibold tracking-[0.02em] text-primary-foreground shadow-sm transition-[filter,transform] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--plate) focus-visible:outline-none active:translate-y-px disabled:cursor-progress disabled:saturate-[0.85] disabled:hover:brightness-100 disabled:active:translate-y-0"
    :disabled="loading || disabled"
    :aria-busy="loading || undefined"
  >
    <template v-if="loading">
      <LoaderCircle :size="16" class="animate-spin" aria-hidden="true" />
      <span>{{ loadingLabel }}</span>
    </template>
    <template v-else>
      <span>{{ label }}</span>
      <ArrowRight
        :size="16"
        class="transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
        aria-hidden="true"
      />
    </template>
  </button>
</template>
