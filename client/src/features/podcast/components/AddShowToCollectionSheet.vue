<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, LoaderCircle, Plus } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { Collection } from '@bookorbit/types'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import AppIcon from '@/components/AppIcon.vue'
import CollectionMembershipList from '@/features/collection/components/CollectionMembershipList.vue'
import { formatNumber } from '@/i18n/formatters'
import { useCollections } from '@/features/collection/composables/useCollections'

/** Only what identifies the show, so both the list item and the fuller detail row fit. */
interface CollectableShow {
  id: number
  title: string
}

const props = defineProps<{
  open: boolean
  show: CollectableShow | null
}>()

const emit = defineEmits<{ 'update:open': [open: boolean]; changed: [] }>()

const { t } = useI18n()
const { createCollection, addPodcastsToCollection, removePodcastsFromCollection, fetchPodcastCollectionMembership, refreshCollections } =
  useCollections()

const collections = ref<Collection[]>([])
const memberIds = ref<Set<number>>(new Set())
const mutatingId = ref<number | null>(null)
const loading = ref(false)
const creating = ref(false)
const newName = ref('')

const trimmedName = computed(() => newName.value.trim())
const canCreate = computed(() => trimmedName.value.length > 0 && !creating.value)

function isMember(collection: Collection): boolean {
  return memberIds.value.has(collection.id)
}

function membershipLabel(collection: Collection): string {
  return isMember(collection)
    ? t('podcast.collections.inCollection')
    : t('podcast.collections.showCount', { count: formatNumber(collection.podcastCount) })
}

/** The server flags existing membership, so the sheet does not have to list every collection. */
async function loadMembership(): Promise<void> {
  if (!props.show) return
  loading.value = true
  try {
    const rows = await fetchPodcastCollectionMembership(props.show.id)
    collections.value = rows
    memberIds.value = new Set(rows.filter((row) => (row.memberCount ?? 0) > 0).map((row) => row.id))
  } catch {
    collections.value = []
    memberIds.value = new Set()
  } finally {
    loading.value = false
  }
}

function applyMembership(collection: Collection, member: boolean): void {
  const next = new Set(memberIds.value)
  if (member) next.add(collection.id)
  else next.delete(collection.id)
  memberIds.value = next
  collections.value = collections.value.map((candidate) =>
    candidate.id === collection.id ? { ...candidate, podcastCount: Math.max(0, candidate.podcastCount + (member ? 1 : -1)) } : candidate,
  )
}

/** Clicking a collection the show already belongs to removes it, mirroring the book sheet. */
async function toggle(collection: Collection): Promise<void> {
  if (!props.show || mutatingId.value !== null) return
  const member = isMember(collection)
  mutatingId.value = collection.id
  try {
    if (member) {
      await removePodcastsFromCollection(collection.id, [props.show.id])
      applyMembership(collection, false)
      toast.success(t('podcast.collections.removed', { name: collection.name }))
    } else {
      await addPodcastsToCollection(collection.id, [props.show.id])
      applyMembership(collection, true)
      toast.success(t('podcast.collections.added', { name: collection.name }))
    }
    // The sidebar badge reads the collection's own count, so it has to see the change.
    await refreshCollections()
    emit('changed')
  } catch {
    toast.error(member ? t('podcast.collections.removeFailed') : t('podcast.collections.addFailed'))
  } finally {
    mutatingId.value = null
  }
}

async function createAndAdd(): Promise<void> {
  if (!props.show || !canCreate.value) return
  creating.value = true
  try {
    const collection = await createCollection(trimmedName.value, 'FolderOpen', undefined, 'podcasts')
    await addPodcastsToCollection(collection.id, [props.show.id])
    collections.value = [...collections.value, { ...collection, podcastCount: 1 }]
    memberIds.value = new Set([...memberIds.value, collection.id])
    newName.value = ''
    toast.success(t('podcast.collections.added', { name: collection.name }))
    await refreshCollections()
    emit('changed')
  } catch {
    toast.error(t('podcast.collections.createFailed'))
  } finally {
    creating.value = false
  }
}

function handleOpenChange(open: boolean): void {
  emit('update:open', open)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    newName.value = ''
    await loadMembership()
  },
)
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent
      side="bottom"
      class="max-h-[80vh] overflow-y-auto sm:inset-x-auto sm:left-1/2 sm:right-auto sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:rounded-t-lg"
      :aria-busy="loading"
    >
      <SheetHeader>
        <SheetTitle class="flex items-center gap-2">
          <FolderOpen :size="16" aria-hidden="true" />
          {{ t('podcast.collections.addTitle') }}
        </SheetTitle>
        <SheetDescription>{{ t('podcast.collections.addDescription', { title: show?.title ?? '' }) }}</SheetDescription>
      </SheetHeader>

      <div class="space-y-4 px-4 pb-4">
        <div class="space-y-2">
          <p class="text-xs font-medium uppercase tracking-wider text-foreground">{{ t('podcast.collections.newCollection') }}</p>
          <div class="flex items-center gap-2">
            <Input
              v-model="newName"
              class="min-w-0 flex-1"
              :placeholder="t('podcast.collections.newPlaceholder')"
              :aria-label="t('podcast.collections.newLabel')"
              @keydown.enter="createAndAdd"
            />
            <Button :disabled="!canCreate" class="shrink-0" @click="createAndAdd">
              <LoaderCircle v-if="creating" :size="14" class="mr-1 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <Plus v-else :size="14" class="mr-1" aria-hidden="true" />
              {{ t('podcast.collections.create') }}
            </Button>
          </div>
        </div>

        <div v-if="loading" class="space-y-2 border-t border-border pt-4" role="status">
          <span class="sr-only">{{ t('common.loading') }}</span>
          <Skeleton v-for="index in 3" :key="index" class="h-11 w-full rounded-md" />
        </div>

        <div v-else-if="collections.length > 0" class="space-y-2 border-t border-border pt-4">
          <p class="text-xs font-medium uppercase tracking-wider text-foreground">{{ t('podcast.collections.existing') }}</p>
          <CollectionMembershipList
            :collections="collections"
            :mutating-id="mutatingId"
            :is-member="isMember"
            :label="membershipLabel"
            :disabled="mutatingId !== null"
            @select="toggle"
          >
            <template #icon="{ collection }">
              <AppIcon :icon="collection.icon || 'FolderOpen'" fallback="FolderOpen" :size="16" class="shrink-0 text-muted-foreground" />
            </template>
          </CollectionMembershipList>
        </div>

        <p v-else class="border-t border-border pt-4 text-center text-xs text-muted-foreground">
          {{ t('podcast.collections.none') }}
        </p>
      </div>
    </SheetContent>
  </Sheet>
</template>
