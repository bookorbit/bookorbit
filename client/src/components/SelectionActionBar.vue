<script setup lang="ts">
import { computed, ref, useSlots, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  BookOpen,
  Download,
  FileSpreadsheet,
  FolderMinus,
  FolderPlus,
  ImageDown,
  Lock,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  SquareArrowOutUpRight,
  SquarePen,
  Star,
  Trash2,
  Unlock,
  X,
} from '@lucide/vue'
import InputWithSuggestions from '@/components/ui/InputWithSuggestions.vue'
import { usePublisherSearch, useSeriesNameSearch, useLanguageSearch } from '@/features/book/composables/useMetadataFieldSearch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { STATUS_ICONS, STATUS_OPTIONS } from '@/features/book/composables/useBookStatus'
import type { ReadStatus } from '@bookorbit/types'
import {
  BULK_EDITABLE_ARRAY_FIELDS,
  BULK_EDITABLE_FIELD_OPTIONS,
  type BulkEditableField,
  type BulkEditableValue,
  type InFlightOp,
} from '@/features/book/composables/useBookBulkActions'

export type ExportScope = 'primary' | 'all' | 'audio'

const ICON_SIZE = 17

const BTN_ICON = 'text-foreground/80 h-9 w-9 shrink-0 flex items-center justify-center rounded-full transition-colors'
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
  // Selection is query-scoped (all matching across pages), so individual ids aren't enumerable.
  queryScoped?: boolean
}>()

const emit = defineEmits<{
  'add-to-collection': []
  'remove-from-collection': []
  edit: []
  'edit-individually': []
  send: []
  download: [scope: ExportScope]
  'export-metadata': []
  'refresh-metadata': []
  're-extract-cover': []
  'set-status': [status: ReadStatus]
  'set-rating': [rating: number | null]
  'set-field': [field: BulkEditableField, value: BulkEditableValue]
  'lock-metadata': [locked: boolean]
  delete: []
  exit: []
}>()

const { t } = useI18n()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()
const { search: searchPublisher } = usePublisherSearch()
const { search: searchSeriesName } = useSeriesNameSearch()
const { search: searchLanguage } = useLanguageSearch()
const confirmingDelete = ref(false)
const deleteInput = ref('')
const exportMenuOpen = ref(false)
const ratingMenuOpen = ref(false)
const fieldMenuOpen = ref(false)
const bulkField = ref<BulkEditableField>('publisher')
const fieldValue = ref('')
const slots = useSlots()
const hasCustomContent = computed(() => Boolean(slots.content))
const canBulkActions = computed(() => !isDemoRestrictedAccount.value)
const canDownload = computed(() => hasPermission('library_download') && canBulkActions.value)
const canEditMetadata = computed(() => hasPermission('library_edit_metadata') && canBulkActions.value)
const canShowMoreMenu = computed(() => canDownload.value || canEditMetadata.value)
const canShare = computed(() => hasPermission('email_send') || canDownload.value)
const numericFieldSelected = computed(() => bulkField.value === 'publishedYear')
const arrayFieldSelected = computed(() => (BULK_EDITABLE_ARRAY_FIELDS as readonly string[]).includes(bulkField.value))
const fieldValuePlaceholder = computed(() =>
  arrayFieldSelected.value ? t('components.selectionActionBar.fieldPlaceholderArray') : t('components.selectionActionBar.fieldPlaceholder'),
)
const typeaheadSearchFn = computed<((q: string) => Promise<string[]>) | null>(() => {
  if (bulkField.value === 'seriesName') return searchSeriesName
  if (bulkField.value === 'publisher') return searchPublisher
  if (bulkField.value === 'language') return searchLanguage
  return null
})

const canConfirmDelete = computed(() => props.count <= 50 || deleteInput.value === 'DELETE')
const canApplyFieldValue = computed(() => {
  if (!numericFieldSelected.value) return true
  const trimmed = fieldValue.value.trim()
  return trimmed.length === 0 || !Number.isNaN(Number(trimmed))
})

