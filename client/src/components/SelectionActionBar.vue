<script setup lang="ts">
import { computed, ref, useSlots, watch } from 'vue'
import {
  BookOpen,
  Download,
  FolderMinus,
  FolderPlus,
  ImageDown,
  Lock,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Star,
  Tag,
  Trash2,
  Unlock,
  X,
} from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { STATUS_ICONS, STATUS_OPTIONS } from '@/features/book/composables/useBookStatus'
import type { ReadStatus } from '@bookorbit/types'
import type { InFlightOp } from '@/features/book/composables/useBookBulkActions'

export type ExportScope = 'primary' | 'all' | 'audio'

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
  inFlight?: InFlightOp | null
}>()

const emit = defineEmits<{
  'add-to-collection': []
  'remove-from-collection': []
  edit: []
  send: []
  export: [scope: ExportScope]
  'refresh-metadata': []
  're-extract-cover': []
  'set-status': [status: ReadStatus]
  'set-rating': [rating: number | null]
  'edit-tags': []
  'lock-metadata': [locked: boolean]
  delete: []
  exit: []
}>()

const { hasPermission } = usePermissions()
const confirmingDelete = ref(false)
const deleteInput = ref('')
const exportMenuOpen = ref(false)
const ratingMenuOpen = ref(false)
const moreMenuOpen = ref(false)
const slots = useSlots()
const hasCustomContent = computed(() => Boolean(slots.content))

const canConfirmDelete = computed(() => props.count <= 50 || deleteInput.value === 'DELETE')

function onExport(scope: ExportScope) {
  emit('export', scope)
  exportMenuOpen.value = false
}

function onConfirmDelete() {
  if (!canConfirmDelete.value) return
  emit('delete')
  confirmingDelete.value = false
  deleteInput.value = ''
}

function onSetStatus(status: ReadStatus) {
  emit('set-status', status)
}

function onSetRating(rating: number | null) {
  emit('set-rating', rating)
  ratingMenuOpen.value = false
}

function clearRating() {
  onSetRating(null)
}

function cancelDelete() {
  confirmingDelete.value = false
  deleteInput.value = ''
}

function lockAll() {
  emit('lock-metadata', true)
}

