<script setup lang="ts">
import { computed } from 'vue'
import { highlightPattern, type PatternPiece } from '../lib/pattern-highlight'

const props = defineProps<{ pattern: string }>()

/** One definition of the grammar colours, shared by the editable field and the examples. */
const PIECE_CLASS: Record<PatternPiece['kind'], string> = {
  literal: 'text-foreground',
  token: 'font-semibold text-pattern-token',
  modifier: 'font-semibold text-pattern-modifier',
  optional: 'text-pattern-optional',
  fallback: 'font-semibold text-pattern-fallback',
  separator: 'font-bold text-muted-foreground',
}

const pieces = computed(() => highlightPattern(props.pattern))
</script>

<template>
  <span
    ><span v-for="(piece, index) in pieces" :key="index" :class="PIECE_CLASS[piece.kind]">{{ piece.text }}</span></span
  >
</template>
