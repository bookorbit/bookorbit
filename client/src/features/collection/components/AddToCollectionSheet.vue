<script setup lang="ts">
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Check, FolderPlus, Loader2, Plus } from 'lucide-vue-next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCollections } from '../composables/useCollections'
import IconPicker from '@/components/IconPicker.vue'
import type { Collection } from '@projectx/types'

const props = defineProps<{
  open: boolean
  bookIds: number[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  done: []
}>()

const { fetchCollectionsWithMembership, createCollection, addBooksToCollection } = useCollections()

const localCollections = ref<Collection[]>([])
const addedIds = ref<Set<number>>(new Set())
const newName = ref('')
const newIcon = ref('')
const creating = ref(false)
const addingTo = ref<number | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (open) {
      addedIds.value = new Set()
      try {
        localCollections.value = await fetchCollectionsWithMembership(props.bookIds)
      } catch {
        toast.error('Failed to load collections')
      }
    }
  },
  { immediate: true },
)

function isFullyAdded(collection: Collection): boolean {
  if (props.bookIds.length === 0) return false
  return addedIds.value.has(collection.id) || (collection.memberCount ?? 0) >= props.bookIds.length
}

function partialCount(collection: Collection): number {
  return addedIds.value.has(collection.id) ? props.bookIds.length : (collection.memberCount ?? 0)
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
    localCollections.value = [...localCollections.value, collection]
    try {
      await addBooksToCollection(collection.id, props.bookIds)
      collection.memberCount = props.bookIds.length
      addedIds.value = new Set([...addedIds.value, collection.id])
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
  if (isFullyAdded(collection)) return
  addingTo.value = collection.id
  try {
    await addBooksToCollection(collection.id, props.bookIds)
    addedIds.value = new Set([...addedIds.value, collection.id])
    localCollections.value = localCollections.value.map((c) => (c.id === collection.id ? { ...c, memberCount: props.bookIds.length } : c))
    const alreadyHad = collection.memberCount ?? 0
    const added = props.bookIds.length - alreadyHad
    const msg =
      alreadyHad > 0
        ? `Added ${added} new book${added === 1 ? '' : 's'} to "${collection.name}" (${alreadyHad} already there)`
        : `Added ${props.bookIds.length} book${props.bookIds.length === 1 ? '' : 's'} to "${collection.name}"`
    toast.success(msg)
  } catch {
    toast.error('Failed to add to collection')
  } finally {
    addingTo.value = null
  }
}

function handleDone() {
  if (addedIds.value.size > 0) emit('done')
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent
      side="bottom"
      class="max-h-[80vh] overflow-y-auto sm:inset-x-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-lg sm:rounded-t-lg"
    >
      <SheetHeader>
        <SheetTitle class="flex items-center gap-2">
          <FolderPlus :size="16" />
          Add to Collection
        </SheetTitle>
      </SheetHeader>

      <div class="px-4 pb-4 space-y-4">
        <p class="text-xs text-muted-foreground">{{ bookIds.length }} book{{ bookIds.length === 1 ? '' : 's' }} selected</p>

        <!-- Create new collection -->
        <div class="space-y-2">
          <p class="text-xs font-medium text-foreground uppercase tracking-wider">New Collection</p>
          <div class="space-y-2">
            <Input v-model="newName" placeholder="Collection name" class="flex-1" @keydown.enter="handleCreate" />
            <IconPicker v-model="newIcon" placeholder="Choose an icon..." />
            <Button :disabled="!newName.trim() || !newIcon.trim() || creating" size="sm" class="w-full" @click="handleCreate">
              <Loader2 v-if="creating" :size="14" class="animate-spin mr-1" />
              <Plus v-else :size="14" class="mr-1" />
              Create
            </Button>
          </div>
        </div>

        <!-- Existing collections -->
        <div v-if="localCollections.length > 0" class="space-y-2">
          <p class="text-xs font-medium text-foreground uppercase tracking-wider">Collections</p>
          <div class="space-y-1">
            <button
              v-for="collection in localCollections"
              :key="collection.id"
              class="w-full flex items-center justify-between px-3 py-2.5 rounded-md transition-colors text-left"
              :class="
                isFullyAdded(collection)
                  ? 'opacity-50 cursor-default'
                  : addingTo === collection.id
                    ? 'bg-muted cursor-wait'
                    : 'hover:bg-muted cursor-pointer'
              "
              :disabled="isFullyAdded(collection) || addingTo === collection.id"
              @click="handleAddTo(collection)"
            >
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-medium text-foreground truncate">{{ collection.name }}</span>
                <span class="text-xs text-muted-foreground">
                  <template v-if="isFullyAdded(collection)">All {{ bookIds.length }} already here</template>
                  <template v-else-if="partialCount(collection) > 0"> {{ partialCount(collection) }} of {{ bookIds.length }} already here </template>
                  <template v-else>{{ collection.bookCount }} book{{ collection.bookCount === 1 ? '' : 's' }}</template>
                </span>
              </div>
              <Loader2 v-if="addingTo === collection.id" :size="18" class="animate-spin text-muted-foreground shrink-0" />
              <Check v-else-if="isFullyAdded(collection)" :size="18" class="text-primary shrink-0" />
              <Plus v-else :size="18" class="text-muted-foreground shrink-0" />
            </button>
          </div>
        </div>

        <div v-else class="text-center py-4">
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
