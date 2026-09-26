<script setup lang="ts">
import { computed, provide, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { PodcastEpisodeSummary } from '@bookorbit/types'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import FormSheet from '@/components/FormSheet.vue'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import PodcastFieldLabel from './PodcastFieldLabel.vue'
import { PODCAST_LOCKS_ENABLED } from '../lib/podcast-locks'
import { usePodcastEpisodeDetail } from '../composables/usePodcastEpisodeDetail'
import { usePodcastEpisodeMetadataEditor } from '../composables/usePodcastEpisodeMetadataEditor'

const props = defineProps<{ open: boolean; episodeId: number }>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  saved: [episode: PodcastEpisodeSummary]
}>()

const { t } = useI18n()
const editor = usePodcastEpisodeMetadataEditor()
// Reloading on every open keeps the lock toggles honest: another editor or a feed refresh may have
// moved both the values and the lock set since this list row was rendered.
const {
  detail,
  loading,
  error: loadError,
  loaded,
  reload,
} = usePodcastEpisodeDetail(
  toRef(() => props.episodeId),
  toRef(() => props.open),
)

const form = editor.form
const foreignEpisodeType = computed(() => editor.foreignEpisodeType.value)
const isLocalEpisode = computed(() => detail.value?.origin === 'local')

// A local episode has no feed to be overwritten by, so an edit to it is already permanent and the
// per-field locks are hidden rather than offered as protection against something that never happens.
provide(
  PODCAST_LOCKS_ENABLED,
  computed(() => !isLocalEpisode.value),
)

watch(detail, (episode) => {
  if (episode) editor.load(episode)
})

function handleOpenChange(open: boolean) {
  emit('update:open', open)
}

function close() {
  emit('update:open', false)
}

async function handleSave() {
  if (!form.title.trim()) {
    toast.error(t('podcast.errors.episodeTitleRequired'))
    return
  }
  if (editor.durationInvalid.value) {
    toast.error(t('podcast.episodeEdit.durationInvalid'))
    return
  }
  if (!editor.hasChanges.value) {
    close()
    return
  }
  const result = await editor.save(props.episodeId)
  if (!result) {
    toast.error(editor.error.value ?? t('podcast.errors.updateEpisode'))
    return
  }
  emit('saved', result)
  toast.success(t('podcast.messages.episodeDetailsSaved'))
  close()
}
</script>

