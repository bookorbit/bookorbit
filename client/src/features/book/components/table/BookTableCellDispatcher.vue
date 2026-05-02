<script setup lang="ts">
import { computed } from 'vue'
import { Lock, LockOpen } from 'lucide-vue-next'
import BookTableCoverCell from './BookTableCoverCell.vue'
import BookTableTextCell from './BookTableTextCell.vue'
import BookTableNumberCell from './BookTableNumberCell.vue'
import BookTableRatingCell from './BookTableRatingCell.vue'
import BookTableChipsCell from './BookTableChipsCell.vue'
import BookTableReadStatusCell from './BookTableReadStatusCell.vue'
import BookTableFormatCell from './BookTableFormatCell.vue'
import BookTableDateCell from './BookTableDateCell.vue'
import BookTableActionsCell from './BookTableActionsCell.vue'
import BookTableProgressCell from './BookTableProgressCell.vue'
import BookTableLockableCell from './BookTableLockableCell.vue'
import type { BookCard } from '@bookorbit/types'
import type { CellType, ColumnId } from '@/features/book/composables/tableColumnSchema'

type NavigationDirection = 'next' | 'prev' | 'rowUp' | 'rowDown'
type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'

const props = defineProps<{
  book: BookCard
  colId: ColumnId
  cellType: CellType
  hasLockField: boolean
  isLocked: boolean
  isActive: boolean
  isReadOnly: boolean
  isFullyLocked: boolean
  lockedFieldCount: number
  selectionMode: boolean
  alwaysShowOpenLinkIcon: boolean
  value: unknown
  searchFn?: (q: string) => Promise<string[]>
  openLink?: string | null
  openLinkLabel?: string | null
  linkFn?: (chip: string) => string | null
  chipActionFn?: (chip: string) => void
  allowDecimal?: boolean
}>()

const emit = defineEmits<{
  activate: []
  save: [value: unknown]
  cancel: []
  navigate: [direction: NavigationDirection]
  coverClick: []
  toggleLock: []
  lockAll: []
  unlockAll: []
  action: [type: BookActionType]
  'update:book': [updated: BookCard]
}>()

function asString(v: unknown): string | null {
  return v as string | null
}

function asNumber(v: unknown): number | null {
  return v as number | null
}

function asStringArray(v: unknown): string[] {
  return v as string[]
}

const lockStateClass = computed(() => {
  if (props.isFullyLocked) return 'text-primary/90 hover:text-primary'
  if (props.lockedFieldCount > 0) return 'text-amber-600/90 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300'
  return 'text-muted-foreground/70 hover:text-foreground'
})
</script>

<template>
  <template v-if="cellType === 'lockRow'">
    <button
      class="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-muted"
      :class="lockStateClass"
      :aria-label="isFullyLocked ? 'Unlock all fields' : 'Lock all fields'"
      @click.stop="isFullyLocked ? emit('unlockAll') : emit('lockAll')"
    >
      <Lock v-if="lockedFieldCount > 0" :size="13" />
      <LockOpen v-else :size="13" />
    </button>
  </template>

  <BookTableCoverCell
    v-else-if="cellType === 'cover'"
    :book-id="book.id"
    :title="book.title"
    :has-cover="book.hasCover"
    @cover-click="emit('coverClick')"
  />

  <BookTableLockableCell v-else-if="cellType === 'text'" :is-locked="isLocked" :has-lock-field="hasLockField" @toggle-lock="emit('toggleLock')">
    <BookTableTextCell
      :value="asString(value)"
      :is-active="isActive"
      :is-read-only="isReadOnly"
      :always-show-open-link-icon="alwaysShowOpenLinkIcon"
      :search-fn="searchFn"
      :open-link="openLink"
      :open-link-label="openLinkLabel"
      @activate="emit('activate')"
      @save="emit('save', $event)"
      @cancel="emit('cancel')"
      @navigate="emit('navigate', $event)"
    />
  </BookTableLockableCell>

  <BookTableLockableCell v-else-if="cellType === 'number'" :is-locked="isLocked" :has-lock-field="hasLockField" @toggle-lock="emit('toggleLock')">
    <BookTableNumberCell
      :value="asNumber(value)"
      :is-active="isActive"
      :is-read-only="isReadOnly"
      :allow-decimal="allowDecimal ?? false"
      @activate="emit('activate')"
      @save="emit('save', $event)"
      @cancel="emit('cancel')"
      @navigate="emit('navigate', $event)"
    />
  </BookTableLockableCell>

  <BookTableLockableCell v-else-if="cellType === 'rating'" :is-locked="isLocked" :has-lock-field="hasLockField" @toggle-lock="emit('toggleLock')">
    <BookTableRatingCell :value="asNumber(value)" :is-read-only="isReadOnly" @save="emit('save', $event)" />
  </BookTableLockableCell>

  <BookTableLockableCell v-else-if="cellType === 'chips'" :is-locked="isLocked" :has-lock-field="hasLockField" @toggle-lock="emit('toggleLock')">
    <BookTableChipsCell
      :value="asStringArray(value)"
      :is-active="isActive"
      :is-read-only="isReadOnly"
      :search-fn="searchFn"
      :link-fn="linkFn"
      :chip-action-fn="chipActionFn"
      @activate="emit('activate')"
      @save="emit('save', $event)"
      @cancel="emit('cancel')"
      @navigate="emit('navigate', $event)"
    />
  </BookTableLockableCell>

  <BookTableProgressCell v-else-if="cellType === 'progress'" :value="asNumber(value)" />

  <BookTableReadStatusCell
    v-else-if="cellType === 'readStatus'"
    :value="book.readStatus"
    :is-active="isActive"
    :is-read-only="isReadOnly"
    @activate="emit('activate')"
    @save="emit('save', $event)"
    @cancel="emit('cancel')"
    @navigate="emit('navigate', $event)"
  />

  <BookTableFormatCell v-else-if="cellType === 'format'" :files="book.files" />
  <BookTableDateCell v-else-if="cellType === 'date'" :value="asString(value)" />

  <BookTableActionsCell
    v-else-if="cellType === 'actions' && !selectionMode"
    :book="book"
    @action="emit('action', $event)"
    @update:book="emit('update:book', $event)"
  />
</template>
