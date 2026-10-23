<script setup lang="ts">
import { computed } from 'vue'
import { ENDPAPER_TILES, type Endpaper } from '../lib/endpapers'

// `scale` shrinks the repeat for previews, so a small swatch still shows several whole tiles.
const props = withDefaults(defineProps<{ pattern: Endpaper; scale?: number }>(), { scale: 1 })

const tile = computed(() => ENDPAPER_TILES[props.pattern])
const tileStyle = computed(() => {
  if (!tile.value) return undefined
  const size = `${tile.value.width * props.scale}px ${tile.value.height * props.scale}px`
  return { maskImage: tile.value.mask, WebkitMaskImage: tile.value.mask, maskSize: size, WebkitMaskSize: size }
})
const fanStyle = computed(() => (props.pattern === 'seigaiha' ? { backgroundSize: `${64 * props.scale}px ${32 * props.scale}px` } : undefined))
</script>

<template>
  <div class="relative bg-(--endpaper)" :class="{ 'auth-seigaiha': pattern === 'seigaiha' }" :style="fanStyle">
    <div v-if="tile" class="auth-tile absolute inset-0 bg-(--endpaper-ink)" :style="tileStyle" aria-hidden="true" />
    <slot />
  </div>
</template>

<style scoped>
.auth-tile {
  mask-repeat: repeat;
  -webkit-mask-repeat: repeat;
}

/* Seigaiha fans overlap, which a one-colour mask cannot draw, so they are painted with gradients. */
.auth-seigaiha {
  --a: var(--endpaper);
  --b: var(--endpaper-ink);
  background-color: var(--a);
  background-image:
    radial-gradient(circle at 100% 150%, var(--a) 24%, var(--b) 24% 28%, var(--a) 28% 36%, var(--b) 36% 40%, transparent 40%),
    radial-gradient(circle at 0 150%, var(--a) 24%, var(--b) 24% 28%, var(--a) 28% 36%, var(--b) 36% 40%, transparent 40%),
    radial-gradient(
      circle at 50% 100%,
      var(--b) 10%,
      var(--a) 10% 23%,
      var(--b) 23% 30%,
      var(--a) 30% 43%,
      var(--b) 43% 50%,
      var(--a) 50% 63%,
      var(--b) 63% 71%,
      transparent 71%
    ),
    radial-gradient(
      circle at 100% 50%,
      var(--b) 5%,
      var(--a) 5% 15%,
      var(--b) 15% 20%,
      var(--a) 20% 29%,
      var(--b) 29% 34%,
      var(--a) 34% 44%,
      var(--b) 44% 49%,
      transparent 49%
    ),
    radial-gradient(
      circle at 0 50%,
      var(--b) 5%,
      var(--a) 5% 15%,
      var(--b) 15% 20%,
      var(--a) 20% 29%,
      var(--b) 29% 34%,
      var(--a) 34% 44%,
      var(--b) 44% 49%,
      transparent 49%
    );
  background-size: 64px 32px;
}
</style>
