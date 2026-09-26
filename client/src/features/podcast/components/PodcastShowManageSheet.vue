<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trash2 } from '@lucide/vue'
import type { PodcastListItem, PodcastSummary } from '@bookorbit/types'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import FormSheet from '@/components/FormSheet.vue'
import type { PodcastShowManagement } from '../composables/usePodcastShowManagement'

const props = defineProps<{
  /** The host view's management instance; a second one would keep its own, divergent state. */
  management: PodcastShowManagement
  show: PodcastSummary | null
  canPurge: boolean
}>()

const { t } = useI18n()
const mergeQuery = ref('')
// The instance is created once by the view, so its refs are safe to pull out here.
const { manageOpen, requestPending, deleting, mergeCandidates, selectedMergeSource, deletePreview, deleteDescription, deleteNeedsTypedConfirmation } =
  props.management

function handleOpened() {
  mergeQuery.value = ''
}

function handleOpenUpdate(open: boolean) {
  props.management.handleManageOpenChange(open)
}

function search() {
  void props.management.searchMergeCandidates(mergeQuery.value)
}

function selectMergeCandidate(candidate: PodcastListItem) {
  props.management.selectMergeCandidate(candidate)
}

function archive() {
  void props.management.archive()
}

function restore() {
  void props.management.restore()
}

function prepareDelete() {
  void props.management.prepareDelete()
}

function cancelDelete() {
  props.management.cancelDelete()
}

function deleteShow() {
  void props.management.deleteShow()
}

function cancelMerge() {
  props.management.cancelMerge()
}

function merge() {
  void props.management.merge()
}
</script>

<template>
  <FormSheet
    :open="manageOpen && Boolean(show)"
    :title="t('podcast.show.manageTitle')"
    :description="t('podcast.show.dangerZoneActions')"
    content-class="sm:max-w-md"
    :busy="requestPending"
    hide-footer
    data-testid="podcast-manage-dialog"
    @update:open="handleOpenUpdate"
    @opened="handleOpened"
  >
    <div v-if="show" class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <div class="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <h3 class="text-sm font-semibold text-destructive">{{ t('podcast.show.dangerZone') }}</h3>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button v-if="show.archivedAt" variant="outline" data-testid="podcast-restore" @click="restore">
            {{ t('podcast.show.restore') }}
          </Button>
          <Button
            v-else
            variant="outline"
            class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            data-testid="podcast-archive"
            @click="archive"
          >
            {{ t('podcast.show.archive') }}
          </Button>
          <Button v-if="canPurge" variant="destructive" data-testid="podcast-delete" :disabled="deleting" @click="prepareDelete">
            <Trash2 :size="14" /> {{ t('podcast.show.deletePermanently') }}
          </Button>
        </div>
        <p class="mt-2 text-xs leading-5 text-muted-foreground">
          {{ canPurge ? t('podcast.show.archiveOrDelete') : t('podcast.show.deleteRequiresOwner') }}
        </p>
      </div>
      <div v-if="canPurge && show.archivedAt" class="mt-5 rounded-xl border border-border p-4">
        <h3 class="text-sm font-semibold">{{ t('podcast.show.mergeTitle') }}</h3>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('podcast.show.mergeDescription') }}</p>
        <form class="mt-3 flex gap-2" role="search" @submit.prevent="search">
          <Input
            v-model="mergeQuery"
            type="search"
            class="flex-1"
            :placeholder="t('podcast.show.searchMergeSource')"
            :aria-label="t('podcast.show.searchMergeSource')"
          />
          <Button type="submit" variant="outline">{{ t('podcast.actions.search') }}</Button>
        </form>
        <div v-if="mergeCandidates.length" class="mt-2 max-h-44 space-y-1 overflow-y-auto">
          <button
            v-for="candidate in mergeCandidates"
            :key="candidate.id"
            type="button"
            class="flex h-9 w-full items-center justify-between rounded-md px-3 text-left text-sm transition-colors hover:bg-muted outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            :class="selectedMergeSource?.id === candidate.id ? 'bg-muted' : ''"
            @click="selectMergeCandidate(candidate)"
          >
            <span class="truncate">{{ candidate.title }}</span>
            <span class="ml-3 shrink-0 text-xs text-muted-foreground">{{ candidate.author }}</span>
          </button>
        </div>
      </div>
    </div>
  </FormSheet>

  <ConfirmDialog
    :open="deletePreview !== null && show !== null"
    :title="t('podcast.show.deletePermanently')"
    :description="deleteDescription"
    :confirm-label="t('podcast.show.deletePermanently')"
    :confirmation-phrase="deleteNeedsTypedConfirmation ? show?.title : undefined"
    :busy="deleting"
    destructive
    @confirm="deleteShow"
    @cancel="cancelDelete"
  />

  <ConfirmDialog
    :open="selectedMergeSource !== null"
    :title="t('podcast.show.mergeTitle')"
    :description="selectedMergeSource ? t('podcast.show.mergeSelected', { title: selectedMergeSource.title }) : ''"
    :confirm-label="t('podcast.show.queueMerge')"
    :confirmation-phrase="selectedMergeSource?.title"
    :busy="requestPending"
    destructive
    @confirm="merge"
    @cancel="cancelMerge"
  />
</template>
