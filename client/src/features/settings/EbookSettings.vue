<script setup lang="ts">
import { ref } from 'vue'

const defaultFlow = ref<'paginated' | 'scrolled'>('paginated')
const defaultFontSize = ref(18)
const justify = ref(true)
const hyphenate = ref(false)
const rememberPosition = ref(true)
const defaultTheme = ref('default')

const themes = [
  { id: 'default', label: 'Default' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' },
  { id: 'night', label: 'Night' },
]
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">eBook Reader</h2>
      <p class="mt-1 text-sm text-muted-foreground">Default settings applied when opening EPUB and MOBI files.</p>
    </div>

    <!-- Layout -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Layout</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Reading flow</p>
            <p class="text-xs text-muted-foreground mt-0.5">Paginated flips pages; scrolled flows continuously</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="defaultFlow === 'paginated' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="defaultFlow = 'paginated'"
            >
              Paginated
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="defaultFlow === 'scrolled' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="defaultFlow = 'scrolled'"
            >
              Scrolled
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Default theme</p>
            <p class="text-xs text-muted-foreground mt-0.5">Starting color scheme for new books</p>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              v-for="t in themes"
              :key="t.id"
              class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                defaultTheme === t.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="defaultTheme = t.id"
            >
              {{ t.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Typography -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Typography</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="text-sm font-medium text-foreground">Default font size</p>
              <p class="text-xs text-muted-foreground mt-0.5">Base size before any reader adjustment</p>
            </div>
            <span class="text-sm font-medium tabular-nums text-foreground">{{ defaultFontSize }}px</span>
          </div>
          <input v-model.number="defaultFontSize" type="range" min="10" max="32" step="1" class="w-full accent-primary cursor-pointer" />
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Justify text</p>
            <p class="text-xs text-muted-foreground mt-0.5">Align text to both margins</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="justify ? 'bg-primary' : 'bg-muted'"
            @click="justify = !justify"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="justify ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Hyphenation</p>
            <p class="text-xs text-muted-foreground mt-0.5">Auto word-break with hyphens</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="hyphenate ? 'bg-primary' : 'bg-muted'"
            @click="hyphenate = !hyphenate"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="hyphenate ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Behavior -->
    <div>
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Behavior</p>
      <div class="border border-border rounded-lg overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
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
      </div>
    </div>

    <p class="mt-6 text-xs text-muted-foreground">These defaults will be persisted and applied to new books in a future update.</p>
  </div>
</template>
