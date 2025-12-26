<script setup lang="ts">
import { ref } from 'vue'
import { LayoutGrid, Moon, Palette, Sun, Type, X } from 'lucide-vue-next'
import type { ReaderState } from '../composables/useReaderState'
import { themes } from '../constants/themes'

const props = defineProps<{
  state: ReaderState
}>()

const emit = defineEmits<{
  update: [partial: Partial<ReaderState>]
  close: []
}>()

type Tab = 'theme' | 'typography' | 'layout'
const activeTab = ref<Tab>('theme')

const fontFamilies = [
  { name: "Publisher's", value: null },
  { name: 'Serif', value: 'serif' },
  { name: 'Sans-Serif', value: 'sans-serif' },
  { name: 'Monospace', value: 'monospace' },
  { name: 'Cursive', value: 'cursive' },
]

function step(field: keyof ReaderState, delta: number, min: number, max: number, precision = 0) {
  const current = props.state[field] as number
  const next = Math.max(min, Math.min(max, current + delta))
  const rounded = precision > 0 ? Math.round(next * Math.pow(10, precision)) / Math.pow(10, precision) : Math.round(next)
  emit('update', { [field]: rounded } as Partial<ReaderState>)
}

function formatGap(v: number) {
  return `${Math.round(v * 100)}%`
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end" @click.self="emit('close')">
    <div class="bg-card text-card-foreground rounded-t-xl max-h-[85vh] overflow-y-auto shadow-2xl border-t border-border w-full max-w-2xl mx-auto" @click.stop>
      <div class="sticky top-0 bg-card z-10 flex items-center justify-between px-5 py-4 border-b border-border">
        <div class="flex gap-1">
          <button
            v-for="tab in [
              { id: 'theme', icon: Palette, label: 'Theme' },
              { id: 'typography', icon: Type, label: 'Typography' },
              { id: 'layout', icon: LayoutGrid, label: 'Layout' },
            ] as const"
            :key="tab.id"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            :class="activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
            @click="activeTab = tab.id"
          >
            <component :is="tab.icon" :size="14" />
            {{ tab.label }}
          </button>
        </div>
        <button
          class="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </div>

      <div class="px-5 py-5 space-y-6">
        <template v-if="activeTab === 'theme'">
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Mode</p>
            <button
              class="flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2 transition-colors"
              :class="state.isDark ? 'border-primary bg-primary/10' : 'border-border hover:border-muted-foreground/30'"
              @click="emit('update', { isDark: !state.isDark })"
            >
              <component :is="state.isDark ? Moon : Sun" :size="20" />
              <span class="text-sm font-medium">{{ state.isDark ? 'Dark Mode' : 'Light Mode' }}</span>
              <div class="ml-auto w-10 h-6 rounded-full transition-colors relative" :class="state.isDark ? 'bg-primary' : 'bg-muted'">
                <div
                  class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
                  :class="state.isDark ? 'translate-x-5' : 'translate-x-1'"
                />
              </div>
            </button>
          </div>

          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Color Theme</p>
            <div class="grid grid-cols-7 gap-2">
              <button
                v-for="theme in themes"
                :key="theme.name"
                class="flex flex-col items-center gap-1.5 group"
                @click="emit('update', { themeName: theme.name })"
                :title="theme.label"
              >
                <div
                  class="w-9 h-9 rounded-full border-2 transition-all flex items-center justify-center shadow-sm"
                  :class="state.themeName === theme.name ? 'border-primary scale-110' : 'border-transparent group-hover:border-muted-foreground/40'"
                  :style="{ background: state.isDark ? theme.dark.bg : theme.light.bg }"
                >
                  <div class="w-2.5 h-2.5 rounded-full" :style="{ background: state.isDark ? theme.dark.fg : theme.light.fg }" />
                </div>
                <span class="text-[10px] text-muted-foreground truncate w-full text-center">{{ theme.label }}</span>
              </button>
            </div>
          </div>
        </template>

        <template v-if="activeTab === 'typography'">
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Font Size</p>
                <p class="text-xs text-muted-foreground">Range: 10–32px</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('fontSize', -1, 10, 32)"
                >
                  −
                </button>
                <span class="w-14 text-center text-sm font-mono font-medium">{{ state.fontSize }}px</span>
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('fontSize', 1, 10, 32)"
                >
                  +
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Line Height</p>
                <p class="text-xs text-muted-foreground">Range: 0.8–3.0</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('lineHeight', -0.1, 0.8, 3, 1)"
                >
                  −
                </button>
                <span class="w-14 text-center text-sm font-mono font-medium">{{ state.lineHeight.toFixed(1) }}</span>
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('lineHeight', 0.1, 0.8, 3, 1)"
                >
                  +
                </button>
              </div>
            </div>

            <div>
              <p class="text-sm font-medium mb-2">Font Family</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="font in fontFamilies"
                  :key="String(font.value)"
                  class="px-3 py-1.5 rounded-lg text-sm border transition-colors"
                  :class="
                    state.fontFamily === font.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:border-muted-foreground/40 hover:bg-muted'
                  "
                  :style="font.value ? { fontFamily: font.value } : {}"
                  @click="emit('update', { fontFamily: font.value })"
                >
                  {{ font.name }}
                </button>
              </div>
            </div>
          </div>
        </template>

        <template v-if="activeTab === 'layout'">
          <div class="space-y-5">
            <div>
              <p class="text-sm font-medium mb-2">Reading Flow</p>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="f in ['paginated', 'scrolled'] as const"
                  :key="f"
                  class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors capitalize"
                  :class="
                    state.flow === f
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                  "
                  @click="emit('update', { flow: f })"
                >
                  {{ f }}
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Max Columns</p>
                <p class="text-xs text-muted-foreground">Range: 1–10</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('maxColumnCount', -1, 1, 10)"
                >
                  −
                </button>
                <span class="w-10 text-center text-sm font-mono font-medium">{{ state.maxColumnCount }}</span>
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('maxColumnCount', 1, 1, 10)"
                >
                  +
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Column Gap</p>
                <p class="text-xs text-muted-foreground">Range: 0–50%</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('gap', -0.01, 0, 0.5, 2)"
                >
                  −
                </button>
                <span class="w-14 text-center text-sm font-mono font-medium">{{ formatGap(state.gap) }}</span>
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('gap', 0.01, 0, 0.5, 2)"
                >
                  +
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Max Width</p>
                <p class="text-xs text-muted-foreground">Range: 400–1600px</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('maxInlineSize', -40, 400, 1600)"
                >
                  −
                </button>
                <span class="w-16 text-center text-sm font-mono font-medium">{{ state.maxInlineSize }}px</span>
                <button
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center text-lg font-light"
                  @click="step('maxInlineSize', 40, 400, 1600)"
                >
                  +
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Justify Text</p>
                <p class="text-xs text-muted-foreground">Full-width justification</p>
              </div>
              <button
                class="w-11 h-6 rounded-full transition-colors relative shrink-0"
                :class="state.justify ? 'bg-primary' : 'bg-muted'"
                @click="emit('update', { justify: !state.justify })"
              >
                <div
                  class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
                  :class="state.justify ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Hyphenation</p>
                <p class="text-xs text-muted-foreground">Auto word-break hyphens</p>
              </div>
              <button
                class="w-11 h-6 rounded-full transition-colors relative shrink-0"
                :class="state.hyphenate ? 'bg-primary' : 'bg-muted'"
                @click="emit('update', { hyphenate: !state.hyphenate })"
              >
                <div
                  class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
                  :class="state.hyphenate ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
