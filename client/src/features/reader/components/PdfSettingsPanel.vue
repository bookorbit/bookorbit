<script setup lang="ts">
import { ref } from 'vue'
import { LayoutGrid, RotateCw, X, ZoomIn } from 'lucide-vue-next'
import { ZOOM_PRESETS } from '../composables/usePdfZoom'

defineProps<{
  zoomMode: string
  customScale: number
  zoomLabel: string
  spread: 'none' | 'odd' | 'even'
  scrollMode: 'vertical' | 'page'
  rotation: 0 | 90 | 180 | 270
}>()

const emit = defineEmits<{
  close: []
  applyZoomPreset: [value: string]
  'update:spread': [v: 'none' | 'odd' | 'even']
  'update:scrollMode': [v: 'vertical' | 'page']
  rotate: []
}>()

type Tab = 'zoom' | 'layout' | 'display'
const activeTab = ref<Tab>('zoom')
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end" @click.self="emit('close')">
    <div
      class="bg-card text-card-foreground rounded-t-xl max-h-[85vh] overflow-y-auto shadow-2xl border-t border-border w-full max-w-2xl mx-auto"
      @click.stop
    >
      <div class="sticky top-0 bg-card z-10 flex items-center justify-between px-5 py-4 border-b border-border">
        <div class="flex gap-1">
          <button
            v-for="tab in [
              { id: 'zoom', icon: ZoomIn, label: 'Zoom' },
              { id: 'layout', icon: LayoutGrid, label: 'Layout' },
              { id: 'display', icon: RotateCw, label: 'Display' },
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
        <template v-if="activeTab === 'zoom'">
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Preset</p>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  zoomMode === 'fit-width'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('applyZoomPreset', 'fit-width')"
              >
                Fit Width
              </button>
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  zoomMode === 'fit-page'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('applyZoomPreset', 'fit-page')"
              >
                Fit Page
              </button>
              <button
                v-for="preset in ZOOM_PRESETS"
                :key="preset.label"
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  zoomMode === 'custom' && customScale === parseFloat(preset.value)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('applyZoomPreset', preset.value)"
              >
                {{ preset.label }}
              </button>
            </div>
          </div>
        </template>

        <template v-if="activeTab === 'layout'">
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Scroll Mode</p>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  scrollMode === 'vertical'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:scrollMode', 'vertical')"
              >
                Scrolled
              </button>
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  scrollMode === 'page'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:scrollMode', 'page')"
              >
                Page by Page
              </button>
            </div>
          </div>
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Page Spread</p>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  spread === 'none'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:spread', 'none')"
              >
                Single Page
              </button>
              <button
                class="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                :class="
                  spread !== 'none'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground'
                "
                @click="emit('update:spread', 'odd')"
              >
                Two-Page
              </button>
            </div>
          </div>
        </template>

        <template v-if="activeTab === 'display'">
          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Rotation</p>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Rotate Clockwise</p>
                <p class="text-xs text-muted-foreground">Current: {{ rotation }}°</p>
              </div>
              <button
                class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border-2 border-border hover:border-muted-foreground/40 hover:bg-muted text-foreground transition-colors"
                @click="emit('rotate')"
              >
                <RotateCw :size="16" />
                Rotate 90°
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
