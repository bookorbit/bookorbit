<script setup lang="ts">
defineProps<{
  titleId: string
  title: string
  count?: number | null
  hint?: string
}>()
</script>

<template>
  <div class="flex min-h-8 items-end justify-between gap-4">
    <div class="min-w-0">
      <h3 :id="titleId" class="settings-group-label mb-0">
        {{ title
        }}<span v-if="count !== undefined && count !== null" class="ms-1.5 font-medium tracking-normal text-muted-foreground normal-case">{{
          count
        }}</span>
      </h3>
      <p v-if="hint" class="mt-0.5 max-w-[100ch] text-xs leading-4 text-muted-foreground">{{ hint }}</p>
    </div>
    <slot />
  </div>
</template>
