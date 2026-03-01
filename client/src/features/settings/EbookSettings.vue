<script setup lang="ts">
import { onMounted } from 'vue'
import type { EpubReaderSettings } from '@projectx/types'
import { useReaderDefaultSettings } from '@/features/reader/composables/useReaderSettings'
import { themes } from '@/features/reader/constants/themes'

const { effective, load, update, reset } = useReaderDefaultSettings<EpubReaderSettings>('epub')

onMounted(load)

const fontFamilies: { id: string | null; label: string }[] = [
  { id: null, label: "Book's font" },
  { id: 'serif', label: 'Serif' },
  { id: 'sans-serif', label: 'Sans-serif' },
  { id: 'monospace', label: 'Monospace' },
  { id: 'Georgia, serif', label: 'Georgia' },
  { id: 'Palatino Linotype, serif', label: 'Palatino' },
  { id: 'Bookerly, serif', label: 'Bookerly' },
]
</script>

<template>
    <div class="mb-8 flex items-start justify-between gap-4">
      <div>
        <h2 class="settings-title">eBook Reader</h2>
        <p class="settings-subtitle">Default settings applied when opening EPUB, MOBI, FB2, and TXT files.</p>
      </div>
      <button class="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
        Reset to defaults
      </button>
    </div>

    <!-- Formatting source -->
    <div class="mb-6">
      <p class="settings-group-label">New Books</p>
      <div class="border border-border rounded-lg overflow-hidden bg-card">
        <div class="flex items-start justify-between px-5 py-4 gap-4">
          <div>
            <p class="settings-label">Apply my settings to new books</p>
            <p class="settings-hint">
              When off, new books open with the publisher's own fonts and layout. Your settings only apply once you change something in-reader.
            </p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0 mt-0.5"
            :class="effective.overrideBookFormatting ? 'bg-primary' : 'bg-muted'"
            @click="update({ overrideBookFormatting: !effective.overrideBookFormatting })"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="effective.overrideBookFormatting ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Layout -->
    <div class="mb-6">
      <p class="settings-group-label">Layout</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Flow -->
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="settings-label">Reading flow</p>
            <p class="settings-hint">Paginated flips pages; scrolled flows continuously</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="effective.flow === 'paginated' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ flow: 'paginated' })"
            >
              Paginated
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="effective.flow === 'scrolled' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ flow: 'scrolled' })"
            >
              Scrolled
            </button>
          </div>
        </div>

        <!-- Columns -->
        <div class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="settings-label">Columns</p>
              <p class="settings-hint">Number of text columns per page</p>
            </div>
            <span class="settings-value">{{ effective.maxColumnCount }}</span>
          </div>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.maxColumnCount"
            @input="update({ maxColumnCount: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
      </div>
    </div>

    <!-- Theme -->
    <div class="mb-6">
      <p class="settings-group-label">Theme</p>
      <div class="border border-border rounded-lg overflow-hidden bg-card px-5 py-4">
        <!-- Dark mode toggle -->
        <div class="flex items-center justify-between mb-4">
          <div>
            <p class="settings-label">Dark mode</p>
            <p class="settings-hint">Use the dark variant of the selected theme</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="effective.isDark ? 'bg-primary' : 'bg-muted'"
            @click="update({ isDark: !effective.isDark })"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="effective.isDark ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
        <!-- Theme swatches -->
        <div class="flex flex-wrap gap-2">
          <button v-for="t in themes" :key="t.name" class="flex flex-col items-center gap-1 group" @click="update({ themeName: t.name })">
            <div
              class="w-20 h-14 rounded border-2 overflow-hidden transition-all shrink-0"
              :class="effective.themeName === t.name ? 'border-primary shadow-sm' : 'border-transparent hover:border-border'"
            >
              <div class="w-full h-1/2" :style="{ background: effective.isDark ? t.dark.bg : t.light.bg }" />
              <div
                class="w-full h-1/2 flex items-center justify-center px-0.5"
                :style="{ background: effective.isDark ? t.dark.bg : t.light.bg }"
              >
                <div class="h-0.5 w-full rounded-full opacity-60" :style="{ background: effective.isDark ? t.dark.fg : t.light.fg }" />
              </div>
            </div>
            <span
              class="text-xs font-medium transition-colors leading-none"
              :class="effective.themeName === t.name ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'"
            >
              {{ t.label }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Typography -->
    <div class="mb-6">
      <p class="settings-group-label">Typography</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Font family -->
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="settings-label">Font</p>
            <p class="settings-hint">Typeface used for body text</p>
          </div>
          <select
            class="text-xs border border-border rounded-md px-2 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            :value="effective.fontFamily ?? ''"
            @change="update({ fontFamily: ($event.target as HTMLSelectElement).value || null })"
          >
            <option v-for="f in fontFamilies" :key="String(f.id)" :value="f.id ?? ''">{{ f.label }}</option>
          </select>
        </div>

        <!-- Font size -->
        <div class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="settings-label">Font size</p>
              <p class="settings-hint">Base text size in pixels</p>
            </div>
            <span class="settings-value">{{ effective.fontSize }}px</span>
          </div>
          <input
            type="range"
            min="10"
            max="32"
            step="1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.fontSize"
            @input="update({ fontSize: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>

        <!-- Line height -->
        <div class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="settings-label">Line height</p>
              <p class="settings-hint">Vertical spacing between lines</p>
            </div>
            <span class="settings-value">{{ effective.lineHeight.toFixed(1) }}</span>
          </div>
          <input
            type="range"
            min="0.8"
            max="3"
            step="0.1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.lineHeight"
            @input="update({ lineHeight: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>

        <!-- Justify -->
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="settings-label">Justify text</p>
            <p class="settings-hint">Align text to both margins</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="effective.justify ? 'bg-primary' : 'bg-muted'"
            @click="update({ justify: !effective.justify })"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="effective.justify ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <!-- Hyphenation -->
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="settings-label">Hyphenation</p>
            <p class="settings-hint">Automatically break long words with hyphens</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="effective.hyphenate ? 'bg-primary' : 'bg-muted'"
            @click="update({ hyphenate: !effective.hyphenate })"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="effective.hyphenate ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Advanced -->
    <div class="mb-6">
      <p class="settings-group-label">Advanced</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Max inline size -->
        <div class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="settings-label">Max content width</p>
              <p class="settings-hint">Maximum width of the text area in pixels</p>
            </div>
            <span class="settings-value">{{ effective.maxInlineSize }}px</span>
          </div>
          <input
            type="range"
            min="400"
            max="1600"
            step="40"
            class="w-full accent-primary cursor-pointer"
            :value="effective.maxInlineSize"
            @input="update({ maxInlineSize: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>

        <!-- Gap -->
        <div class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="settings-label">Column gap</p>
              <p class="settings-hint">Horizontal padding on each side of the text area</p>
            </div>
            <span class="settings-value">{{ Math.round(effective.gap * 100) }}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            class="w-full accent-primary cursor-pointer"
            :value="effective.gap"
            @input="update({ gap: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
      </div>
    </div>
</template>
