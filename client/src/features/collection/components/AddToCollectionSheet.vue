<script setup lang="ts">
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { FolderMinus, Library, Loader2, Plus } from 'lucide-vue-next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCollections } from '../composables/useCollections'
import IconPicker from '@/components/IconPicker.vue'
import type { Collection } from '@bookorbit/types'
import { useVirtualKeyboard } from '@/composables/useVirtualKeyboard'

const props = defineProps<{
  open: boolean
  bookIds: number[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  done: []
}>()

const { fetchCollectionsWithMembership, createCollection, addBooksToCollection, removeBooksFromCollection } = useCollections()
const { keyboardHeight } = useVirtualKeyboard()

const localCollections = ref<Collection[]>([])
const changedCollectionIds = ref<Set<number>>(new Set())
const newName = ref('')
const newIcon = ref('')
const creating = ref(false)
const mutatingCollectionId = ref<number | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (open) {
      changedCollectionIds.value = new Set()
      mutatingCollectionId.value = null
      try {
        localCollections.value = await fetchCollectionsWithMembership(props.bookIds)
      } catch {
        toast.error('Failed to load collections')
      }
    }
  },
  { immediate: true },
)

function membershipCount(collection: Collection): number {
  const count = collection.memberCount ?? 0
  return Math.max(0, Math.min(props.bookIds.length, count))
}

function isFullyAdded(collection: Collection): boolean {
  return props.bookIds.length > 0 && membershipCount(collection) === props.bookIds.length
}

function partialCount(collection: Collection): number {
  return membershipCount(collection)
}

function markCollectionChanged(collectionId: number): void {
  changedCollectionIds.value = new Set([...changedCollectionIds.value, collectionId])
}

async function handleCreate() {
  const name = newName.value.trim()
  const icon = newIcon.value.trim()
  if (!name || !icon) return
  creating.value = true
  try {
    const collection = await createCollection(name, icon)
    newName.value = ''
    newIcon.value = ''
    localCollections.value = [...localCollections.value, { ...collection, memberCount: 0 }]
    try {
      await addBooksToCollection(collection.id, props.bookIds)
      localCollections.value = localCollections.value.map((c) => (c.id === collection.id ? { ...c, memberCount: props.bookIds.length } : c))
      markCollectionChanged(collection.id)
      toast.success(`Created "${collection.name}" and added ${props.bookIds.length} book${props.bookIds.length === 1 ? '' : 's'}`)
    } catch {
      toast.error(`Created "${collection.name}" but failed to add books`)
    }
  } catch {
    toast.error('Failed to create collection')
  } finally {
    creating.value = false
  }
}

async function handleAddTo(collection: Collection) {
  if (isFullyAdded(collection) || props.bookIds.length === 0 || mutatingCollectionId.value === collection.id) return
  mutatingCollectionId.value = collection.id
  try {
    await addBooksToCollection(collection.id, props.bookIds)
    markCollectionChanged(collection.id)
    localCollections.value = localCollections.value.map((c) => (c.id === collection.id ? { ...c, memberCount: props.bookIds.length } : c))
    const alreadyHad = membershipCount(collection)
    const added = props.bookIds.length - alreadyHad
    const msg =
      alreadyHad > 0
        ? `Added ${added} new book${added === 1 ? '' : 's'} to "${collection.name}" (${alreadyHad} already there)`
        : `Added ${props.bookIds.length} book${props.bookIds.length === 1 ? '' : 's'} to "${collection.name}"`
    toast.success(msg)
  } catch {
    toast.error('Failed to add to collection')
  } finally {
    mutatingCollectionId.value = null
  }
}

async function handleRemoveFrom(collection: Collection) {
  if (!isFullyAdded(collection) || props.bookIds.length === 0 || mutatingCollectionId.value === collection.id) return
  mutatingCollectionId.value = collection.id
  try {
    await removeBooksFromCollection(collection.id, props.bookIds)
    markCollectionChanged(collection.id)
    localCollections.value = localCollections.value.map((c) => (c.id === collection.id ? { ...c, memberCount: 0 } : c))
    toast.success(`Removed ${props.bookIds.length} book${props.bookIds.length === 1 ? '' : 's'} from "${collection.name}"`)
  } catch {
    toast.error('Failed to remove from collection')
  } finally {
    mutatingCollectionId.value = null
  }
}

