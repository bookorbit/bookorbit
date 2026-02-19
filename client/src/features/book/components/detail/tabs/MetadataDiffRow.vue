<script setup lang="ts">
import { ArrowLeft, Check, RotateCcw } from 'lucide-vue-next'
import type { DiffField, DiffFieldKey } from '../../../composables/useMetadataDiff'
import { hideOnError } from '../../../lib/metadata-fetch'

defineProps<{ field: DiffField }>()
defineEmits<{ toggle: [DiffFieldKey] }>()
</script>

<template>
  <!-- Cover row -->
  <div v-if="field.isCover" class="grid grid-cols-[1fr_40px_1fr] gap-2 py-3 border-b border-border/50 items-center">
    <div class="space-y-1">
      <p class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{{ field.label }}</p>
      <div
        class="w-16 rounded overflow-hidden bg-muted transition-colors"
        :class="field.isCopied ? 'ring-2 ring-primary' : ''"
        style="aspect-ratio: 2/3"
      >
        <img
          v-if="field.isCopied"
          :src="field.candidateDisplay"
          class="w-full h-full object-cover"
          @error="hideOnError"
        />
      </div>
    </div>

    <div class="flex justify-center">
      <button
        class="size-7 rounded-full flex items-center justify-center transition-colors"
        :class="
          field.isCopied
            ? 'bg-primary text-primary-foreground hover:bg-primary/80'
            : 'bg-muted hover:bg-muted-foreground/20 text-muted-foreground'
        "
        @click="$emit('toggle', field.key)"
      >
        <RotateCcw v-if="field.isCopied" class="size-3" />
        <ArrowLeft v-else class="size-3" />
      </button>
    </div>

    <div class="space-y-1">
      <p class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground opacity-0">cover</p>
      <div class="w-16 rounded overflow-hidden bg-muted" style="aspect-ratio: 2/3">
        <img
          :src="field.candidateDisplay"
          class="w-full h-full object-cover"
          @error="hideOnError"
        />
      </div>
    </div>
  </div>

  <!-- Text row -->
  <div v-else class="grid grid-cols-[1fr_40px_1fr] gap-2 py-2.5 border-b border-border/50 items-start">
    <!-- Current (left) -->
    <div
      class="min-w-0 rounded px-2 py-1.5 text-sm transition-colors"
      :class="field.isCopied ? 'bg-primary/8 text-foreground' : 'text-foreground'"
    >
      <p class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">{{ field.label }}</p>
      <p class="break-words leading-snug" :class="!field.currentDisplay ? 'text-muted-foreground/40 italic' : ''">
        {{ field.currentDisplay || 'empty' }}
      </p>
    </div>

    <!-- Toggle button -->
    <div class="flex justify-center pt-6">
      <button
        v-if="field.hasDiff"
        class="size-7 rounded-full flex items-center justify-center transition-colors"
        :class="
          field.isCopied
            ? 'bg-primary text-primary-foreground hover:bg-primary/80'
            : 'bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground'
        "
        @click="$emit('toggle', field.key)"
      >
        <RotateCcw v-if="field.isCopied" class="size-3" />
        <ArrowLeft v-else class="size-3" />
      </button>
      <div v-else class="size-7 flex items-center justify-center text-muted-foreground/40">
        <Check class="size-3" />
      </div>
    </div>

    <!-- Candidate (right) -->
    <div class="min-w-0 rounded px-2 py-1.5 text-sm" :class="!field.hasDiff ? 'opacity-40' : ''">
      <p class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1 opacity-0">
        {{ field.label }}
      </p>
      <p class="break-words leading-snug text-muted-foreground">{{ field.candidateDisplay }}</p>
    </div>
  </div>
</template>
