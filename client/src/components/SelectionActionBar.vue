<script setup lang="ts">
import { computed, ref, useSlots, watch } from 'vue'
import { Download, FolderMinus, FolderPlus, ImageDown, Mail, Pencil, RefreshCw, Trash2, X } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const ICON_SIZE = 17

const BTN_ICON = 'text-foreground/80 h-9 w-9 flex items-center justify-center rounded-full transition-colors'
const BTN_DISABLED = 'text-muted-foreground/60 cursor-not-allowed'
const BTN_PRIMARY = 'text-foreground hover:bg-primary hover:text-primary-foreground'
const BTN_MUTED = 'text-foreground hover:bg-muted'
const BTN_DESTRUCTIVE = 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
const BTN_TEXT_PRIMARY =
  'flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium text-foreground hover:bg-primary hover:text-primary-foreground transition-colors'
const BTN_TEXT_CANCEL = 'h-8 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
const BTN_TEXT_DESTRUCTIVE =
  'h-8 px-3 rounded-full text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors'
const DIVIDER = 'w-px h-5 bg-border mx-1 shrink-0'

const props = defineProps<{
  count: number
  visible: boolean
  inCollection?: boolean
}>()

const emit = defineEmits<{
  'add-to-collection': []
  'remove-from-collection': []
  edit: []
  send: []
  export: [allFormats: boolean]
  'refresh-metadata': []
  're-extract-cover': []
  delete: []
  exit: []
}>()

const { hasPermission } = usePermissions()
const confirmingDelete = ref(false)
const exportMenuOpen = ref(false)
const slots = useSlots()
const hasCustomContent = computed(() => Boolean(slots.content))

function onExport(allFormats: boolean) {
  emit('export', allFormats)
  exportMenuOpen.value = false
}

function onConfirmDelete() {
  emit('delete')
  confirmingDelete.value = false
}

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
    <div
      v-if="visible"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-2.5 py-2 rounded-full bg-card/90 backdrop-blur-xl border border-primary/40 shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
    >
      <TooltipProvider :delay-duration="0">
        <template v-if="hasCustomContent">
          <slot name="content" :count="count" />
        </template>
        <template v-else-if="!confirmingDelete && !exportMenuOpen">
          <span class="px-2.5 py-0.5 text-sm font-semibold tabular-nums whitespace-nowrap rounded-full bg-primary/10 text-primary">{{ count }}</span>

          <div :class="DIVIDER" />

          <Tooltip>
            <TooltipTrigger as-child>
              <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]" @click="emit('send')">
                <Mail :size="ICON_SIZE" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Send via email</TooltipContent>
          </Tooltip>

          <Tooltip v-if="hasPermission('library_download')">
            <TooltipTrigger as-child>
              <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]" @click="exportMenuOpen = true">
                <Download :size="ICON_SIZE" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Export as ZIP</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]" @click="emit('add-to-collection')">
                <FolderPlus :size="ICON_SIZE" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Add to collection</TooltipContent>
          </Tooltip>

          <Tooltip v-if="inCollection">
            <TooltipTrigger as-child>
              <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_DESTRUCTIVE : BTN_DISABLED]" @click="emit('remove-from-collection')">
                <FolderMinus :size="ICON_SIZE" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Remove from collection</TooltipContent>
          </Tooltip>

          <Tooltip v-if="hasPermission('library_edit_metadata')">
            <TooltipTrigger as-child>
              <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]" @click="emit('edit')">
                <Pencil :size="ICON_SIZE" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Edit metadata</TooltipContent>
          </Tooltip>

          <div v-if="hasPermission('library_edit_metadata')" :class="DIVIDER" />

          <Tooltip v-if="hasPermission('library_edit_metadata')">
            <TooltipTrigger as-child>
              <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_MUTED : BTN_DISABLED]" @click="emit('refresh-metadata')">
                <RefreshCw :size="ICON_SIZE" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Refresh metadata</TooltipContent>
          </Tooltip>

          <Tooltip v-if="hasPermission('library_edit_metadata')">
            <TooltipTrigger as-child>
              <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_MUTED : BTN_DISABLED]" @click="emit('re-extract-cover')">
                <ImageDown :size="ICON_SIZE" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Re-extract cover from file</TooltipContent>
          </Tooltip>

          <div :class="DIVIDER" />

          <Tooltip>
            <TooltipTrigger as-child>
              <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_DESTRUCTIVE : BTN_DISABLED]" @click="confirmingDelete = true">
                <Trash2 :size="ICON_SIZE" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Delete selected</TooltipContent>
          </Tooltip>

          <div :class="DIVIDER" />

          <Tooltip>
            <TooltipTrigger as-child>
              <button :class="[BTN_ICON, 'text-muted-foreground hover:text-foreground hover:bg-muted']" @click="emit('exit')">
                <X :size="ICON_SIZE" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Exit selection</TooltipContent>
          </Tooltip>
        </template>

        <template v-else-if="exportMenuOpen">
          <span class="px-3 text-sm font-semibold text-foreground whitespace-nowrap">Export as ZIP:</span>

          <div :class="DIVIDER" />

          <button :class="BTN_TEXT_PRIMARY" @click="onExport(false)">Primary only</button>

          <button :class="BTN_TEXT_PRIMARY" @click="onExport(true)">All formats</button>

          <div :class="DIVIDER" />

          <button :class="BTN_TEXT_CANCEL" @click="exportMenuOpen = false">Cancel</button>
        </template>

        <template v-else>
          <span class="px-3 text-sm font-semibold text-destructive whitespace-nowrap">Delete {{ count }} book{{ count === 1 ? '' : 's' }}?</span>

          <div :class="DIVIDER" />

          <button :class="BTN_TEXT_DESTRUCTIVE" @click="onConfirmDelete">Delete</button>

          <button :class="BTN_TEXT_CANCEL" @click="confirmingDelete = false">Cancel</button>
        </template>
      </TooltipProvider>
    </div>
  </Transition>
</template>
