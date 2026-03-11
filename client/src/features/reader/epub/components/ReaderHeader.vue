<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ArrowLeft, BookOpen, Bookmark, BookmarkCheck, Maximize, Minimize, Search, Settings } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{
  chapterTitle: string
  isBookmarked: boolean
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
  <header class="fixed top-0 left-0 right-0 h-12 z-50 flex items-center px-3 gap-1 bg-background/90 backdrop-blur-md border-b border-border">
    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" @click="emit('back')">
          <ArrowLeft :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Go back</TooltipContent>
    </Tooltip>

    <div class="viewer-sep" />

    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" @click="emit('toggleSidebar')">
          <BookOpen :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Table of contents</TooltipContent>
    </Tooltip>

    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" :class="isBookmarked ? '!text-primary' : ''" @click="emit('toggleBookmark')">
          <BookmarkCheck v-if="isBookmarked" :size="18" />
          <Bookmark v-else :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Toggle bookmark</TooltipContent>
    </Tooltip>

    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" @click="emit('toggleSearch')">
          <Search :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Search</TooltipContent>
    </Tooltip>

    <div class="flex-1 min-w-0 px-3">
      <p class="text-sm font-serif font-medium truncate text-center text-muted-foreground">{{ chapterTitle }}</p>
    </div>

    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" @click="emit('toggleSettings')">
          <Settings :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Settings</TooltipContent>
    </Tooltip>

    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" @click="emit('toggleFullscreen')">
          <Minimize v-if="isFullscreen" :size="18" />
          <Maximize v-else :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen' }}</TooltipContent>
    </Tooltip>
  </header>
</template>
