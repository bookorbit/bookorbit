<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Headphones, ImageOff } from 'lucide-vue-next'
import { bookCoverStyle, titleFontSizeClass } from '../lib/book-cover'

const props = defineProps<{
  title: string | null
  authorLine: string | null
  isAudio: boolean
  seed: string
}>()

const style = computed(() => bookCoverStyle(props.seed))
const fontSizeClass = computed(() => titleFontSizeClass(props.title ?? ''))
</script>

<template>
  <div class="absolute inset-0 flex flex-col @container" :style="{ background: style.background }">
    <div class="flex-1 flex flex-col items-center justify-center px-[5%] gap-[3cqi] text-center overflow-hidden">
      <Headphones v-if="isAudio" class="size-[16cqi] opacity-60 shrink-0" :style="{ color: style.color }" />
      <BookOpen v-else class="size-[16cqi] opacity-60 shrink-0" :style="{ color: style.color }" />

      <p class="font-bold leading-tight w-full break-words" :class="fontSizeClass" :style="{ color: style.color }">
        {{ title ?? 'Untitled' }}
      </p>

      <div class="w-[40%] h-px shrink-0 opacity-40" :style="{ backgroundColor: style.color }" />

      <p v-if="authorLine" class="text-[3.5cqi] opacity-70 truncate w-full" :style="{ color: style.color }">
        {{ authorLine }}
      </p>
    </div>

    <div class="absolute bottom-[3%] right-[3%] opacity-40 pointer-events-none">
      <ImageOff class="size-[8cqi]" :style="{ color: style.color }" />
    </div>
  </div>
</template>