function unlockAll() {
  emit('lock-metadata', false)
}

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      confirmingDelete.value = false
      exportMenuOpen.value = false
      ratingMenuOpen.value = false
      moreMenuOpen.value = false
      deleteInput.value = ''
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
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100svw-24px)] rounded-full bg-card/90 backdrop-blur-xl border border-primary/40 shadow-[0_8px_32px_rgba(0,0,0,0.35)] overflow-hidden"
    >
      <div class="flex items-center gap-1 px-2.5 py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TooltipProvider :delay-duration="0">
          <!-- In-flight SSE progress -->
          <template v-if="inFlight">
            <Loader2 :size="15" class="animate-spin text-primary shrink-0" />
            <span class="px-2 text-sm font-medium text-foreground whitespace-nowrap">
              {{ inFlight.label }} {{ inFlight.processed }} / {{ inFlight.total }}
            </span>
          </template>

          <template v-else-if="hasCustomContent">
            <slot name="content" :count="count" />
          </template>

          <template v-else-if="!confirmingDelete && !exportMenuOpen && !ratingMenuOpen && !moreMenuOpen">
            <span class="px-2.5 py-0.5 text-sm font-semibold tabular-nums whitespace-nowrap rounded-full bg-primary/10 text-primary">{{
              count
            }}</span>

            <div :class="DIVIDER" />

            <Tooltip v-if="hasPermission('email_send')">
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
                <button
                  :disabled="count === 0"
                  :class="[BTN_ICON, count > 0 ? BTN_DESTRUCTIVE : BTN_DISABLED]"
                  @click="emit('remove-from-collection')"
                >
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

            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  :disabled="count === 0"
                  :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]"
                  aria-label="Set reading status"
                  title="Set reading status"
                >
                  <BookOpen :size="ICON_SIZE" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" class="w-48">
                <DropdownMenuItem v-for="opt in STATUS_OPTIONS" :key="opt.value" @click="onSetStatus(opt.value)">
                  <component :is="STATUS_ICONS[opt.value]" :size="14" />
                  <span>{{ opt.label }}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip v-if="hasPermission('library_edit_metadata')">
              <TooltipTrigger as-child>
                <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]" @click="ratingMenuOpen = true">
                  <Star :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Set rating</TooltipContent>
            </Tooltip>

            <Tooltip v-if="hasPermission('library_edit_metadata')">
              <TooltipTrigger as-child>
                <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]" @click="emit('edit-tags')">
                  <Tag :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Edit tags</TooltipContent>
            </Tooltip>

            <div v-if="hasPermission('library_edit_metadata')" :class="DIVIDER" />

            <Tooltip v-if="hasPermission('library_edit_metadata')">
              <TooltipTrigger as-child>
                <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_MUTED : BTN_DISABLED]" @click="moreMenuOpen = true">
                  <MoreHorizontal :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">More actions</TooltipContent>
            </Tooltip>

            <div :class="DIVIDER" />

            <Tooltip v-if="hasPermission('library_delete_books')">
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

          <!-- Export scope picker -->
          <template v-else-if="exportMenuOpen">
            <span class="hidden sm:inline px-3 text-sm font-semibold text-foreground whitespace-nowrap">Export as ZIP:</span>
            <div :class="DIVIDER" />
            <button :class="BTN_TEXT_PRIMARY" @click="onExport('primary')">Primary only</button>
            <button :class="BTN_TEXT_PRIMARY" @click="onExport('all')">All formats</button>
            <button :class="BTN_TEXT_PRIMARY" @click="onExport('audio')">Audio only</button>
            <div :class="DIVIDER" />
            <button :class="BTN_TEXT_CANCEL" @click="exportMenuOpen = false">Cancel</button>
          </template>

          <!-- Star rating picker -->
          <template v-else-if="ratingMenuOpen">
            <span class="hidden sm:inline px-3 text-sm font-semibold text-foreground whitespace-nowrap">Set rating:</span>
            <div :class="DIVIDER" />
            <button v-for="n in [1, 2, 3, 4, 5]" :key="n" :class="BTN_TEXT_PRIMARY" @click="onSetRating(n)">{{ n }}</button>
            <button :class="BTN_TEXT_CANCEL" @click="clearRating">Clear</button>
            <div :class="DIVIDER" />
            <button :class="BTN_TEXT_CANCEL" @click="ratingMenuOpen = false">Cancel</button>
          </template>

          <!-- More actions -->
          <template v-else-if="moreMenuOpen">
            <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_MUTED : BTN_DISABLED]" @click="emit('refresh-metadata')">
              <RefreshCw :size="ICON_SIZE" />
            </button>
            <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_MUTED : BTN_DISABLED]" @click="emit('re-extract-cover')">
              <ImageDown :size="ICON_SIZE" />
            </button>
            <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_MUTED : BTN_DISABLED]" @click="lockAll">
              <Lock :size="ICON_SIZE" />
            </button>
            <button :disabled="count === 0" :class="[BTN_ICON, count > 0 ? BTN_MUTED : BTN_DISABLED]" @click="unlockAll">
              <Unlock :size="ICON_SIZE" />
            </button>
            <div :class="DIVIDER" />
            <button :class="BTN_TEXT_CANCEL" @click="moreMenuOpen = false">Back</button>
          </template>

          <!-- Delete confirmation -->
          <template v-else>
            <span class="px-3 text-sm font-semibold text-destructive whitespace-nowrap"> Delete {{ count }} book{{ count === 1 ? '' : 's' }}? </span>
            <template v-if="count > 50">
              <input
                v-model="deleteInput"
                class="h-7 w-24 rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-destructive"
                placeholder="Type DELETE"
              />
            </template>
            <div :class="DIVIDER" />
            <button
              :disabled="!canConfirmDelete"
              :class="[BTN_TEXT_DESTRUCTIVE, !canConfirmDelete && 'opacity-40 cursor-not-allowed']"
              @click="onConfirmDelete"
            >
              Delete
            </button>
            <button :class="BTN_TEXT_CANCEL" @click="cancelDelete">Cancel</button>
          </template>
        </TooltipProvider>
      </div>
    </div>
  </Transition>
</template>
