<script setup lang="ts">
defineProps<{
  label: string
  labelId?: string
  flush?: boolean
}>()
</script>

<template>
  <section class="rounded-xl border border-border bg-card" :class="flush ? 'overflow-hidden' : 'px-4 pb-4 pt-3.5'" :aria-labelledby="labelId">
    <div class="flex items-center gap-2.5" :class="flush ? 'px-4 pb-2.5 pt-3' : 'mb-3'">
      <h4 :id="labelId" class="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{{ label }}</h4>
      <div v-if="$slots.meta" class="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <slot name="meta" />
      </div>
    </div>
    <slot />
  </section>
</template>
