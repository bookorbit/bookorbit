<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, X } from '@lucide/vue'
import { useModal } from '@/composables/useModal'
import { registerLightbox } from '../lib/lightbox-state'

const props = withDefaults(defineProps<{ images: string[]; startIndex?: number; alt?: string }>(), {
  startIndex: 0,
})
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const current = ref(props.startIndex)
const panel = ref<HTMLElement | null>(null)

function handleClose() {
  emit('close')
}

function next() {
  current.value = (current.value + 1) % props.images.length
}

function prev() {
  current.value = (current.value - 1 + props.images.length) % props.images.length
}

function handleArrowKeys(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') next()
  else if (event.key === 'ArrowLeft') prev()
}

let unregister: (() => void) | null = null

useModal({ container: panel, onClose: handleClose })

onMounted(() => {
  unregister = registerLightbox()
  window.addEventListener('keydown', handleArrowKeys)
})
onUnmounted(() => {
  unregister?.()
  window.removeEventListener('keydown', handleArrowKeys)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      class="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 motion-safe:animate-in motion-safe:fade-in"
      role="dialog"
      aria-modal="true"
      :aria-label="t('whatsNew.imageViewer')"
      @click.self="handleClose"
    >
      <button
        type="button"
        class="absolute right-4 top-4 text-white/80 transition-colors hover:text-white"
        :aria-label="t('whatsNew.closeImage')"
        @click="handleClose"
      >
        <X :size="24" />
      </button>

      <button
        v-if="images.length > 1"
        type="button"
        class="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        :aria-label="t('whatsNew.previousImage')"
        @click="prev"
      >
        <ChevronLeft :size="28" />
      </button>

      <img :src="images[current]" :alt="alt ?? ''" class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />

      <button
        v-if="images.length > 1"
        type="button"
        class="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        :aria-label="t('whatsNew.nextImage')"
        @click="next"
      >
        <ChevronRight :size="28" />
      </button>

      <span v-if="images.length > 1" class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-white/90">
        {{ current + 1 }} / {{ images.length }}
      </span>
    </div>
  </Teleport>
</template>
