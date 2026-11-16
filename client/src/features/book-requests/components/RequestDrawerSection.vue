<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <!-- A rule between sections, except straight after the status card, which is boundary enough. -->
  <section class="mt-6 border-t border-border pt-5 [[data-status-card]+&]:border-t-0 [[data-status-card]+&]:pt-0">
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h3 class="text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">{{ title }}</h3>
      <slot name="aside" />
    </div>
    <slot />
  </section>
</template>