<template>
  <FormSheet
    :open="open"
    :title="t('podcast.episodeEdit.title')"
    :description="t('podcast.episodeEdit.description')"
    content-class="sm:max-w-lg"
    :busy="editor.saving.value"
    :dirty="editor.isDirty.value"
    :submit-disabled="loading || !loaded"
    submit-test-id="podcast-save-episode-details"
    data-testid="podcast-episode-edit-sheet"
    :aria-busy="editor.saving.value || loading"
    @update:open="handleOpenChange"
    @submit="handleSave"
  >
    <div v-if="loading" class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4" role="status">
      <span class="sr-only">{{ t('podcast.fullPlayer.loading') }}</span>
      <Skeleton class="h-9 w-full" />
      <Skeleton class="h-9 w-full" />
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-9 w-2/3" />
    </div>

    <LoadErrorPanel v-else-if="loadError" :message="loadError" class="flex-1" @retry="reload" />

    <div v-else-if="loaded" class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
      <p class="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {{ isLocalEpisode ? t('podcast.episodeEdit.localHint') : t('podcast.episodeEdit.lockHint') }}
      </p>

      <PodcastFieldLabel
        :label="t('podcast.episodeEdit.titleLabel')"
        field="title"
        input-id="podcast-episode-edit-title"
        :locked="editor.isLocked('title')"
        :will-lock="editor.willLock('title')"
        :disabled="editor.saving.value"
        @toggle="editor.toggleLock"
      >
        <Input id="podcast-episode-edit-title" v-model="form.title" type="text" maxlength="2000" required />
      </PodcastFieldLabel>

      <PodcastFieldLabel
        :label="t('podcast.episodeEdit.subtitleLabel')"
        field="subtitle"
        input-id="podcast-episode-edit-subtitle"
        :locked="editor.isLocked('subtitle')"
        :will-lock="editor.willLock('subtitle')"
        :disabled="editor.saving.value"
        @toggle="editor.toggleLock"
      >
        <Input
          id="podcast-episode-edit-subtitle"
          v-model="form.subtitle"
          type="text"
          maxlength="10000"
          :placeholder="t('podcast.episodeEdit.subtitlePlaceholder')"
        />
      </PodcastFieldLabel>

      <PodcastFieldLabel
        :label="t('podcast.episodeEdit.descriptionLabel')"
        field="description"
        input-id="podcast-episode-edit-description"
        :locked="editor.isLocked('description')"
        :will-lock="editor.willLock('description')"
        :disabled="editor.saving.value"
        @toggle="editor.toggleLock"
      >
        <Textarea
          id="podcast-episode-edit-description"
          v-model="form.description"
          rows="6"
          maxlength="100000"
          :placeholder="t('podcast.episodeEdit.descriptionPlaceholder')"
        />
        <p class="text-xs text-muted-foreground">{{ t('podcast.episodeEdit.descriptionHint') }}</p>
      </PodcastFieldLabel>

      <PodcastFieldLabel
        :label="t('podcast.episodeEdit.publishedAtLabel')"
        field="publishedAt"
        input-id="podcast-episode-edit-published-at"
        :locked="editor.isLocked('publishedAt')"
        :will-lock="editor.willLock('publishedAt')"
        :disabled="editor.saving.value"
        @toggle="editor.toggleLock"
      >
        <Input id="podcast-episode-edit-published-at" v-model="form.publishedAt" type="datetime-local" />
      </PodcastFieldLabel>

      <div class="grid gap-5 sm:grid-cols-2">
        <PodcastFieldLabel
          :label="t('podcast.episodeEdit.seasonLabel')"
          field="season"
          input-id="podcast-episode-edit-season"
          :locked="editor.isLocked('season')"
          :will-lock="editor.willLock('season')"
          :disabled="editor.saving.value"
          @toggle="editor.toggleLock"
        >
          <Input
            id="podcast-episode-edit-season"
            v-model="form.season"
            type="text"
            maxlength="100"
            :placeholder="t('podcast.episodeEdit.seasonPlaceholder')"
          />
        </PodcastFieldLabel>

        <PodcastFieldLabel
          :label="t('podcast.episodeEdit.episodeLabel')"
          field="episode"
          input-id="podcast-episode-edit-episode"
          :locked="editor.isLocked('episode')"
          :will-lock="editor.willLock('episode')"
          :disabled="editor.saving.value"
          @toggle="editor.toggleLock"
        >
          <Input
            id="podcast-episode-edit-episode"
            v-model="form.episode"
            type="text"
            maxlength="100"
            :placeholder="t('podcast.episodeEdit.episodePlaceholder')"
          />
        </PodcastFieldLabel>
      </div>

      <div class="grid gap-5 sm:grid-cols-2">
        <PodcastFieldLabel
          :label="t('podcast.episodeEdit.episodeTypeLabel')"
          field="episodeType"
          input-id="podcast-episode-edit-episode-type"
          :locked="editor.isLocked('episodeType')"
          :will-lock="editor.willLock('episodeType')"
          :disabled="editor.saving.value"
          @toggle="editor.toggleLock"
        >
          <Select id="podcast-episode-edit-episode-type" v-model="form.episodeType">
            <option value="">{{ t('podcast.episodeEdit.episodeTypeNone') }}</option>
            <option value="full">{{ t('podcast.episodeEdit.episodeTypeFull') }}</option>
            <option value="trailer">{{ t('podcast.episodeEdit.episodeTypeTrailer') }}</option>
            <option value="bonus">{{ t('podcast.episodeEdit.episodeTypeBonus') }}</option>
            <option v-if="foreignEpisodeType" :value="foreignEpisodeType">
              {{ t('podcast.episodeEdit.episodeTypeFromFeed', { value: foreignEpisodeType }) }}
            </option>
          </Select>
        </PodcastFieldLabel>

        <PodcastFieldLabel
          :label="t('podcast.episodeEdit.durationLabel')"
          field="durationSeconds"
          input-id="podcast-episode-edit-duration"
          :locked="editor.isLocked('durationSeconds')"
          :will-lock="editor.willLock('durationSeconds')"
          :disabled="editor.saving.value"
          @toggle="editor.toggleLock"
        >
          <!-- Deliberately not type="number": that makes Vue coerce the model to a number and has the
               browser report unparseable text as an empty value, which would read as "clear the duration". -->
          <Input
            id="podcast-episode-edit-duration"
            v-model="form.durationMinutes"
            type="text"
            inputmode="decimal"
            maxlength="12"
            :placeholder="t('podcast.episodeEdit.durationPlaceholder')"
            :aria-invalid="editor.durationInvalid.value"
            :aria-describedby="editor.durationInvalid.value ? 'podcast-episode-edit-duration-error' : 'podcast-episode-edit-duration-hint'"
          />
          <p v-if="editor.durationInvalid.value" id="podcast-episode-edit-duration-error" class="text-xs text-destructive" role="alert">
            {{ t('podcast.episodeEdit.durationInvalid') }}
          </p>
          <p v-else id="podcast-episode-edit-duration-hint" class="text-xs text-muted-foreground">
            {{ t('podcast.episodeEdit.durationHint') }}
          </p>
        </PodcastFieldLabel>
      </div>

      <PodcastFieldLabel
        :label="t('podcast.episodeEdit.explicitLabel')"
        field="explicit"
        input-id="podcast-episode-edit-explicit"
        :locked="editor.isLocked('explicit')"
        :will-lock="editor.willLock('explicit')"
        :disabled="editor.saving.value"
        @toggle="editor.toggleLock"
      >
        <div class="flex items-center gap-2">
          <ToggleSwitch id="podcast-episode-edit-explicit" v-model="form.explicit" :disabled="editor.saving.value" />
          <span class="text-xs text-muted-foreground">{{ t('podcast.episodeEdit.explicitHint') }}</span>
        </div>
      </PodcastFieldLabel>
    </div>
  </FormSheet>
</template>
