<script setup lang="ts">
defineProps<{ label: string; lines: readonly string[] }>()
</script>

<template>
  <span class="block">{{ label }}</span>
  <span v-for="line in lines" :key="line" class="block text-[11px]">{{ line }}</span>
</template>
