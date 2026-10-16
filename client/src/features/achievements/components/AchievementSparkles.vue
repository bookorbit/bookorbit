<script setup lang="ts">
import type { AchievementRarity } from '@bookorbit/types'

defineProps<{
  rarity: AchievementRarity
}>()

// Positions (percent of the box), size in px, delay in s. Fixed so the composition is the same every time.
const SPARKS = [
  [4, 14, 18, 0],
  [84, 4, 12, 0.7],
  [92, 52, 16, 1.4],
  [-2, 66, 11, 2.1],
  [72, 88, 13, 0.4],
  [26, -4, 10, 1.8],
  [50, 96, 8, 2.6],
] as const
</script>

<template>
  <span class="pointer-events-none absolute inset-0" aria-hidden="true">
    <svg
      v-for="([x, y, size, delay], index) in SPARKS"
      :key="index"
      class="achievement-spark absolute"
      :class="`achievement-spark--${rarity}`"
      :style="{ left: `${x}%`, top: `${y}%`, width: `${size}px`, height: `${size}px`, animationDelay: `${delay}s` }"
      viewBox="0 0 10 10"
    >
      <path d="M5 0C5.3 3.4 6.6 4.7 10 5 6.6 5.3 5.3 6.6 5 10 4.7 6.6 3.4 5.3 0 5 3.4 4.7 4.7 3.4 5 0Z" fill="currentColor" />
    </svg>
  </span>
</template>

<style>
/* Three twinkles after mount, then rest; hovering the medal they surround plays them again. */
.achievement-spark {
  opacity: 0;
  animation: achievement-spark 2.8s ease-in-out 3;
}

.achievement-medal-trigger:hover .achievement-spark {
  animation: achievement-spark-again 2.8s ease-in-out 2;
}

/* Highlight-bright sparks on a dark ground, body-tone ones on a light ground where white would vanish. */
.achievement-spark--common {
  color: var(--medal-common-highlight);
}
.achievement-spark--rare {
  color: var(--medal-rare-highlight);
}
.achievement-spark--epic {
  color: var(--medal-epic-highlight);
}
.achievement-spark--legendary {
  color: var(--medal-legendary-highlight);
}
:root:not(.dark) .achievement-spark--common {
  color: var(--medal-common-body);
}
:root:not(.dark) .achievement-spark--rare {
  color: var(--medal-rare-body);
}
:root:not(.dark) .achievement-spark--epic {
  color: var(--medal-epic-body);
}
:root:not(.dark) .achievement-spark--legendary {
  color: var(--medal-legendary-body);
}

@keyframes achievement-spark {
  0%,
  100% {
    opacity: 0;
    transform: scale(0.4) rotate(0deg);
  }
  45% {
    opacity: 1;
    transform: scale(1) rotate(45deg);
  }
  70% {
    opacity: 0.2;
    transform: scale(0.7) rotate(70deg);
  }
}

@keyframes achievement-spark-again {
  0%,
  100% {
    opacity: 0;
    transform: scale(0.4) rotate(0deg);
  }
  45% {
    opacity: 1;
    transform: scale(1) rotate(45deg);
  }
  70% {
    opacity: 0.2;
    transform: scale(0.7) rotate(70deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .achievement-spark,
  .achievement-medal-trigger:hover .achievement-spark {
    animation: none;
    opacity: 0.7;
  }
}
</style>
