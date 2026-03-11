<script setup lang="ts">
import { ref } from 'vue'
import { AlignJustify, Image, Palette, X } from 'lucide-vue-next'
import type { BgColor, Direction, FitMode, ScrollMode, ViewMode } from '../composables/useCbzSettings'

defineProps<{
  fitMode: FitMode
  viewMode: ViewMode
  scrollMode: ScrollMode
  direction: Direction
  bgColor: BgColor
}>()

const emit = defineEmits<{
  close: []
  'update:fitMode': [v: FitMode]
  'update:viewMode': [v: ViewMode]
  'update:scrollMode': [v: ScrollMode]
  'update:direction': [v: Direction]
  'update:bgColor': [v: BgColor]
}>()

type Tab = 'view' | 'scroll' | 'display'
const activeTab = ref<Tab>('view')

const FIT_OPTIONS: { value: FitMode; label: string }[] = [
  { value: 'fit-page', label: 'Page' },
  { value: 'fit-width', label: 'Width' },
  { value: 'fit-height', label: 'Height' },
  { value: 'actual', label: 'Actual' },
]

const SCROLL_OPTIONS: { value: ScrollMode; label: string }[] = [
  { value: 'paginated', label: 'Paginated' },
  { value: 'infinite', label: 'Infinite Scroll' },
  { value: 'long-strip', label: 'Long Strip' },
]
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end" @click.self="emit('close')">
    <div
      class="settings-sheet bg-card text-card-foreground rounded-t-xl max-h-[85vh] overflow-y-auto shadow-2xl border-t border-border w-full max-w-2xl mx-auto"
      @click.stop
    >
      <div class="sticky top-0 bg-card z-10 flex items-center justify-between px-5 py-4 border-b border-border">
        <div class="flex gap-1">
          <button
            v-for="tab in [
              { id: 'view', icon: Image, label: 'View' },
              { id: 'scroll', icon: AlignJustify, label: 'Scroll' },
              { id: 'display', icon: Palette, label: 'Display' },
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
        <template v-if="activeTab === 'view'">
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fit Mode</p>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="opt in FIT_OPTIONS"
                :key="opt.value"
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  fitMode === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:fitMode', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pages</p>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  viewMode === 'single'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:viewMode', 'single')"
              >
                Single
              </button>
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  viewMode === 'two-page'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:viewMode', 'two-page')"
              >
                Two Page
              </button>
            </div>
          </div>
        </template>

        <template v-if="activeTab === 'scroll'">
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Scroll Mode</p>
            <div class="flex flex-col gap-2">
              <button
                v-for="opt in SCROLL_OPTIONS"
                :key="opt.value"
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  scrollMode === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:scrollMode', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Reading Direction</p>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  direction === 'ltr'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:direction', 'ltr')"
              >
                LTR →
              </button>
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  direction === 'rtl'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:direction', 'rtl')"
              >
                ← RTL
              </button>
            </div>
          </div>
        </template>

        <template v-if="activeTab === 'display'">
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Background</p>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="opt in [
                  { value: 'black', label: 'Black' },
                  { value: 'gray', label: 'Gray' },
                  { value: 'white', label: 'White' },
                ] as const"
                :key="opt.value"
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  bgColor === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:bgColor', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-sheet {
  animation: slideInFromBottom 0.25s ease;
}

@keyframes slideInFromBottom {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
</style>
