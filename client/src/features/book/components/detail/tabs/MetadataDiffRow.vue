<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft, RotateCcw, CheckCircle2, X, ZoomIn } from 'lucide-vue-next'
import type { DiffField, DiffFieldKey } from '../../../composables/useMetadataDiff'
import { hideOnError } from '../../../lib/metadata-fetch'

defineProps<{ field: DiffField }>()
defineEmits<{ toggle: [DiffFieldKey] }>()

const lightboxSrc = ref<string | null>(null)
</script>

<template>
  <!-- Cover row -->
  <div v-if="field.isCover" class="py-3.5 border-b border-border/40">
    <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">{{ field.label }}</p>
    <div class="grid grid-cols-[1fr_44px_1fr] gap-2 items-center">

      <!-- Current cover -->
      <div
        class="w-16 rounded-lg overflow-hidden bg-muted transition-all duration-300 shadow-sm ring-1 relative group"
        :class="field.isCopied ? 'ring-primary ring-2 cursor-zoom-in' : 'ring-border opacity-50'"
        style="aspect-ratio: 2/3"
        @click="field.isCopied ? lightboxSrc = field.candidateDisplay : null"
      >
        <img v-if="field.isCopied" :src="field.candidateDisplay" alt="Preview" class="w-full h-full object-cover" @error="hideOnError" />
        <div v-else class="w-full h-full bg-linear-to-br from-muted to-muted-foreground/10" />
        <div v-if="field.isCopied" class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <ZoomIn class="size-4 text-white" />
        </div>
      </div>

      <!-- Toggle -->
      <div class="flex justify-center">
        <button
          class="size-8 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-sm"
          :class="field.isCopied ? 'bg-primary text-primary-foreground shadow-primary/30' : 'bg-card border border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5'"
          @click="$emit('toggle', field.key)"
        >
          <RotateCcw v-if="field.isCopied" class="size-3.5" />
          <ArrowLeft v-else class="size-3.5" />
        </button>
      </div>

      <!-- New cover -->
      <div
        class="w-16 rounded-lg overflow-hidden bg-muted shadow-sm ring-1 transition-all duration-300 relative group cursor-zoom-in"
        :class="field.isCopied ? 'ring-primary ring-2' : 'ring-border'"
        style="aspect-ratio: 2/3"
        @click="lightboxSrc = field.candidateDisplay"
      >
        <img :src="field.candidateDisplay" alt="New cover" class="w-full h-full object-cover" @error="hideOnError" />
        <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <ZoomIn class="size-4 text-white" />
        </div>
      </div>
    </div>
  </div>

  <!-- Text row -->
  <div v-else class="py-2.5 border-b border-border/40">
    <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{{ field.label }}</p>

    <div class="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_44px_1fr] sm:gap-1.5 sm:items-stretch">

      <!-- Current value: framed card to signal it's the active record -->
      <div
        class="min-w-0 rounded-lg px-3 py-2 transition-all duration-200"
        :class="
          !field.hasDiff
            ? 'bg-muted/30 opacity-50'
            : field.isCopied
              ? 'bg-muted/30 opacity-40'
              : 'bg-background ring-1 ring-border'
        "
      >
        <p class="text-[10px] font-medium text-muted-foreground mb-0.5 sm:hidden">Current</p>
        <p
          class="wrap-break-word leading-snug text-sm w-full"
          :class="!field.currentDisplay ? 'text-muted-foreground/40 italic' : 'text-foreground'"
        >
          {{ field.currentDisplay || 'empty' }}
        </p>
      </div>

      <!-- Toggle button -->
      <div class="flex items-center justify-center">
        <button
          v-if="field.hasDiff"
          class="size-8 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-sm shrink-0"
          :class="field.isCopied ? 'bg-primary text-primary-foreground shadow-primary/30' : 'bg-card border border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5'"
          @click="$emit('toggle', field.key)"
        >
          <RotateCcw v-if="field.isCopied" class="size-3.5" />
          <ArrowLeft v-else class="size-3.5" />
        </button>
        <div v-else class="size-8 flex items-center justify-center">
          <CheckCircle2 class="size-3.5 text-muted-foreground/25" />
        </div>
      </div>

      <!-- New value: muted by default, highlights when selected -->
      <div
        class="min-w-0 rounded-lg px-3 py-2 transition-all duration-200"
        :class="
          !field.hasDiff
            ? 'bg-muted/30 opacity-50'
            : field.isCopied
              ? 'bg-primary/8 ring-1 ring-primary/20'
              : 'bg-muted/40'
        "
      >
        <p class="text-[10px] font-medium text-muted-foreground mb-0.5 sm:hidden">New</p>
        <p
          class="wrap-break-word leading-snug text-sm w-full"
          :class="field.isCopied ? 'text-primary font-medium' : 'text-muted-foreground'"
        >
          {{ field.candidateDisplay }}
        </p>
      </div>

    </div>
  </div>

  <!-- Lightbox -->
  <Teleport to="body">
    <div
      v-if="lightboxSrc"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      @click="lightboxSrc = null"
    >
      <button
        class="absolute top-4 right-4 size-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
        @click="lightboxSrc = null"
      >
        <X class="size-5" />
      </button>
      <img
        :src="lightboxSrc"
        alt="Cover preview"
        class="max-h-[85vh] max-w-[85vw] rounded-xl shadow-2xl object-contain"
        @click.stop
        @error="hideOnError"
      />
    </div>
  </Teleport>
</template>
