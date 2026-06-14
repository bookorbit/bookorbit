<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  texts: string[]
  origins: { origin: string; label: string; class: string; count: number }[]
  activeOrigin?: string | null
}>()

const emit = defineEmits<{ originClick: [origin: string] }>()

const PILL_CLASS = 'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium transition-colors'

const interactive = computed(() => props.activeOrigin !== undefined)

function handleOriginClick(origin: string) {
  emit('originClick', origin)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
    <span v-for="text in texts" :key="text">{{ text }}</span>
    <span v-if="texts.length > 0 && origins.length > 0" class="h-4 w-px bg-border" />
    <template v-for="origin in origins" :key="origin.origin">
      <button
        v-if="interactive"
        type="button"
        :aria-pressed="activeOrigin === origin.origin"
        :class="[PILL_CLASS, origin.class, activeOrigin === origin.origin ? 'ring-1 ring-primary' : 'hover:opacity-80']"
        @click="handleOriginClick(origin.origin)"
      >
        {{ origin.label }} {{ origin.count }}
      </button>
      <span v-else :class="[PILL_CLASS, origin.class]">{{ origin.label }} {{ origin.count }}</span>
    </template>
  </div>
</template>
