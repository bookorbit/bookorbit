<script setup lang="ts">
import { ref, watch } from 'vue'
import { Download, FolderMinus, FolderPlus, ImageDown, Mail, RefreshCw, Trash2, X } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const ICON_SIZE = 17

const props = defineProps<{
  count: number
  visible: boolean
  inCollection?: boolean
}>()

const emit = defineEmits<{
  'add-to-collection': []
  'remove-from-collection': []
  send: []
  export: [allFormats: boolean]
  'refresh-metadata': []
  're-extract-cover': []
  delete: []
  exit: []
}>()

const confirmingDelete = ref(false)
const exportMenuOpen = ref(false)

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      confirmingDelete.value = false
      exportMenuOpen.value = false
    }
  },
)
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-4"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-150 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-4"
  >
    <TooltipProvider :delay-duration="0">
      <div
        v-if="visible"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-2.5 py-2 rounded-full bg-card/90 backdrop-blur-xl border border-primary/40 shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
      >
      <template v-if="!confirmingDelete && !exportMenuOpen">
        <!-- Count -->
        <span class="px-2.5 py-0.5 text-sm font-semibold tabular-nums whitespace-nowrap rounded-full bg-primary/10 text-primary">{{ count }}</span>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              :disabled="count === 0"
              class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
              :class="count > 0 ? 'text-foreground hover:bg-primary hover:text-primary-foreground' : 'text-muted-foreground/30 cursor-not-allowed'"
              @click="emit('send')"
            >
              <Mail :size="ICON_SIZE" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Send via email</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              :disabled="count === 0"
              class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
              :class="count > 0 ? 'text-foreground hover:bg-primary hover:text-primary-foreground' : 'text-muted-foreground/30 cursor-not-allowed'"
              @click="exportMenuOpen = true"
            >
              <Download :size="ICON_SIZE" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Export as ZIP</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              :disabled="count === 0"
              class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
              :class="count > 0 ? 'text-foreground hover:bg-primary hover:text-primary-foreground' : 'text-muted-foreground/30 cursor-not-allowed'"
              @click="emit('add-to-collection')"
            >
              <FolderPlus :size="ICON_SIZE" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Add to collection</TooltipContent>
        </Tooltip>

        <Tooltip v-if="inCollection">
          <TooltipTrigger as-child>
            <button
              :disabled="count === 0"
              class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
              :class="count > 0 ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground' : 'text-muted-foreground/30 cursor-not-allowed'"
              @click="emit('remove-from-collection')"
            >
              <FolderMinus :size="ICON_SIZE" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Remove from collection</TooltipContent>
        </Tooltip>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              :disabled="count === 0"
              class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
              :class="count > 0 ? 'text-foreground hover:bg-muted' : 'text-muted-foreground/30 cursor-not-allowed'"
              @click="emit('refresh-metadata')"
            >
              <RefreshCw :size="ICON_SIZE" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Refresh metadata</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              :disabled="count === 0"
              class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
              :class="count > 0 ? 'text-foreground hover:bg-muted' : 'text-muted-foreground/30 cursor-not-allowed'"
              @click="emit('re-extract-cover')"
            >
              <ImageDown :size="ICON_SIZE" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Re-extract cover from file</TooltipContent>
        </Tooltip>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              :disabled="count === 0"
              class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
              :class="count > 0 ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground' : 'text-muted-foreground/30 cursor-not-allowed'"
              @click="confirmingDelete = true"
            >
              <Trash2 :size="ICON_SIZE" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Delete selected</TooltipContent>
        </Tooltip>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="h-9 w-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              @click="emit('exit')"
            >
              <X :size="ICON_SIZE" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Exit selection</TooltipContent>
        </Tooltip>
      </template>

      <template v-else-if="exportMenuOpen">
        <span class="px-3 text-sm font-semibold text-foreground whitespace-nowrap">Export as ZIP:</span>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <button
          class="flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium text-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
          @click="emit('export', false); exportMenuOpen = false"
        >
          Primary only
        </button>

        <button
          class="flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium text-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
          @click="emit('export', true); exportMenuOpen = false"
        >
          All formats
        </button>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <button
          class="h-8 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="exportMenuOpen = false"
        >
          Cancel
        </button>
      </template>

      <template v-else>
        <span class="px-3 text-sm font-semibold text-destructive whitespace-nowrap">Delete {{ count }} book{{ count === 1 ? '' : 's' }}?</span>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <button
          class="h-8 px-3 rounded-full text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
          @click="emit('delete'); confirmingDelete = false"
        >
          Delete
        </button>

        <button
          class="h-8 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="confirmingDelete = false"
        >
          Cancel
        </button>
      </template>
      </div>
    </TooltipProvider>
  </Transition>
</template>
