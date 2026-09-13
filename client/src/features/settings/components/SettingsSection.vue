<script setup lang="ts">
/** A named group of fields, so a long adapter form can be skimmed instead of read. */
defineProps<{ title: string; brief?: string }>()
</script>

<template>
  <section class="flex flex-col gap-3">
    <div>
      <h3 class="settings-group-label mb-0">{{ title }}</h3>
      <p v-if="brief" class="settings-hint">{{ brief }}</p>
    </div>
    <div class="flex flex-col gap-4">
      <slot />
    </div>
  </section>
</template>
