<script setup lang="ts">
import { Sparkles } from '@lucide/vue'
</script>

<template>
  <Sparkles class="read-aloud-sparkles" aria-hidden="true" />
</template>

<style scoped>
.read-aloud-sparkles :deep(path:nth-of-type(n + 2)),
.read-aloud-sparkles :deep(circle) {
  transform-box: fill-box;
  transform-origin: center;
  animation: read-aloud-twinkle 2.6s ease-in-out infinite;
}

.read-aloud-sparkles :deep(circle) {
  animation-delay: 0.9s;
}

.read-aloud-sparkles :deep(path:nth-of-type(3)) {
  animation-delay: 0.45s;
}

@keyframes read-aloud-twinkle {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.6);
  }
}

@media (prefers-reduced-motion: reduce) {
  .read-aloud-sparkles :deep(path),
  .read-aloud-sparkles :deep(circle) {
    animation: none;
  }
}
</style>
