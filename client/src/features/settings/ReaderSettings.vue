<script setup lang="ts">
import { ref } from 'vue'

const defaultFlow = ref('paginated')
const rememberPosition = ref(true)
const preloadPages = ref(true)
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Reading</h2>
      <p class="mt-1 text-sm text-muted-foreground">Default behavior and preferences for the reader.</p>
    </div>

    <div class="border border-border rounded-lg overflow-hidden">
      <!-- Remember position -->
      <div class="flex items-center justify-between px-5 py-4 bg-card border-b border-border">
        <div>
          <p class="text-sm font-medium text-foreground">Remember position</p>
          <p class="text-xs text-muted-foreground mt-0.5">Resume from where you left off</p>
        </div>
        <button
          class="w-11 h-6 rounded-full transition-colors relative shrink-0"
          :class="rememberPosition ? 'bg-primary' : 'bg-muted'"
          @click="rememberPosition = !rememberPosition"
        >
          <div
            class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
            :class="rememberPosition ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </div>

      <!-- Preload pages -->
      <div class="flex items-center justify-between px-5 py-4 bg-card border-b border-border">
        <div>
          <p class="text-sm font-medium text-foreground">Preload pages</p>
          <p class="text-xs text-muted-foreground mt-0.5">Load upcoming pages in the background (comic reader)</p>
        </div>
        <button
          class="w-11 h-6 rounded-full transition-colors relative shrink-0"
          :class="preloadPages ? 'bg-primary' : 'bg-muted'"
          @click="preloadPages = !preloadPages"
        >
          <div
            class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
            :class="preloadPages ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </div>

      <!-- Default comic flow -->
      <div class="flex items-center justify-between px-5 py-4 bg-card">
        <div>
          <p class="text-sm font-medium text-foreground">Default comic layout</p>
          <p class="text-xs text-muted-foreground mt-0.5">Starting scroll mode for CBZ / CBR / CB7</p>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            v-for="opt in [
              { value: 'paginated', label: 'Paginated' },
              { value: 'infinite', label: 'Infinite' },
              { value: 'long-strip', label: 'Strip' },
            ]"
            :key="opt.value"
            class="h-7 px-3 text-xs rounded-md border-2 transition-colors"
            :class="
              defaultFlow === opt.value
                ? 'border-primary text-primary bg-primary/8'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            "
            @click="defaultFlow = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>

    <p class="mt-4 text-xs text-muted-foreground">Reader preferences will be persisted in a future update.</p>
  </div>
</template>
