<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { LayoutGrid, Moon, Palette, Sun, Type } from 'lucide-vue-next'
import type { ReaderState } from '../composables/useReaderState'
import { themes } from '../constants/themes'

const props = defineProps<{
  state: ReaderState
}>()

const emit = defineEmits<{
  update: [partial: Partial<ReaderState>]
}>()

type Tab = 'appearance' | 'text' | 'layout'

const activeTab = ref<Tab>('appearance')
const contentRef = ref<HTMLElement | null>(null)
const hasTabBarShadow = ref(false)
const scrollMemory = ref<Record<Tab, number>>({
  appearance: 0,
  text: 0,
  layout: 0,
})

const tabs: { id: Tab; icon: typeof Palette; label: string }[] = [
  { id: 'appearance', icon: Palette, label: 'Appearance' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'layout', icon: LayoutGrid, label: 'Layout' },
]

const fontFamilies = [
  { name: "Publisher's", value: null },
  { name: 'Serif', value: 'serif' },
  { name: 'Sans-Serif', value: 'sans-serif' },
  { name: 'Monospace', value: 'monospace' },
  { name: 'Cursive', value: 'cursive' },
]

const stepperButtonClass = 'size-8 rounded-lg border border-border text-lg font-light text-foreground transition-colors hover:bg-muted'
const stepperGroupClass = 'flex min-w-[11rem] items-center justify-end gap-2'
const stepperValueClass = 'w-[4.75rem] text-center text-sm font-mono font-medium tabular-nums text-foreground'

function step(field: keyof ReaderState, delta: number, min: number, max: number, precision = 0) {
  const current = props.state[field] as number
  const next = Math.max(min, Math.min(max, current + delta))
  const rounded = precision > 0 ? Math.round(next * Math.pow(10, precision)) / Math.pow(10, precision) : Math.round(next)
  emit('update', { [field]: rounded } as Partial<ReaderState>)
}

function formatGap(v: number) {
  return `${Math.round(v * 100)}%`
}

function onContentScroll() {
  if (!contentRef.value) return
  scrollMemory.value[activeTab.value] = contentRef.value.scrollTop
  hasTabBarShadow.value = contentRef.value.scrollTop > 0
}

function setActiveTab(tab: Tab) {
  if (tab === activeTab.value) return

  if (contentRef.value) {
    scrollMemory.value[activeTab.value] = contentRef.value.scrollTop
  }

  activeTab.value = tab

  nextTick(() => {
    if (!contentRef.value) return
    contentRef.value.scrollTop = scrollMemory.value[tab] ?? 0
    hasTabBarShadow.value = contentRef.value.scrollTop > 0
  })
}

onMounted(() => {
  if (!contentRef.value) return
  contentRef.value.scrollTop = scrollMemory.value[activeTab.value] ?? 0
  hasTabBarShadow.value = contentRef.value.scrollTop > 0
})
</script>