async function handleCollectionAction(collection: Collection) {
  if (isFullyAdded(collection)) {
    await handleRemoveFrom(collection)
    return
  }
  await handleAddTo(collection)
}

function handleDone() {
  if (changedCollectionIds.value.size > 0) emit('done')
  emit('update:open', false)
}

function handleOutsideInteraction(e: Event) {
  const target = (e as CustomEvent).detail?.originalEvent?.target as Element | null
  if (target?.closest('[data-icon-picker-panel]')) e.preventDefault()
}

function handleFocusOut(e: FocusEvent) {
  const related = e.relatedTarget as Element | null
  if (related?.closest?.('[data-icon-picker-panel]')) {
    e.stopPropagation()
  }
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent
      side="bottom"
      class="max-h-[80vh] overflow-y-auto sm:inset-x-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-lg sm:rounded-t-lg"
      :style="keyboardHeight > 0 ? { bottom: `${keyboardHeight}px` } : undefined"
      @pointer-down-outside="handleOutsideInteraction"
      @focus-outside="handleOutsideInteraction"
      @interact-outside="handleOutsideInteraction"
      @focusout="handleFocusOut"
    >
      <SheetHeader>
        <SheetTitle class="flex items-center gap-2">
          <Library :size="16" />
          Manage Collections
        </SheetTitle>
      </SheetHeader>

      <div class="px-4 pb-4 space-y-4">
        <p class="text-xs text-muted-foreground animate-fade-up">{{ bookIds.length }} book{{ bookIds.length === 1 ? '' : 's' }} selected</p>

        <!-- Create new collection -->
        <div class="space-y-2 animate-fade-up" style="animation-delay: 50ms">
          <p class="text-xs font-medium text-foreground uppercase tracking-wider">New Collection</p>
          <div class="flex items-center gap-2">
            <Input v-model="newName" placeholder="Collection name" class="flex-1 min-w-0" @keydown.enter="handleCreate" />
            <IconPicker v-model="newIcon" hide-text class="shrink-0" />
            <Button :disabled="!newName.trim() || !newIcon.trim() || creating" class="shrink-0" @click="handleCreate">
              <Loader2 v-if="creating" :size="14" class="animate-spin mr-1" />
              <Plus v-else :size="14" class="mr-1" />
              Create
            </Button>
          </div>
        </div>

        <!-- Existing collections -->
        <div v-if="localCollections.length > 0" class="pt-4 border-t border-border space-y-2 animate-fade-up" style="animation-delay: 100ms">
          <p class="text-xs font-medium text-foreground uppercase tracking-wider">Collections</p>
          <div class="space-y-1">
            <button
              v-for="collection in localCollections"
              :key="collection.id"
              class="w-full flex items-center justify-between px-3 py-2.5 rounded-md transition-colors text-left"
              :class="
                mutatingCollectionId === collection.id
                  ? 'bg-muted cursor-wait'
                  : isFullyAdded(collection)
                    ? 'hover:bg-destructive/10 cursor-pointer'
                    : 'hover:bg-muted cursor-pointer'
              "
              :disabled="bookIds.length === 0 || mutatingCollectionId === collection.id"
              @click="handleCollectionAction(collection)"
            >
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-medium text-foreground truncate">{{ collection.name }}</span>
                <span class="text-xs text-muted-foreground">
                  <template v-if="isFullyAdded(collection)">All {{ bookIds.length }} already here</template>
                  <template v-else-if="partialCount(collection) > 0"> {{ partialCount(collection) }} of {{ bookIds.length }} already here </template>
                  <template v-else>{{ collection.bookCount }} book{{ collection.bookCount === 1 ? '' : 's' }}</template>
                </span>
              </div>
              <Loader2 v-if="mutatingCollectionId === collection.id" :size="18" class="animate-spin text-muted-foreground shrink-0" />
              <FolderMinus v-else-if="isFullyAdded(collection)" :size="18" class="text-destructive shrink-0" />
              <Plus v-else :size="18" class="text-muted-foreground shrink-0" />
            </button>
          </div>
        </div>

        <div v-else class="text-center py-4 border-t border-border">
          <p class="text-xs text-muted-foreground">No collections yet. Create one above.</p>
        </div>

        <!-- Done -->
        <div class="pt-2 border-t border-border">
          <Button variant="outline" class="w-full" @click="handleDone">Done</Button>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
