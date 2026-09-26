<script setup lang="ts">
withDefaults(
  defineProps<{
    src: string
    alt?: string
    loading?: 'lazy' | 'eager'
  }>(),
  {
    alt: '',
    loading: 'lazy',
  },
)
</script>

<template>
  <span class="relative isolate block h-full w-full overflow-hidden rounded-[inherit] bg-muted">
    <img
      :src="src"
      alt=""
      aria-hidden="true"
      class="absolute inset-0 h-full w-full scale-125 object-cover blur-xl brightness-75 motion-reduce:transition-none"
      :loading="loading"
      decoding="async"
    />
    <img :src="src" :alt="alt" class="relative z-10 h-full w-full object-contain motion-reduce:transition-none" :loading="loading" decoding="async" />
  </span>
</template>
