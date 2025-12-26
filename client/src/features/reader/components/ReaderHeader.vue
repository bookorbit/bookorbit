<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ArrowLeft, BookOpen, Bookmark, BookmarkCheck, Maximize, Minimize, Search, Settings } from 'lucide-vue-next'

defineProps<{
  chapterTitle: string
  isBookmarked: boolean
  isDark: boolean
  bgColor: string
  fgColor: string
}>()

const emit = defineEmits<{
  back: []
  toggleSidebar: []
  toggleSearch: []
  toggleBookmark: []
  toggleSettings: []
  toggleFullscreen: []
}>()

const isFullscreen = ref(false)

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onUnmounted(() => document.removeEventListener('fullscreenchange', onFullscreenChange))
</script>

<template>
  <header
    class="fixed top-0 left-0 right-0 h-12 z-50 flex items-center px-3 gap-1"
    :style="{
      background: `color-mix(in srgb, ${bgColor} 92%, transparent)`,
      color: fgColor,
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderBottom: `1px solid color-mix(in srgb, ${fgColor} 12%, transparent)`,
    }"
  >
    <button
      class="flex items-center justify-center w-8 h-8 rounded-md transition-opacity hover:opacity-70 shrink-0"
      :style="{ color: fgColor }"
      @click="emit('back')"
      title="Go back"
    >
      <ArrowLeft :size="18" />
    </button>

    <div class="w-px h-5 mx-1 shrink-0" :style="{ background: `color-mix(in srgb, ${fgColor} 20%, transparent)` }" />

    <button
      class="flex items-center justify-center w-8 h-8 rounded-md transition-opacity hover:opacity-70 shrink-0"
      :style="{ color: fgColor }"
      @click="emit('toggleSidebar')"
      title="Table of contents"
    >
      <BookOpen :size="18" />
    </button>

    <button
      class="flex items-center justify-center w-8 h-8 rounded-md transition-opacity hover:opacity-70 shrink-0"
      :style="{ color: isBookmarked ? '#f87171' : fgColor }"
      @click="emit('toggleBookmark')"
      title="Toggle bookmark"
    >
      <BookmarkCheck v-if="isBookmarked" :size="18" />
      <Bookmark v-else :size="18" />
    </button>

    <button
      class="flex items-center justify-center w-8 h-8 rounded-md transition-opacity hover:opacity-70 shrink-0"
      :style="{ color: fgColor }"
      @click="emit('toggleSearch')"
      title="Search"
    >
      <Search :size="18" />
    </button>

    <div class="flex-1 min-w-0 px-3">
      <p class="text-sm font-medium truncate text-center" :style="{ color: `color-mix(in srgb, ${fgColor} 70%, transparent)` }">
        {{ chapterTitle }}
      </p>
    </div>

    <button
      class="flex items-center justify-center w-8 h-8 rounded-md transition-opacity hover:opacity-70 shrink-0"
      :style="{ color: fgColor }"
      @click="emit('toggleSettings')"
      title="Settings"
    >
      <Settings :size="18" />
    </button>

    <button
      class="flex items-center justify-center w-8 h-8 rounded-md transition-opacity hover:opacity-70 shrink-0"
      :style="{ color: fgColor }"
      @click="emit('toggleFullscreen')"
      :title="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
    >
      <Minimize v-if="isFullscreen" :size="18" />
      <Maximize v-else :size="18" />
    </button>
  </header>
</template>