<template>
  <section
    class="bg-card text-card-foreground flex max-h-[min(80vh,38rem)] flex-col overflow-hidden [&_button:focus-visible]:outline-none [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-primary/55 [&_button:focus-visible]:ring-offset-1 [&_button:focus-visible]:ring-offset-card"
  >
    <div
      class="sticky top-0 z-10 border-b border-border bg-card/95 px-3 py-3 backdrop-blur-sm transition-shadow"
      :class="hasTabBarShadow ? 'shadow-sm' : ''"
    >
      <div class="grid grid-cols-3 gap-1 rounded-xl bg-muted/55 p-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex h-[2.125rem] items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors"
          :class="
            activeTab === tab.id
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/70'
          "
          @click="setActiveTab(tab.id)"
        >
          <component :is="tab.icon" :size="15" />
          <span>{{ tab.label }}</span>
        </button>
      </div>
    </div>

    <div ref="contentRef" class="overflow-y-auto px-4 py-4 space-y-6" @scroll="onContentScroll">
      <template v-if="activeTab === 'appearance'">
        <div class="space-y-6">
          <div>
            <p class="mb-2 text-[13px] font-medium text-foreground/90">Mode</p>
            <button
              class="flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 transition-colors"
              :class="state.isDark ? 'border-primary bg-primary/10' : 'border-border hover:border-muted-foreground/30'"
              @click="emit('update', { isDark: !state.isDark })"
            >
              <component :is="state.isDark ? Moon : Sun" :size="20" />
              <span class="text-sm font-medium">{{ state.isDark ? 'Dark mode' : 'Light mode' }}</span>
              <div class="relative ml-auto h-6 w-10 rounded-full transition-colors" :class="state.isDark ? 'bg-primary' : 'bg-muted'">
                <div
                  class="absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                  :class="state.isDark ? 'translate-x-5' : 'translate-x-1'"
                />
              </div>
            </button>
          </div>

          <div class="h-px bg-border/70" />

          <div>
            <p class="mb-2 text-[13px] font-medium text-foreground/90">Color theme</p>
            <div class="grid grid-cols-6 gap-2">
              <button
                v-for="theme in themes"
                :key="theme.name"
                class="group flex flex-col items-center gap-1.5"
                @click="emit('update', { themeName: theme.name })"
              >
                <div
                  class="flex h-9 w-9 items-center justify-center rounded-full border-2 shadow-sm transition-all"
                  :class="state.themeName === theme.name ? 'scale-110 border-primary' : 'border-transparent group-hover:border-muted-foreground/40'"
                  :style="{ background: state.isDark ? theme.dark.bg : theme.light.bg }"
                >
                  <div class="h-2.5 w-2.5 rounded-full" :style="{ background: state.isDark ? theme.dark.fg : theme.light.fg }" />
                </div>
                <span class="w-full truncate text-center text-[10px] text-muted-foreground">{{ theme.label }}</span>
              </button>
            </div>
          </div>
        </div>
      </template>

      <template v-if="activeTab === 'text'">
        <div class="space-y-6">
          <div class="flex items-center justify-between gap-4">
            <div class="space-y-1 pr-3">
              <p class="text-sm font-medium leading-tight">Font size</p>
              <p class="text-xs leading-tight text-muted-foreground">Range: 10-32px</p>
            </div>
            <div :class="stepperGroupClass">
              <button :class="stepperButtonClass" @click="step('fontSize', -1, 10, 32)">−</button>
              <span :class="stepperValueClass">{{ state.fontSize }}px</span>
              <button :class="stepperButtonClass" @click="step('fontSize', 1, 10, 32)">+</button>
            </div>
          </div>

          <div class="flex items-center justify-between gap-4">
            <div class="space-y-1 pr-3">
              <p class="text-sm font-medium leading-tight">Line height</p>
              <p class="text-xs leading-tight text-muted-foreground">Range: 0.8-3.0</p>
            </div>
            <div :class="stepperGroupClass">
              <button :class="stepperButtonClass" @click="step('lineHeight', -0.1, 0.8, 3, 1)">−</button>
              <span :class="stepperValueClass">{{ state.lineHeight.toFixed(1) }}</span>
              <button :class="stepperButtonClass" @click="step('lineHeight', 0.1, 0.8, 3, 1)">+</button>
            </div>
          </div>

          <div class="h-px bg-border/70" />

          <div class="space-y-3">
            <div class="space-y-1">
              <p class="text-sm font-medium leading-tight">Font family</p>
              <p class="text-xs leading-tight text-muted-foreground">Switch between publisher default and common reader fonts.</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="font in fontFamilies"
                :key="String(font.value)"
                class="rounded-lg border px-3 py-1.5 text-sm transition-colors"
                :class="
                  state.fontFamily === font.value
                    ? 'border-primary bg-primary text-primary-foreground'
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
        <div class="space-y-6">
          <div class="space-y-3">
            <div class="space-y-1">
              <p class="text-sm font-medium leading-tight">Reading flow</p>
              <p class="text-xs leading-tight text-muted-foreground">Switch between paged and continuous scrolling.</p>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="f in ['paginated', 'scrolled'] as const"
                :key="f"
                class="rounded-xl border-2 py-2.5 text-sm font-medium capitalize transition-colors"
                :class="
                  state.flow === f
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-foreground hover:border-muted-foreground/40 hover:bg-muted'
                "
                @click="emit('update', { flow: f })"
              >
                {{ f }}
              </button>
            </div>
          </div>

          <div class="h-px bg-border/70" />

          <div class="space-y-4">
            <div class="flex items-center justify-between gap-4">
              <div class="space-y-1 pr-3">
                <p class="text-sm font-medium leading-tight">Max columns</p>
                <p class="text-xs leading-tight text-muted-foreground">Range: 1-10</p>
              </div>
              <div :class="stepperGroupClass">
                <button :class="stepperButtonClass" @click="step('maxColumnCount', -1, 1, 10)">−</button>
                <span :class="stepperValueClass">{{ state.maxColumnCount }}</span>
                <button :class="stepperButtonClass" @click="step('maxColumnCount', 1, 1, 10)">+</button>
              </div>
            </div>

            <div class="flex items-center justify-between gap-4">
              <div class="space-y-1 pr-3">
                <p class="text-sm font-medium leading-tight">Column gap</p>
                <p class="text-xs leading-tight text-muted-foreground">Range: 0-50%</p>
              </div>
              <div :class="stepperGroupClass">
                <button :class="stepperButtonClass" @click="step('gap', -0.01, 0, 0.5, 2)">−</button>
                <span :class="stepperValueClass">{{ formatGap(state.gap) }}</span>
                <button :class="stepperButtonClass" @click="step('gap', 0.01, 0, 0.5, 2)">+</button>
              </div>
            </div>

            <div class="flex items-center justify-between gap-4">
              <div class="space-y-1 pr-3">
                <p class="text-sm font-medium leading-tight">Max width</p>
                <p class="text-xs leading-tight text-muted-foreground">Range: 400-1600px</p>
              </div>
              <div :class="stepperGroupClass">
                <button :class="stepperButtonClass" @click="step('maxInlineSize', -40, 400, 1600)">−</button>
                <span :class="stepperValueClass">{{ state.maxInlineSize }}px</span>
                <button :class="stepperButtonClass" @click="step('maxInlineSize', 40, 400, 1600)">+</button>
              </div>
            </div>
          </div>

          <div class="h-px bg-border/70" />

          <div class="space-y-4">
            <div class="flex items-center justify-between gap-4">
              <div class="space-y-1 pr-3">
                <p class="text-sm font-medium leading-tight">Justify text</p>
                <p class="text-xs leading-tight text-muted-foreground">Enable full-width paragraph alignment.</p>
              </div>
              <button
                class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                :class="state.justify ? 'bg-primary' : 'bg-muted'"
                @click="emit('update', { justify: !state.justify })"
              >
                <div
                  class="absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                  :class="state.justify ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>

            <div class="flex items-center justify-between gap-4">
              <div class="space-y-1 pr-3">
                <p class="text-sm font-medium leading-tight">Hyphenation</p>
                <p class="text-xs leading-tight text-muted-foreground">Enable automatic word-break hyphenation.</p>
              </div>
              <button
                class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                :class="state.hyphenate ? 'bg-primary' : 'bg-muted'"
                @click="emit('update', { hyphenate: !state.hyphenate })"
              >
                <div
                  class="absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                  :class="state.hyphenate ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