function onExport(scope: ExportScope) {
  emit('download', scope)
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

function openFieldEditor() {
  if (props.count === 0) return
  fieldMenuOpen.value = true
}

function onRefreshMetadata() {
  if (props.count === 0) return
  emit('refresh-metadata')
}

function onReExtractCover() {
  if (props.count === 0) return
  emit('re-extract-cover')
}

function resetFieldEditor() {
  fieldMenuOpen.value = false
  bulkField.value = 'publisher'
  fieldValue.value = ''
}

function applyFieldEdit() {
  if (!canApplyFieldValue.value) return
  const trimmed = fieldValue.value.trim()
  let value: BulkEditableValue
  if (numericFieldSelected.value) {
    value = trimmed ? Number(trimmed) : null
  } else if (arrayFieldSelected.value) {
    value = trimmed
      ? [
          ...new Set(
            trimmed
              .split(',')
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
          ),
        ]
      : []
  } else {
    value = trimmed || null
  }
  emit('set-field', bulkField.value, value)
  resetFieldEditor()
}

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      confirmingDelete.value = false
      exportMenuOpen.value = false
      ratingMenuOpen.value = false
      deleteInput.value = ''
      resetFieldEditor()
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

          <template v-else-if="!confirmingDelete && !exportMenuOpen && !ratingMenuOpen && !fieldMenuOpen">
            <span class="px-2.5 py-0.5 text-sm font-semibold tabular-nums whitespace-nowrap rounded-full bg-primary/10 text-primary">{{
              count
            }}</span>

            <div :class="DIVIDER" />

            <Tooltip v-if="canBulkActions">
              <TooltipTrigger as-child>
                <span class="inline-flex shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <button
                        data-testid="action-bulk-set-status"
                        :disabled="count === 0"
                        :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]"
                        :aria-label="t('components.selectionActionBar.setReadingStatus')"
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
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.setReadingStatus') }}</TooltipContent>
            </Tooltip>

            <Tooltip v-if="canEditMetadata">
              <TooltipTrigger as-child>
                <button
                  data-testid="action-bulk-set-rating"
                  :disabled="count === 0"
                  :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]"
                  @click="ratingMenuOpen = true"
                >
                  <Star :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.setRating') }}</TooltipContent>
            </Tooltip>

            <div v-if="canEditMetadata" :class="DIVIDER" />

            <Tooltip v-if="canEditMetadata">
              <TooltipTrigger as-child>
                <button
                  data-testid="action-bulk-edit-metadata"
                  :disabled="count === 0"
                  :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]"
                  @click="emit('edit')"
                >
                  <Pencil :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.openMetadataEditor') }}</TooltipContent>
            </Tooltip>

            <Tooltip v-if="canEditMetadata && !queryScoped">
              <TooltipTrigger as-child>
                <button
                  data-testid="action-edit-individually"
                  :disabled="count === 0"
                  :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]"
                  @click="emit('edit-individually')"
                >
                  <SquareArrowOutUpRight :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.editIndividually') }}</TooltipContent>
            </Tooltip>

            <div v-if="canBulkActions" :class="DIVIDER" />

            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  data-testid="action-add-to-collection"
                  :disabled="count === 0"
                  :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]"
                  @click="emit('add-to-collection')"
                >
                  <FolderPlus :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.addToCollection') }}</TooltipContent>
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
              <TooltipContent side="top">{{ t('components.selectionActionBar.removeFromCollection') }}</TooltipContent>
            </Tooltip>

            <div v-if="canShare" :class="DIVIDER" />

            <Tooltip v-if="hasPermission('email_send')">
              <TooltipTrigger as-child>
                <button
                  data-testid="action-send-email"
                  :disabled="count === 0"
                  :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]"
                  @click="emit('send')"
                >
                  <Mail :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.sendViaEmail') }}</TooltipContent>
            </Tooltip>

            <Tooltip v-if="canDownload">
              <TooltipTrigger as-child>
                <button
                  data-testid="action-download-files"
                  :disabled="count === 0"
                  :class="[BTN_ICON, count > 0 ? BTN_PRIMARY : BTN_DISABLED]"
                  @click="exportMenuOpen = true"
                >
                  <Download :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.downloadFilesZip') }}</TooltipContent>
            </Tooltip>

            <div v-if="canShowMoreMenu" :class="DIVIDER" />

            <Tooltip v-if="canShowMoreMenu">
              <TooltipTrigger as-child>
                <span class="inline-flex shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <button
                        data-testid="action-bulk-metadata-menu"
                        :disabled="count === 0"
                        :class="[BTN_ICON, count > 0 ? BTN_MUTED : BTN_DISABLED]"
                        :aria-label="t('components.selectionActionBar.moreActions')"
                      >
                        <MoreHorizontal :size="ICON_SIZE" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="center" class="w-56">
                      <template v-if="canEditMetadata">
                        <DropdownMenuItem data-testid="action-bulk-set-field" @click="openFieldEditor">
                          <SquarePen :size="14" />
                          <span>{{ t('components.selectionActionBar.setField') }}</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem data-testid="action-bulk-refresh-metadata" @click="onRefreshMetadata">
                          <RefreshCw :size="14" />
                          <span>{{ t('components.selectionActionBar.refreshMetadata') }}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem data-testid="action-bulk-re-extract-cover" @click="onReExtractCover">
                          <ImageDown :size="14" />
                          <span>{{ t('components.selectionActionBar.reExtractCover') }}</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger data-testid="action-bulk-metadata-lock">
                            <Lock :size="14" />
                            <span>{{ t('components.selectionActionBar.metadataLock') }}</span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem data-testid="action-bulk-lock-metadata" @click="lockAll">
                              <Lock :size="14" />
                              <span>{{ t('components.selectionActionBar.lockAll') }}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem data-testid="action-bulk-unlock-metadata" @click="unlockAll">
                              <Unlock :size="14" />
                              <span>{{ t('components.selectionActionBar.unlockAll') }}</span>
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </template>
                      <template v-if="canDownload">
                        <DropdownMenuSeparator v-if="canEditMetadata" />
                        <DropdownMenuItem data-testid="action-export-metadata" @click="emit('export-metadata')">
                          <FileSpreadsheet :size="14" />
                          <span>{{ t('components.selectionActionBar.exportMetadata') }}</span>
                        </DropdownMenuItem>
                      </template>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.moreActions') }}</TooltipContent>
            </Tooltip>

            <div v-if="hasPermission('library_delete_books')" :class="DIVIDER" />

            <Tooltip v-if="hasPermission('library_delete_books')">
              <TooltipTrigger as-child>
                <button
                  data-testid="action-delete"
                  :disabled="count === 0"
                  :class="[BTN_ICON, count > 0 ? BTN_DESTRUCTIVE : BTN_DISABLED]"
                  @click="confirmingDelete = true"
                >
                  <Trash2 :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.deleteSelected') }}</TooltipContent>
            </Tooltip>

            <div :class="DIVIDER" />

            <Tooltip>
              <TooltipTrigger as-child>
                <button :class="[BTN_ICON, 'text-muted-foreground hover:text-foreground hover:bg-muted']" @click="emit('exit')">
                  <X :size="ICON_SIZE" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ t('components.selectionActionBar.exitSelection') }}</TooltipContent>
            </Tooltip>
          </template>

          <!-- Export scope picker -->
          <template v-else-if="exportMenuOpen">
            <span class="hidden sm:inline px-3 text-sm font-semibold text-foreground whitespace-nowrap">{{
              t('components.selectionActionBar.downloadFilesZipLabel')
            }}</span>
            <div :class="DIVIDER" />
            <button :class="BTN_TEXT_PRIMARY" @click="onExport('primary')">{{ t('components.selectionActionBar.primaryOnly') }}</button>
            <button :class="BTN_TEXT_PRIMARY" @click="onExport('all')">{{ t('components.selectionActionBar.allFormats') }}</button>
            <button :class="BTN_TEXT_PRIMARY" @click="onExport('audio')">{{ t('components.selectionActionBar.audioOnly') }}</button>
            <div :class="DIVIDER" />
            <button :class="BTN_TEXT_CANCEL" @click="exportMenuOpen = false">{{ t('common.cancel') }}</button>
          </template>

          <!-- Star rating picker -->
          <template v-else-if="ratingMenuOpen">
            <span class="hidden sm:inline px-3 text-sm font-semibold text-foreground whitespace-nowrap">{{
              t('components.selectionActionBar.setRatingLabel')
            }}</span>
            <div :class="DIVIDER" />
            <button v-for="n in [1, 2, 3, 4, 5]" :key="n" :class="BTN_TEXT_PRIMARY" @click="onSetRating(n)">{{ n }}</button>
            <button :class="BTN_TEXT_CANCEL" @click="clearRating">{{ t('components.selectionActionBar.clear') }}</button>
            <div :class="DIVIDER" />
            <button :class="BTN_TEXT_CANCEL" @click="ratingMenuOpen = false">{{ t('common.cancel') }}</button>
          </template>

          <!-- Field editor -->
          <template v-else-if="fieldMenuOpen">
            <span class="hidden sm:inline px-3 text-sm font-semibold text-foreground whitespace-nowrap">{{
              t('components.selectionActionBar.setFieldLabel')
            }}</span>
            <div :class="DIVIDER" />
            <select
              v-model="bulkField"
              class="h-8 rounded-full border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option v-for="opt in BULK_EDITABLE_FIELD_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <InputWithSuggestions
              v-if="typeaheadSearchFn"
              v-model="fieldValue"
              :search-fn="typeaheadSearchFn"
              :placeholder="fieldValuePlaceholder"
              :class="'h-8 min-w-28 rounded-full border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'"
            />
            <input
              v-else
              v-model="fieldValue"
              :type="numericFieldSelected ? 'number' : 'text'"
              class="h-8 min-w-28 rounded-full border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              :placeholder="fieldValuePlaceholder"
            />
            <button
              :disabled="!canApplyFieldValue"
              :class="[BTN_TEXT_PRIMARY, !canApplyFieldValue && 'cursor-not-allowed opacity-40']"
              @click="applyFieldEdit"
            >
              {{ t('components.selectionActionBar.apply') }}
            </button>
            <button :class="BTN_TEXT_CANCEL" @click="resetFieldEditor">{{ t('common.cancel') }}</button>
          </template>

          <!-- Delete confirmation -->
          <template v-else>
            <span class="px-3 text-sm font-semibold text-destructive whitespace-nowrap">
              {{ t('components.selectionActionBar.deleteConfirm', { count }, count) }}
            </span>
            <template v-if="count > 50">
              <input
                v-model="deleteInput"
                class="h-7 w-24 rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-destructive"
                :placeholder="t('components.selectionActionBar.typeDelete')"
              />
            </template>
            <div :class="DIVIDER" />
            <button
              :disabled="!canConfirmDelete"
              :class="[BTN_TEXT_DESTRUCTIVE, !canConfirmDelete && 'opacity-40 cursor-not-allowed']"
              @click="onConfirmDelete"
            >
              {{ t('common.delete') }}
            </button>
            <button :class="BTN_TEXT_CANCEL" @click="cancelDelete">{{ t('common.cancel') }}</button>
          </template>
        </TooltipProvider>
      </div>
    </div>
  </Transition>
</template>
