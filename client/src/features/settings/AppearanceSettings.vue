<script setup lang="ts">
import { ACCENT_OPTIONS, RADIUS_OPTIONS, useThemeStore } from '@/stores/theme'
import { Moon, Sun } from 'lucide-vue-next'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const themeStore = useThemeStore()
const { coverSize, gridGap } = useDisplaySettings()
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Appearance</h2>
      <p class="mt-1 text-sm text-muted-foreground">Customize how the app looks and feels.</p>
    </div>

    <!-- Theme & colors -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Theme</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Light / dark -->
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Color scheme</p>
            <p class="text-xs text-muted-foreground mt-0.5">Light or dark interface</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="themeStore.theme === 'light' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="themeStore.theme === 'dark' && themeStore.toggleTheme()"
            >
              <Sun :size="12" /> Light
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="themeStore.theme === 'dark' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="themeStore.theme === 'light' && themeStore.toggleTheme()"
            >
              <Moon :size="12" /> Dark
            </button>
          </div>
        </div>

        <!-- Accent color -->
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Accent color</p>
            <p class="text-xs text-muted-foreground mt-0.5">Controls highlights and interactive elements</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-for="opt in ACCENT_OPTIONS"
              :key="opt.id"
              :title="opt.label"
              class="w-6 h-6 rounded-full transition-all hover:scale-110 focus:outline-none"
              :style="{
                backgroundColor: opt.color,
                outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
                outlineOffset: '2px',
                transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
              }"
              @click="themeStore.setAccent(opt.id)"
            />
          </div>
        </div>

        <!-- Corner radius -->
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Corner radius</p>
            <p class="text-xs text-muted-foreground mt-0.5">Roundness of cards and UI elements</p>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              v-for="opt in RADIUS_OPTIONS"
              :key="opt.id"
              :title="opt.label"
              class="h-7 px-3 text-xs border-2 transition-colors font-medium"
              :style="{ borderRadius: opt.id === 'sharp' ? '2px' : opt.id === 'default' ? '6px' : '14px' }"
              :class="
                themeStore.radius === opt.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="themeStore.setRadius(opt.id)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Library view -->
    <div>
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Library View</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Cover size -->
        <div class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="text-sm font-medium text-foreground">Cover size</p>
              <p class="text-xs text-muted-foreground mt-0.5">Width of book covers in the grid</p>
            </div>
            <span class="text-sm font-medium tabular-nums text-foreground">{{ coverSize }}px</span>
          </div>
          <input
            :value="coverSize"
            @input="coverSize = Number(($event.target as HTMLInputElement).value)"
            type="range"
            min="80"
            max="280"
            step="10"
            class="w-full accent-primary cursor-pointer"
          />
        </div>

        <!-- Grid gap -->
        <div class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="text-sm font-medium text-foreground">Grid spacing</p>
              <p class="text-xs text-muted-foreground mt-0.5">Gap between covers in the grid</p>
            </div>
            <span class="text-sm font-medium tabular-nums text-foreground">{{ gridGap }}px</span>
          </div>
          <input
            :value="gridGap"
            @input="gridGap = Number(($event.target as HTMLInputElement).value)"
            type="range"
            min="4"
            max="40"
            step="4"
            class="w-full accent-primary cursor-pointer"
          />
        </div>
      </div>
    </div>
  </div>
</template>
